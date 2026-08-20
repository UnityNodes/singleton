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

    /**
     * A proof names the log it is about.
     *
     * `emitter` and `logIndex` are not conveniences. The party who sends a
     * transaction on the source chain is usually the borrower, so anything the
     * registry infers by scanning that transaction's receipt is chosen by the
     * borrower. Two separate reviews found the same shape of attack through
     * that inference: a log the borrower arranged made a genuine pledge
     * unregisterable, and an unregisterable pledge is first to file defeated.
     *
     * So the relayer states which log it is filing and the registry only
     * checks. Nothing is searched for, nothing is counted, and a receipt full
     * of decoys changes nothing about what a relayer can file.
     */
    struct Proof {
        uint64 chainKey;
        uint64 height;
        address emitter;
        uint32 logIndex;
        bytes encodedTransaction;
        IBlockProver.MerkleProof merkleProof;
        IBlockProver.ContinuityProof continuityProof;
    }

    /**
     * Many proofs sharing one continuity proof.
     *
     * The arrays are parallel and every one of them is named by the relayer for
     * the same reason the single form names its log: nothing here is searched
     * for, so a receipt full of decoys cannot change which pledge gets filed.
     */
    struct BatchProof {
        uint64 chainKey;
        uint64[] heights;
        address[] emitters;
        uint32[] logIndexes;
        bytes[] encodedTransactions;
        IBlockProver.MerkleProof[] merkleProofs;
        IBlockProver.ContinuityProof sharedContinuityProof;
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
    error LogIndexOutOfRange(uint256 offered, uint256 length);
    error LogNotFromEmitter(address named, address wrote);
    error WrongEventSignature(bytes32 topic0, uint8 kind);
    error EmitterNotAllowed(uint64 chainKey, address emitter);
    error StaleCollision(uint64 offered, uint64 incumbent);
    error EmptyBatch();
    error BatchLengthMismatch(uint256 expected);
    error ProofAlreadyConsumed(bytes32 nullifier);
    error AssetNotFree(bytes32 assetKey, address incumbent);
    error AssetNotPledged(bytes32 assetKey);
    error NotTheIncumbent(address incumbent, address claimant);
    error WrongInstance(bytes32 expected, bytes32 offered);
    error NoCollisionToReport(bytes32 assetKey);
    error TransitionUnsupported(address emitter, uint8 kind);
    error ConfirmationsNotSet(uint64 chainKey);
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

    /**
     * A depth of zero accepts a pledge one block deep, which is precisely the
     * reorg window this setting exists to close. There is no safe default for
     * it, so zero is refused rather than stored and a chain stays unreadable
     * until somebody states a depth for it.
     */
    function setMinConfirmations(uint64 chainKey, uint64 depth) external onlyAdmin {
        if (depth == 0) revert ConfirmationsNotSet(chainKey);
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
        _requireAllowed(p);
        SourceEvent memory pledge = _readSourceEvent(p, KIND_PLEDGE);
        assetKey = _recordPledge(p.chainKey, p.height, pledge);
    }

    /**
     * Records many pledges from one continuity proof.
     *
     * A register that witnesses other protocols' lending is a many-at-once
     * workload by nature: a relayer catching up on a block range holds a dozen
     * pledges, not one. The precompile's batch form verifies an array of
     * transactions against a single continuity proof, and that proof is the
     * expensive part, so the saving grows with the batch rather than being a
     * constant.
     *
     * All or nothing on purpose. If any pledge in the batch cannot be filed the
     * whole transaction reverts, because partial success would leave a relayer
     * unable to answer "did my pledge land" from the transaction alone, and in a
     * first to file registry that question is the only one that matters.
     *
     * The shared continuity proof is anchored at the lowest header the prover
     * built it from, so a batch has to contain an item at that header. Measured
     * against the live precompile, not read from a document: a batch missing it
     * is refused with a continuity mismatch, and every forged member of an
     * otherwise honest batch is refused too.
     */
    function registerPledges(BatchProof calldata b)
        external
        returns (bytes32[] memory assetKeys)
    {
        uint256 count = b.heights.length;
        if (count == 0) revert EmptyBatch();
        if (
            b.emitters.length != count || b.logIndexes.length != count
                || b.encodedTransactions.length != count || b.merkleProofs.length != count
        ) revert BatchLengthMismatch(count);

        bool ok = PROVER.verify(
            b.chainKey, b.heights, b.encodedTransactions, b.merkleProofs, b.sharedContinuityProof
        );
        if (!ok) revert ProofRejected();

        assetKeys = new bytes32[](count);
        for (uint256 i; i < count; i++) {
            _requireFinal(b.chainKey, b.heights[i]);
            if (!allowedEmitter[b.chainKey][b.emitters[i]]) {
                revert EmitterNotAllowed(b.chainKey, b.emitters[i]);
            }
            _burnBatchNullifier(b, i, KIND_PLEDGE);

            SourceEvent memory pledge = _readEvent(
                b.chainKey, b.encodedTransactions[i], b.emitters[i], b.logIndexes[i], KIND_PLEDGE
            );
            assetKeys[i] = _recordPledge(b.chainKey, b.heights[i], pledge);
        }
    }

    function _recordPledge(uint64 chainKey, uint64 height, SourceEvent memory pledge)
        private
        returns (bytes32 assetKey)
    {
        if (pledge.token == address(0)) revert CollateralNotIdentified();
        assetKey = _assetKey(chainKey, pledge.token, pledge.tokenId);

        Record storage r = _records[assetKey];
        if (r.state != AssetState.FREE) revert AssetNotFree(assetKey, r.emitter);

        bytes32 instanceKey = _instanceKey(chainKey, pledge.emitter, pledge.instanceId);
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
            chainKey: chainKey,
            sourceHeight: height,
            recordedAt: uint64(block.timestamp)
        });

        _issueCertificate(pledge.emitter, uint256(assetKey));

        emit PledgeRecorded(
            assetKey, pledge.emitter, pledge.borrower, chainKey, pledge.amount, pledge.instanceId
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
        _requireAllowed(p);
        SourceEvent memory pledge = _readSourceEvent(p, KIND_PLEDGE);

        if (pledge.token == address(0)) revert CollateralNotIdentified();
        bytes32 assetKey = _assetKey(p.chainKey, pledge.token, pledge.tokenId);

        Record storage r = _records[assetKey];
        /*
          Only a live lien can be collided with. A settled one has been repaid,
          so a later borrow against the same asset is somebody's legitimate next
          loan rather than a second claim on the first, and filing it as a
          refusal would put an accusation on the record of a borrower who did
          nothing wrong.
        */
        if (r.state != AssetState.PLEDGED) revert NoCollisionToReport(assetKey);
        if (r.instanceId == pledge.instanceId && r.emitter == pledge.emitter) {
            revert NoCollisionToReport(assetKey);
        }
        /*
          A pledge older than the one on file is not evidence that two lenders
          hold the same asset now. Without this, a lien that was settled and
          released years ago can be filed against whoever holds the asset today,
          and the list that exists to say "somebody already tried" fills with
          liens that never overlapped.
        */
        if (p.height < r.sourceHeight) revert StaleCollision(p.height, r.sourceHeight);

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

        /*
          The refusals go with the lien they were filed against.
          
          A collision says "somebody tried to lend against this asset while that
          lender held it". Once the lien is released that sentence has no
          subject, and keeping the list produced a record where the incumbent
          appeared as a refused claimant against itself: the lender that lost
          the first race files legitimately once the asset is free, and its own
          earlier refusal was still on file describing the very lien now on
          record. The DoublePledge event is the permanent evidence and stays in
          the log forever; this array is a convenience view of the current lien.
        */
        _revokeCertificate(uint256(assetKey));
        delete _collisions[assetKey];
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
        /*
          ERC-165 only. Claiming ERC-721 would be false: every transfer and
          approval on this certificate reverts Soulbound, so a wallet that
          believed the claim would offer a move it cannot make.
        */
        return interfaceId == 0x01ffc9a7;
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

        found = _readEvent(p.chainKey, p.encodedTransaction, p.emitter, p.logIndex, kind);
    }

    /**
     * The named log of a proven transaction, read as the named transition.
     *
     * Separate from proof verification because the batch form verifies every
     * transaction in one precompile call and then reads each of them, while the
     * single form verifies and reads one. What a log means must not depend on
     * which of those two paths asked.
     */
    function _readEvent(
        uint64 chainKey,
        bytes calldata encodedTransaction,
        address emitter,
        uint32 logIndex,
        uint8 kind
    ) private view returns (SourceEvent memory found) {
        EvmV1Decoder.ReceiptFields memory receipt =
            EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        if (receipt.receiptStatus != 1) revert SourceTransactionReverted();

        if (logIndex >= receipt.receiptLogs.length) {
            revert LogIndexOutOfRange(logIndex, receipt.receiptLogs.length);
        }
        EvmV1Decoder.LogEntry memory log = receipt.receiptLogs[logIndex];
        if (log.address_ != emitter) revert LogNotFromEmitter(emitter, log.address_);

        address adapter = adapterOf[chainKey][emitter];
        _requireSignature(adapter, emitter, kind, log);

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
     * The allowlist gates entry, not exit.
     *
     * Registering a pledge or filing a refusal creates a record, so those need
     * an emitter the registry has agreed to read. Settlement and release only
     * ever close a record the emitter already holds, and are checked against
     * incumbency instead. Requiring the allowlist there too would mean that
     * excluding a protocol traps every asset it had already pledged, punishing
     * borrowers who are not party to that decision.
     */
    function _requireAllowed(Proof calldata p) private view {
        if (!allowedEmitter[p.chainKey][p.emitter]) {
            revert EmitterNotAllowed(p.chainKey, p.emitter);
        }
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

    /**
     * The named log has to be the transition the caller says it is.
     *
     * A protocol may end a lien in more than one way, so a transition accepts
     * several topic zeroes and any one of them is enough.
     */
    function _requireSignature(
        address adapter,
        address emitter,
        uint8 kind,
        EvmV1Decoder.LogEntry memory log
    ) private view {
        bytes32 topic0 = log.topics.length == 0 ? bytes32(0) : log.topics[0];
        bytes32[] memory signatures = _signaturesFor(adapter, emitter, kind);
        for (uint256 i; i < signatures.length; i++) {
            if (signatures[i] == topic0) return;
        }
        revert WrongEventSignature(topic0, kind);
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
        if (depth == 0) revert ConfirmationsNotSet(chainKey);
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
        _burn(domain, p.chainKey, p.height, p.merkleProof, p.logIndex);
    }

    /// The same nullifier for one member of a batch, so a proof cannot be spent
    /// once alone and once inside a batch.
    function _burnBatchNullifier(BatchProof calldata b, uint256 i, uint8 domain) private {
        _burn(domain, b.chainKey, b.heights[i], b.merkleProofs[i], b.logIndexes[i]);
    }

    function _burn(
        uint8 domain,
        uint64 chainKey,
        uint64 height,
        IBlockProver.MerkleProof calldata merkleProof,
        uint32 logIndex
    ) private {
        uint64 txIndex = PROVER.calculateTxIndex(merkleProof);
        bytes32 nullifier = keccak256(abi.encode(domain, chainKey, height, txIndex, logIndex));
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
    function _resolveAsset(uint64 chainKey, SourceEvent memory ev) private view returns (bytes32) {
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
