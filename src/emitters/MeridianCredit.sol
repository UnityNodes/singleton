// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IAssetRegistry721 {
    function ownerOf(uint256) external view returns (address);
}

/**
 * Meridian Revolving Credit: the second, unrelated lender on Sepolia.
 *
 * A different product from Harbor. Meridian underwrites a credit limit per
 * obligor first, then lets the obligor draw against an asset it never takes
 * custody of. Positions live in an array, not a mapping, the instance id is
 * derived from a per-obligor sequence rather than a global counter, and nothing
 * here is imported from or aware of Harbor.
 *
 * The two contracts agree on one thing only: the shape of the log. That
 * agreement is what the registry needs, and it needs it from neither of them
 * voluntarily.
 */
contract MeridianCredit {
    event Pledged(
        address indexed collateralToken,
        uint256 indexed tokenId,
        address indexed borrower,
        uint256 amount,
        bytes32 pledgeInstanceId
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

    uint8 public constant STATUS_DRAWN = 1;
    uint8 public constant STATUS_REPAID = 2;
    uint8 public constant STATUS_CLOSED = 3;

    struct Position {
        address asset;
        uint256 assetId;
        address obligor;
        uint256 drawn;
        bytes32 ref;
        uint8 status;
    }

    address public underwriter;
    Position[] public positions;

    mapping(address => uint256) public sequenceOf;
    mapping(address => uint256) public creditLimitOf;
    mapping(address => uint256) public outstandingOf;

    error NotUnderwriter();
    error NoLimit(address obligor);
    error OverLimit(uint256 requested, uint256 headroom);
    error AssetNotHeldByObligor(address holder);
    error NoSuchPosition(uint256 positionId);
    error WrongStatus(uint8 status);

    modifier onlyUnderwriter() {
        if (msg.sender != underwriter) revert NotUnderwriter();
        _;
    }

    constructor(address underwriter_) {
        underwriter = underwriter_ == address(0) ? msg.sender : underwriter_;
    }

    function setCreditLimit(address obligor, uint256 limit) external onlyUnderwriter {
        creditLimitOf[obligor] = limit;
    }

    function drawAgainst(address asset, uint256 assetId, uint256 amount)
        external
        returns (uint256 positionId)
    {
        uint256 limit = creditLimitOf[msg.sender];
        if (limit == 0) revert NoLimit(msg.sender);

        uint256 outstanding = outstandingOf[msg.sender];
        if (outstanding + amount > limit) revert OverLimit(amount, limit - outstanding);

        address holder = IAssetRegistry721(asset).ownerOf(assetId);
        if (holder != msg.sender) revert AssetNotHeldByObligor(holder);

        uint256 seq = sequenceOf[msg.sender] + 1;
        sequenceOf[msg.sender] = seq;
        outstandingOf[msg.sender] = outstanding + amount;

        bytes32 ref = keccak256(abi.encode(block.chainid, address(this), msg.sender, seq));

        positionId = positions.length;
        positions.push(
            Position({
                asset: asset,
                assetId: assetId,
                obligor: msg.sender,
                drawn: amount,
                ref: ref,
                status: STATUS_DRAWN
            })
        );

        emit Pledged(asset, assetId, msg.sender, amount, ref);
    }

    /// Only the obligor clears their own draw, for the reason Harbor states.
    function repay(uint256 positionId) external {
        Position storage p = _position(positionId);
        if (p.status != STATUS_DRAWN) revert WrongStatus(p.status);
        if (msg.sender != p.obligor) revert AssetNotHeldByObligor(p.obligor);

        p.status = STATUS_REPAID;
        outstandingOf[p.obligor] -= p.drawn;

        emit Settled(p.asset, p.assetId, p.obligor, p.drawn, p.ref);
    }

    function closePosition(uint256 positionId) external onlyUnderwriter {
        Position storage p = _position(positionId);
        if (p.status != STATUS_REPAID) revert WrongStatus(p.status);

        p.status = STATUS_CLOSED;

        emit Released(p.asset, p.assetId, p.obligor, p.drawn, p.ref);
    }

    function positionCount() external view returns (uint256) {
        return positions.length;
    }

    function _position(uint256 positionId) private view returns (Position storage) {
        if (positionId >= positions.length) revert NoSuchPosition(positionId);
        return positions[positionId];
    }
}
