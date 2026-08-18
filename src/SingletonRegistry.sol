// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IBlockProver, BlockProverLib} from "./interfaces/IBlockProver.sol";
import {IChainInfo, ChainInfoLib} from "./interfaces/IChainInfo.sol";
import {IPledgeAdapter} from "./interfaces/IPledgeAdapter.sol";
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
 *
 * Four proofs move one asset through its whole life: the pledge, a collision
 * report against it, the settlement, the release. Each is an inclusion proof of
 * a separate real log, so the source chain carries every transition rather than
 * only the first one.
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

    /// A refused second pledge, kept because the refusal is worth more than the
    /// silence. A lender consulting the registry wants to know that somebody
    /// already tried, not only that the asset is taken.
    struct Collision {
        address emitter;
        address borrower;
        uint256 amount;
        bytes32 instanceId;
        uint64 chainKey;
        uint64 sourceHeight;
        uint64 reportedAt;
    }

    struct Proof {
        uint64 chainKey;
        uint64 height;
        bytes encodedTransaction;
        IBlockProver.MerkleProof merkleProof;
        IBlockProver.ContinuityProof continuityProof;
    }

    /// One lifecycle event read out of a source chain receipt.
    struct SourceEvent {
        address emitter;
        address token;
        uint256 tokenId;
        address borrower;
        uint256 amount;
        bytes32 instanceId;
    }

    // ---------------------------------------------------------- constants

    uint8 internal constant KIND_PLEDGE = 0;
    uint8 internal constant KIND_SETTLE = 1;
    uint8 internal constant KIND_RELEASE = 2;

    /// Not a transition, so not a kind: its own nullifier domain, because a
    /// report must not spend the proof of the pledge it reports.
    uint8 internal constant DOMAIN_COLLISION = 3;

    /// keccak256("Pledged(address,uint256,address,uint256,bytes32)")
    bytes32 public constant PLEDGED_SIG =
        0xbfb86e5d7136ec550644fc6d0fcc8e6504e3dc19aacdeec2dec3d459854b4823;

    /// keccak256("Settled(address,uint256,address,uint256,bytes32)")
    bytes32 public constant SETTLED_SIG =
        0xb3c91992f94a9a4ee86e93a2b5667f74e63c7f4c1fd7bf3ca4478bd988909abe;

    /// keccak256("Released(address,uint256,address,uint256,bytes32)")
    bytes32 public constant RELEASED_SIG =
        0x8b9bd33ecbc303dc8b7152ab074f3eead0583d0a5717f45a39037a1ac482f17f;

    IBlockProver public constant PROVER = IBlockProver(0x0000000000000000000000000000000000000FD2);
    IChainInfo public constant CHAIN_INFO = IChainInfo(0x0000000000000000000000000000000000000fD3);

    string public constant name = "Singleton Lien Certificate";
    string public constant symbol = "LIEN";

    // -------------------------------------------------------------- state

    address public admin;

    /// Which emitters are read at all, per chain. Governs selection, never truth.
    mapping(uint64 => mapping(address => bool)) public allowedEmitter;

    /// Optional translator for emitters that do not speak the native schema.
    /// Zero means the emitter's logs are read directly.
    mapping(uint64 => mapping(address => address)) public adapterOf;

    /// Confirmation depth before a source block is accepted. Stricter for L2s.
    mapping(uint64 => uint64) public minConfirmations;

    mapping(bytes32 => Record) private _records;
    mapping(bytes32 => Collision[]) private _collisions;

    /**
     * Which asset an emitter's open lien refers to, keyed by chain, emitter and
     * instance id.
     *
     * Some protocols name the collateral when a loan is taken and stop naming it
     * afterwards: Blur's Blend publishes `Repay(lienId, collection)` and no token
     * id at all. Without this index the registry could open such a lien and never
     * close it. With it, a release that carries only the instance resolves to the
     * asset the same emitter opened under that instance, and nothing else.
     */
    mapping(bytes32 => bytes32) private _assetByInstance;

    /// One proof, one use, per operation. Keyed by chain, block, transaction
    /// index and the operation itself, so reporting a collision does not spend
    /// the proof that would later register the same pledge legitimately.
    mapping(bytes32 => bool) public consumed;

    /// Soulbound certificate of priority, one per claimed asset, held by the
    /// emitter that filed first. Token id is the asset key.
    mapping(uint256 => address) private _certificateHolder;
    mapping(address => uint256) private _certificateBalance;

    // ------------------------------------------------------------- events

    event PledgeRecorded(
        bytes32 indexed assetKey,
        address indexed emitter,
        address indexed borrower,
        uint64 chainKey,
        uint256 amount,
        bytes32 instanceId
    );

    event LienSettled(bytes32 indexed assetKey, address indexed emitter, bytes32 instanceId);

    event LienReleased(bytes32 indexed assetKey, address indexed emitter, bytes32 instanceId);

    /// A second pledge that was refused, recorded on purpose. The refusal inside
    /// registerPledge is a revert, and a revert discards its own logs, so this
    /// is emitted from reportCollision instead.
    event DoublePledge(
        bytes32 indexed assetKey,
        address indexed incumbent,
        address indexed rejected,
        uint64 chainKey,
        uint64 sourceHeight
    );

    event EmitterAllowed(uint64 indexed chainKey, address indexed emitter, bool allowed);

    event AdapterSet(uint64 indexed chainKey, address indexed emitter, address adapter);

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

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
    error AssetNotPledged(bytes32 assetKey);
    error NotTheIncumbent(address incumbent, address claimant);
    error WrongInstance(bytes32 expected, bytes32 offered);
    error NoCollisionToReport(bytes32 assetKey);
    error TransitionUnsupported(address emitter, uint8 kind);
    error CollateralNotIdentified();
    error InstanceAlreadyOpen(address emitter, bytes32 instanceId);
    error UnknownInstance(address emitter, bytes32 instanceId);
    error Soulbound();
    error NoCertificate(uint256 tokenId);

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

    function setAdapter(uint64 chainKey, address emitter, address adapter) external onlyAdmin {
        adapterOf[chainKey][emitter] = adapter;
        emit AdapterSet(chainKey, emitter, adapter);
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
        _burnNullifier(p, KIND_PLEDGE);
        SourceEvent memory pledge = _readSourceEvent(p, KIND_PLEDGE);

        if (pledge.token == address(0)) revert CollateralNotIdentified();
        assetKey = _assetKey(p.chainKey, pledge.token, pledge.tokenId);

        Record storage r = _records[assetKey];
        if (r.state != AssetState.FREE) revert AssetNotFree(assetKey, r.emitter);

        bytes32 instanceKey = _instanceKey(p.chainKey, pledge.emitter, pledge.instanceId);
        if (_assetByInstance[instanceKey] != bytes32(0)) {
            revert InstanceAlreadyOpen(pledge.emitter, pledge.instanceId);
        }
        _assetByInstance[instanceKey] = assetKey;

        _records[assetKey] = Record({
            state: AssetState.PLEDGED,
            emitter: pledge.emitter,
            borrower: pledge.borrower,
            amount: pledge.amount,
            instanceId: pledge.instanceId,
            chainKey: p.chainKey,
            sourceHeight: p.height,
            recordedAt: uint64(block.timestamp)
        });

        _issueCertificate(pledge.emitter, uint256(assetKey));

        emit PledgeRecorded(
            assetKey, pledge.emitter, pledge.borrower, p.chainKey, pledge.amount, pledge.instanceId
        );
    }

    /**
     * Records a second pledge that the registry refuses.
     *
     * The refusal itself lives in registerPledge as a revert, which is what an
     * integrating protocol wants and what the demo shows. A revert also throws
     * away its own logs, so the evidence would vanish with it. This path proves
     * the same losing pledge and keeps it, without touching the incumbent.
     */
    function reportCollision(Proof calldata p) external returns (uint256 index) {
        _burnNullifier(p, DOMAIN_COLLISION);
        SourceEvent memory pledge = _readSourceEvent(p, KIND_PLEDGE);

        bytes32 assetKey = _assetKey(p.chainKey, pledge.token, pledge.tokenId);

        Record storage r = _records[assetKey];
        if (r.state == AssetState.FREE) revert NoCollisionToReport(assetKey);
        if (r.instanceId == pledge.instanceId && r.emitter == pledge.emitter) {
            revert NoCollisionToReport(assetKey);
        }

        index = _collisions[assetKey].length;
        _collisions[assetKey].push(
            Collision({
                emitter: pledge.emitter,
                borrower: pledge.borrower,
                amount: pledge.amount,
                instanceId: pledge.instanceId,
                chainKey: p.chainKey,
                sourceHeight: p.height,
                reportedAt: uint64(block.timestamp)
            })
        );

        emit DoublePledge(assetKey, r.emitter, pledge.emitter, p.chainKey, p.height);
    }

    /**
     * Marks the debt behind a lien as repaid, proven by the emitter's own log.
     *
     * The instance id binds this proof to the lien currently on file. Without
     * it, a settlement proved for last year's lien would settle this year's.
     */
    function registerSettlement(Proof calldata p) external returns (bytes32 assetKey) {
        _burnNullifier(p, KIND_SETTLE);
        SourceEvent memory ev = _readSourceEvent(p, KIND_SETTLE);

        assetKey = _resolveAsset(p.chainKey, ev);
        Record storage r = _records[assetKey];

        if (r.state != AssetState.PLEDGED) revert AssetNotPledged(assetKey);
        if (r.emitter != ev.emitter) revert NotTheIncumbent(r.emitter, ev.emitter);
        if (r.instanceId != ev.instanceId) revert WrongInstance(r.instanceId, ev.instanceId);

        r.state = AssetState.SETTLED;

        emit LienSettled(assetKey, ev.emitter, ev.instanceId);
    }

    /**
     * Returns the asset to the pool, proven by the emitter's own log.
     *
     * Accepted from PLEDGED as well as SETTLED. A lender may always let its own
     * collateral go, whether or not it was repaid, and refusing that would trap
     * assets in the registry that the source chain has already freed.
     */
    function registerRelease(Proof calldata p) external returns (bytes32 assetKey) {
        _burnNullifier(p, KIND_RELEASE);
        SourceEvent memory ev = _readSourceEvent(p, KIND_RELEASE);

        assetKey = _resolveAsset(p.chainKey, ev);
        Record storage r = _records[assetKey];

        if (r.state == AssetState.FREE) revert AssetNotPledged(assetKey);
        if (r.emitter != ev.emitter) revert NotTheIncumbent(r.emitter, ev.emitter);
        if (r.instanceId != ev.instanceId) revert WrongInstance(r.instanceId, ev.instanceId);

        _revokeCertificate(uint256(assetKey));
        delete _assetByInstance[_instanceKey(p.chainKey, ev.emitter, ev.instanceId)];
        delete _records[assetKey];

        emit LienReleased(assetKey, ev.emitter, ev.instanceId);
    }

    // ------------------------------------------------------------- views

    function getStatus(bytes32 assetKey) external view returns (Record memory) {
        return _records[assetKey];
    }

    function collisionCount(bytes32 assetKey) external view returns (uint256) {
        return _collisions[assetKey].length;
    }

    function collisionAt(bytes32 assetKey, uint256 index) external view returns (Collision memory) {
        return _collisions[assetKey][index];
    }

    /// The asset an emitter's open lien refers to, or zero if it has none.
    function assetOfInstance(uint64 chainKey, address emitter, bytes32 instanceId)
        external
        view
        returns (bytes32)
    {
        return _assetByInstance[_instanceKey(chainKey, emitter, instanceId)];
    }

    function assetKeyOf(uint64 chainKey, address token, uint256 tokenId)
        external
        pure
        returns (bytes32)
    {
        return _assetKey(chainKey, token, tokenId);
    }

    // ------------------------------------------ soulbound certificate, ERC721

    function ownerOf(uint256 tokenId) public view returns (address holder) {
        holder = _certificateHolder[tokenId];
        if (holder == address(0)) revert NoCertificate(tokenId);
    }

    function balanceOf(address holder) external view returns (uint256) {
        return _certificateBalance[holder];
    }

    function certificateOf(bytes32 assetKey) external view returns (address) {
        return _certificateHolder[uint256(assetKey)];
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0x80ac58cd;
    }

    /**
     * The certificate is evidence of priority, not a tradeable claim. It follows
     * the lien, and the lien is not for sale here: selling the certificate would
     * separate the record from the protocol that actually holds the position.
     */
    function transferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function approve(address, uint256) external pure {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) external pure {
        revert Soulbound();
    }

    function getApproved(uint256) external pure returns (address) {
        return address(0);
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    // ----------------------------------------------------------- internals

    /// Verifies the proof, then reads exactly one log of the requested kind out
    /// of the receipt it carries.
    function _readSourceEvent(Proof calldata p, uint8 kind)
        private
        view
        returns (SourceEvent memory found)
    {
        _requireVerified(p);
        _requireFinal(p.chainKey, p.height);

        EvmV1Decoder.ReceiptFields memory receipt =
            EvmV1Decoder.decodeReceiptFields(p.encodedTransaction);
        if (receipt.receiptStatus != 1) revert SourceTransactionReverted();

        address emitter = _emitterOf(p.chainKey, receipt);
        if (!allowedEmitter[p.chainKey][emitter]) revert EmitterNotAllowed(p.chainKey, emitter);

        address adapter = adapterOf[p.chainKey][emitter];
        EvmV1Decoder.LogEntry memory log =
            _singleLog(receipt, _signaturesFor(adapter, emitter, kind));
        if (log.address_ != emitter) revert EmitterNotAllowed(p.chainKey, log.address_);

        found.emitter = emitter;
        if (adapter == address(0)) {
            found.token = address(uint160(uint256(log.topics[1])));
            found.tokenId = uint256(log.topics[2]);
            found.borrower = address(uint160(uint256(log.topics[3])));
            (found.amount, found.instanceId) = abi.decode(log.data, (uint256, bytes32));
        } else {
            (found.token, found.tokenId, found.borrower, found.amount, found.instanceId) =
                IPledgeAdapter(adapter).translate(kind, log);
        }
    }

    /**
     * The emitter is the first allowlisted address in the receipt, because the
     * adapter, and therefore the signature to search for, is chosen per emitter
     * before any log is read.
     *
     * A receipt carrying logs from two allowlisted protocols resolves to the
     * first of them, and if the matching log turns out to belong to the other
     * the proof is refused rather than misread. Refusing a rare shape is the
     * safe direction; nothing here can bind a log to the wrong emitter.
     */
    function _emitterOf(uint64 chainKey, EvmV1Decoder.ReceiptFields memory receipt)
        private
        view
        returns (address)
    {
        uint256 count = receipt.receiptLogs.length;
        for (uint256 i; i < count; i++) {
            address candidate = receipt.receiptLogs[i].address_;
            if (allowedEmitter[chainKey][candidate]) return candidate;
        }
        return count == 0 ? address(0) : receipt.receiptLogs[0].address_;
    }

    /**
     * Which topic zeroes carry this transition for this emitter.
     *
     * A protocol may end a lien in more than one way, so a transition can name
     * several events. An adapter that names none has declared the transition
     * unprovable for its protocol, which is refused rather than approximated.
     */
    function _signaturesFor(address adapter, address emitter, uint8 kind)
        private
        view
        returns (bytes32[] memory signatures)
    {
        if (adapter == address(0)) {
            signatures = new bytes32[](1);
            signatures[0] = kind == KIND_PLEDGE
                ? PLEDGED_SIG
                : (kind == KIND_SETTLE ? SETTLED_SIG : RELEASED_SIG);
            return signatures;
        }

        signatures = IPledgeAdapter(adapter).signaturesFor(kind);
        if (signatures.length == 0) revert TransitionUnsupported(emitter, kind);
    }

    /// Exactly one log across every signature the transition accepts. Two would
    /// be a batch, and a batch is caveat 7.
    function _singleLog(EvmV1Decoder.ReceiptFields memory receipt, bytes32[] memory signatures)
        private
        pure
        returns (EvmV1Decoder.LogEntry memory log)
    {
        uint256 found;
        for (uint256 i; i < signatures.length; i++) {
            EvmV1Decoder.LogEntry[] memory matched =
                EvmV1Decoder.getLogsByEventSignature(receipt, signatures[i]);
            if (matched.length == 0) continue;
            found += matched.length;
            if (found > 1) revert AmbiguousPledgeLogs(found);
            log = matched[0];
        }
        if (found == 0) revert NoPledgeLog();
    }

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

    /**
     * Spends the proof for one operation, before anything external is called.
     *
     * The domain matters: reporting a collision must not spend the proof that
     * would register the same pledge legitimately once the asset is released.
     */
    function _burnNullifier(Proof calldata p, uint8 domain) private {
        uint64 txIndex = PROVER.calculateTxIndex(p.merkleProof);
        bytes32 nullifier = keccak256(abi.encode(domain, p.chainKey, p.height, txIndex));
        if (consumed[nullifier]) revert ProofAlreadyConsumed(nullifier);
        consumed[nullifier] = true;
    }

    /**
     * Finds the asset a lifecycle event refers to.
     *
     * An adapter that cannot name the collateral in a later event returns a zero
     * token, and the lien is then found through the instance index. The lookup is
     * keyed by the emitter as well as the instance, so one protocol can never
     * resolve into another protocol's lien.
     */
    function _resolveAsset(uint64 chainKey, SourceEvent memory ev)
        private
        view
        returns (bytes32)
    {
        if (ev.token != address(0)) return _assetKey(chainKey, ev.token, ev.tokenId);

        bytes32 assetKey = _assetByInstance[_instanceKey(chainKey, ev.emitter, ev.instanceId)];
        if (assetKey == bytes32(0)) revert UnknownInstance(ev.emitter, ev.instanceId);
        return assetKey;
    }

    function _instanceKey(uint64 chainKey, address emitter, bytes32 instanceId)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(chainKey, emitter, instanceId));
    }

    function _assetKey(uint64 chainKey, address token, uint256 tokenId)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(chainKey, token, tokenId));
    }

    function _issueCertificate(address holder, uint256 tokenId) private {
        _certificateHolder[tokenId] = holder;
        _certificateBalance[holder] += 1;
        emit Transfer(address(0), holder, tokenId);
    }

    function _revokeCertificate(uint256 tokenId) private {
        address holder = _certificateHolder[tokenId];
        if (holder == address(0)) return;
        delete _certificateHolder[tokenId];
        _certificateBalance[holder] -= 1;
        emit Transfer(holder, address(0), tokenId);
    }
}
