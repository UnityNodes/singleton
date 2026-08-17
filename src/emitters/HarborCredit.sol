// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IDeed721 {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/**
 * Harbor Credit: a non-custodial lien desk on Sepolia.
 *
 * One of the two unrelated lenders in the demo. It shares no code, no storage
 * layout and no deployment path with Meridian; the only thing the two agree on
 * is the shape of the log they emit, which is exactly the point. The registry
 * on Creditcoin reads that log through an inclusion proof and neither lender
 * knows the registry exists.
 *
 * Non-custodial by design: the borrower keeps the deed. Custody would make the
 * double pledge impossible and there would be nothing to collide, which is
 * caveat 6.
 */
contract HarborCredit {
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
        uint64 openedAt;
    }

    address public immutable desk;
    uint256 public lienCounter;

    mapping(bytes32 => Lien) public lienByCollateral;

    error NotDesk();
    error NotTheHolder(address holder);
    error LienAlreadyOpen();
    error LienNotOpen();
    error LienNotRepaid();
    error ZeroPrincipal();

    constructor() {
        desk = msg.sender;
    }

    function openLien(address collateral, uint256 tokenId, uint256 principal)
        external
        returns (bytes32 instanceId)
    {
        if (principal == 0) revert ZeroPrincipal();

        address holder = IDeed721(collateral).ownerOf(tokenId);
        if (holder != msg.sender) revert NotTheHolder(holder);

        bytes32 slot = keccak256(abi.encodePacked(collateral, tokenId));
        Lien storage lien = lienByCollateral[slot];
        if (lien.state == LienState.OPEN) revert LienAlreadyOpen();

        lienCounter += 1;
        instanceId = keccak256(abi.encode(address(this), collateral, tokenId, lienCounter));

        lienByCollateral[slot] = Lien({
            state: LienState.OPEN,
            borrower: msg.sender,
            collateral: collateral,
            tokenId: tokenId,
            principal: principal,
            instanceId: instanceId,
            openedAt: uint64(block.timestamp)
        });

        emit Pledged(collateral, tokenId, msg.sender, principal, instanceId);
    }

    function repayLien(address collateral, uint256 tokenId) external {
        bytes32 slot = keccak256(abi.encodePacked(collateral, tokenId));
        Lien storage lien = lienByCollateral[slot];
        if (lien.state != LienState.OPEN) revert LienNotOpen();

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
