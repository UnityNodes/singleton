// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IDeed721 {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/**
 * ConsentedCredit: a non-custodial lien desk whose pledge log carries its own
 * proof of consent.
 *
 * Every other lender in this project answers caveat 5 the way Harbor and
 * Meridian do: an honest contract checks `ownerOf(tokenId) == msg.sender`
 * before it emits `Pledged`, and the registry trusts that check happened,
 * because the registry only re-verifies that a log exists, never what its
 * author's own code was supposed to guarantee before writing it. A protocol
 * whose logic is wrong, or turns malicious, can still emit a pledge against
 * collateral it never touched.
 *
 * This desk closes that gap the way caveat 5 named but had not built: the
 * owner signs an EIP-712 message naming the exact asset, and that signature
 * travels inside the event, in the clear, next to the claim it backs. Nothing
 * about that requires trusting this contract's own `openLien` check, which is
 * why `ConsentedAdapter` recomputes the same digest independently, on
 * Creditcoin, from the log alone, and refuses to translate a pledge whose
 * signature does not recover to the owner it names. Two honest checks of the
 * same fact, not one checked twice for show: if this contract's version of
 * `openLien` were deleted and replaced with one that skipped the check
 * entirely, a forged pledge would still fail in the adapter, because the
 * adapter never asks this contract anything. It reads the signature and does
 * the arithmetic itself.
 *
 * Settlement and release are unchanged from Harbor's shape and carry no
 * signature, because the fabrication this desk defends against is specifically
 * a pledge against an asset nobody offered, caveat 5's global freeze griefing.
 * A settlement or release only ever closes a record this registry already
 * requires to match its own incumbent, which is a different guard, checked
 * elsewhere.
 */
contract ConsentedCredit {
    event Pledged(
        address indexed collateralToken,
        uint256 indexed tokenId,
        address indexed borrower,
        uint256 amount,
        bytes32 pledgeInstanceId,
        uint256 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    );

    event Settled(
        address indexed collateralToken,
        uint256 indexed tokenId,
        address indexed borrower,
        uint256 amount,
        bytes32 pledgeInstanceId
    );

    event Released(
        address indexed collateralToken,
        uint256 indexed tokenId,
        address indexed borrower,
        uint256 amount,
        bytes32 pledgeInstanceId
    );

    enum LienState {
        NONE,
        OPEN,
        REPAID,
        DISCHARGED
    }

    struct Lien {
        LienState state;
        address borrower;
        address collateral;
        uint256 tokenId;
        uint256 principal;
        bytes32 instanceId;
    }

    /*
      Computed from the literal, not hand hashed and pasted, so there is no
      transcription to get wrong. Both are standard EIP-712 practice: one type
      hash per struct that gets signed, including the domain itself.
    */
    bytes32 private constant DOMAIN_TYPE_HASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 public constant CONSENT_TYPE_HASH =
        keccak256("PledgeConsent(address token,uint256 tokenId,address owner,uint256 nonce)");

    /*
      Pinned rather than read from block.chainid. This contract is deployed on
      Sepolia and nowhere else, and `ConsentedAdapter` on Creditcoin has to
      reconstruct the identical domain from a log alone, with no way to ask
      this contract what chain it thinks it is on. Both sides agreeing by
      construction is safer than both sides agreeing by coincidence of where
      this happens to be deployed.
    */
    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;

    address public immutable desk;
    uint256 public lienCounter;

    mapping(bytes32 => Lien) public lienByCollateral;
    mapping(address => mapping(uint256 => bool)) public consumedNonce;

    error NotDesk();
    error LienAlreadyOpen();
    error LienNotOpen();
    error LienNotRepaid();
    error NotTheBorrower(address borrower);
    error ZeroPrincipal();
    error NonceAlreadyUsed(address owner, uint256 nonce);
    error ConsentDidNotMatchTheOwner(address recovered, address owner);

    constructor() {
        desk = msg.sender;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPE_HASH,
                keccak256(bytes("ConsentedCredit")),
                keccak256(bytes("1")),
                SEPOLIA_CHAIN_ID,
                address(this)
            )
        );
    }

    function consentDigest(address token, uint256 tokenId, address owner, uint256 nonce)
        public
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(abi.encode(CONSENT_TYPE_HASH, token, tokenId, owner, nonce));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    /**
     * Anybody may submit this, which is the point: the desk, a relayer, the
     * owner themselves, it does not matter who sends the transaction, because
     * the transaction proves nothing on its own. What it carries is a
     * signature the owner made over exactly this asset, and that is what both
     * this contract and, independently, the adapter on Creditcoin check.
     */
    function openLien(
        address collateral,
        uint256 tokenId,
        uint256 principal,
        uint256 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (bytes32 instanceId) {
        if (principal == 0) revert ZeroPrincipal();

        address owner = IDeed721(collateral).ownerOf(tokenId);
        if (consumedNonce[owner][nonce]) revert NonceAlreadyUsed(owner, nonce);

        address recovered = ecrecover(consentDigest(collateral, tokenId, owner, nonce), v, r, s);
        if (recovered != owner) revert ConsentDidNotMatchTheOwner(recovered, owner);

        bytes32 slot = keccak256(abi.encodePacked(collateral, tokenId));
        Lien storage lien = lienByCollateral[slot];
        if (lien.state == LienState.OPEN) revert LienAlreadyOpen();

        consumedNonce[owner][nonce] = true;
        lienCounter += 1;
        instanceId = keccak256(abi.encode(address(this), collateral, tokenId, lienCounter));

        lienByCollateral[slot] = Lien({
            state: LienState.OPEN,
            borrower: owner,
            collateral: collateral,
            tokenId: tokenId,
            principal: principal,
            instanceId: instanceId
        });

        emit Pledged(collateral, tokenId, owner, principal, instanceId, nonce, v, r, s);
    }

    function repayLien(address collateral, uint256 tokenId) external {
        bytes32 slot = keccak256(abi.encodePacked(collateral, tokenId));
        Lien storage lien = lienByCollateral[slot];
        if (lien.state != LienState.OPEN) revert LienNotOpen();
        if (msg.sender != lien.borrower) revert NotTheBorrower(lien.borrower);

        lien.state = LienState.REPAID;
        emit Settled(collateral, tokenId, lien.borrower, lien.principal, lien.instanceId);
    }

    function dischargeLien(address collateral, uint256 tokenId) external {
        if (msg.sender != desk) revert NotDesk();

        bytes32 slot = keccak256(abi.encodePacked(collateral, tokenId));
        Lien storage lien = lienByCollateral[slot];
        if (lien.state != LienState.REPAID) revert LienNotRepaid();

        lien.state = LienState.DISCHARGED;
        emit Released(collateral, tokenId, lien.borrower, lien.principal, lien.instanceId);
    }

    function lienState(address collateral, uint256 tokenId) external view returns (LienState) {
        return lienByCollateral[keccak256(abi.encodePacked(collateral, tokenId))].state;
    }
}
