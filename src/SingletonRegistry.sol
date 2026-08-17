// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IBlockProver, BlockProverLib} from "./interfaces/IBlockProver.sol";
import {IChainInfo, ChainInfoLib} from "./interfaces/IChainInfo.sol";
import {EvmV1Decoder} from "./vendor/EvmV1Decoder.sol";

/**
 * Singleton: a first-to-file priority registry for on-chain collateral.
 *
 * A lending protocol on a source chain accepts collateral and emits its own
 * pledge event. It is not modified, it is not integrated with, and it is not
 * asked. Anybody can then submit an inclusion proof of that transaction here,
 * and the asset becomes claimed. A second pledge of the same asset, from any
 * other protocol, reverts.
 *
 * The asset key excludes the emitter on purpose. Including it would give the
 * same asset two different keys in two different protocols, which is precisely
 * the collision the registry exists to catch. The cost of that choice is
 * recorded as caveat 5 in docs/CAVEATS.md and is not hidden.
 */
contract SingletonRegistry {
    // -------------------------------------------------------------- types

    enum AssetState {
        FREE,
        PLEDGED,
        SETTLED
    }

    struct Record {
        AssetState state;
        address emitter;
        address borrower;
        uint256 amount;
        bytes32 instanceId;
        uint64 chainKey;
        uint64 sourceHeight;
        uint64 recordedAt;
    }

    struct Proof {
        uint64 chainKey;
        uint64 height;
        bytes encodedTransaction;
        IBlockProver.MerkleProof merkleProof;
        IBlockProver.ContinuityProof continuityProof;
    }

    // ---------------------------------------------------------- constants

    /// keccak256("Pledged(address,uint256,address,uint256,bytes32)")
    bytes32 public constant PLEDGED_SIG =
        0xbfb86e5d7136ec550644fc6d0fcc8e6504e3dc19aacdeec2dec3d459854b4823;

    IBlockProver public constant PROVER = IBlockProver(0x0000000000000000000000000000000000000FD2);
    IChainInfo public constant CHAIN_INFO = IChainInfo(0x0000000000000000000000000000000000000fD3);

    // -------------------------------------------------------------- state

    address public admin;

    /// Which emitters are read at all, per chain. Governs selection, never truth.
    mapping(uint64 => mapping(address => bool)) public allowedEmitter;

    /// Confirmation depth before a source block is accepted. Stricter for L2s.
    mapping(uint64 => uint64) public minConfirmations;

    mapping(bytes32 => Record) private _records;

    /// One proof, one registration. Keyed by chain, block and transaction index.
    mapping(bytes32 => bool) public consumed;

    // ------------------------------------------------------------- events

    event PledgeRecorded(
        bytes32 indexed assetKey,
        address indexed emitter,
        address indexed borrower,
        uint64 chainKey,
        uint256 amount,
        bytes32 instanceId
    );

    event DoublePledge(bytes32 indexed assetKey, address indexed incumbent, address indexed rejected);

    event EmitterAllowed(uint64 indexed chainKey, address indexed emitter, bool allowed);

    // ------------------------------------------------------------- errors

    error NotAdmin();
    error ProofRejected();
    error NotFinal(uint64 height, uint64 attestedTip, uint64 required);
    error SourceTransactionReverted();
    error NoPledgeLog();
    error AmbiguousPledgeLogs(uint256 found);
    error EmitterNotAllowed(uint64 chainKey, address emitter);
    error ProofAlreadyConsumed(bytes32 nullifier);
    error AssetNotFree(bytes32 assetKey, address incumbent);

    // -------------------------------------------------------- constructor

    constructor() {
        admin = msg.sender;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    // ---------------------------------------------------------- admin ops

    function setEmitter(uint64 chainKey, address emitter, bool allowed) external onlyAdmin {
        allowedEmitter[chainKey][emitter] = allowed;
        emit EmitterAllowed(chainKey, emitter, allowed);
    }

    function setMinConfirmations(uint64 chainKey, uint64 depth) external onlyAdmin {
        minConfirmations[chainKey] = depth;
    }

    // ----------------------------------------------------------- core ops

    /**
     * Records a pledge witnessed on a source chain.
     *
     * Permissionless: anybody may submit, because the proof is what carries the
     * authority, not the sender.
     */
    function registerPledge(Proof calldata p) external returns (bytes32 assetKey) {
        _requireVerified(p);
        _requireFinal(p.chainKey, p.height);

        EvmV1Decoder.LogEntry memory log = _singlePledgeLog(p.encodedTransaction);

        if (!allowedEmitter[p.chainKey][log.address_]) {
            revert EmitterNotAllowed(p.chainKey, log.address_);
        }

        _burnNullifier(p);

        (address token, uint256 tokenId, address borrower, uint256 amount, bytes32 instanceId) =
            _decodePledge(log);

        assetKey = keccak256(abi.encode(p.chainKey, token, tokenId));

        Record storage r = _records[assetKey];
        if (r.state != AssetState.FREE) {
            emit DoublePledge(assetKey, r.emitter, log.address_);
            revert AssetNotFree(assetKey, r.emitter);
        }

        _records[assetKey] = Record({
            state: AssetState.PLEDGED,
            emitter: log.address_,
            borrower: borrower,
            amount: amount,
            instanceId: instanceId,
            chainKey: p.chainKey,
            sourceHeight: p.height,
            recordedAt: uint64(block.timestamp)
        });

        emit PledgeRecorded(assetKey, log.address_, borrower, p.chainKey, amount, instanceId);
    }

    function getStatus(bytes32 assetKey) external view returns (Record memory) {
        return _records[assetKey];
    }

    function assetKeyOf(uint64 chainKey, address token, uint256 tokenId)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(chainKey, token, tokenId));
    }

    // ----------------------------------------------------------- internals

    function _requireVerified(Proof calldata p) private view {
        bool ok = PROVER.verify(
            p.chainKey, p.height, p.encodedTransaction, p.merkleProof, p.continuityProof
        );
        if (!ok) revert ProofRejected();
    }

    /**
     * Rejects anything still inside the reorg window.
     *
     * Written as an addition rather than `tip - depth` on purpose: subtraction
     * underflows and reverts opaquely on a chain whose attested tip is lower
     * than the configured depth, which is a real state for a freshly added
     * chain.
     */
    function _requireFinal(uint64 chainKey, uint64 height) private view {
        IChainInfo.HeightHashResult memory tip =
            CHAIN_INFO.get_latest_attestation_height_and_hash(chainKey);
        uint64 depth = minConfirmations[chainKey];
        if (!tip.exists || height + depth > tip.height) {
            revert NotFinal(height, tip.exists ? tip.height : 0, depth);
        }
    }

    function _singlePledgeLog(bytes calldata encodedTransaction)
        private
        pure
        returns (EvmV1Decoder.LogEntry memory)
    {
        bytes memory tx_ = encodedTransaction;

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(tx_);
        if (receipt.receiptStatus != 1) revert SourceTransactionReverted();

        EvmV1Decoder.LogEntry[] memory matched =
            EvmV1Decoder.getLogsByEventSignature(receipt, PLEDGED_SIG);

        if (matched.length == 0) revert NoPledgeLog();
        if (matched.length > 1) revert AmbiguousPledgeLogs(matched.length);

        return matched[0];
    }

    function _burnNullifier(Proof calldata p) private {
        uint64 txIndex = PROVER.calculateTxIndex(p.merkleProof);
        bytes32 nullifier = keccak256(abi.encode(p.chainKey, p.height, txIndex));
        if (consumed[nullifier]) revert ProofAlreadyConsumed(nullifier);
        consumed[nullifier] = true;
    }

    /// Pledged(address indexed token, uint256 indexed tokenId, address indexed borrower, uint256 amount, bytes32 instanceId)
    function _decodePledge(EvmV1Decoder.LogEntry memory log)
        private
        pure
        returns (address token, uint256 tokenId, address borrower, uint256 amount, bytes32 instanceId)
    {
        token = address(uint160(uint256(log.topics[1])));
        tokenId = uint256(log.topics[2]);
        borrower = address(uint160(uint256(log.topics[3])));
        (amount, instanceId) = abi.decode(log.data, (uint256, bytes32));
    }
}
