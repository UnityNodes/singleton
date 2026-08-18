// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IVaultCollateral {
    function ownerOf(uint256) external view returns (address);
}

/**
 * A third party lender that never heard of Singleton and emits its own schema.
 *
 * Everything here is deliberately in the wrong place for the registry's native
 * decoder: the position id is the first topic rather than trailing data, the
 * token id sits in the data instead of a topic, and the amount comes after it.
 * Reading this protocol is exactly what an adapter is for.
 */
contract AtlasVault {
    event CollateralLocked(
        bytes32 indexed positionId,
        address indexed nftContract,
        address indexed owner,
        uint256 nftId,
        uint256 principal
    );

    event ObligationCleared(
        bytes32 indexed positionId,
        address indexed nftContract,
        address indexed owner,
        uint256 nftId,
        uint256 principal
    );

    event CollateralUnlocked(
        bytes32 indexed positionId,
        address indexed nftContract,
        address indexed owner,
        uint256 nftId,
        uint256 principal
    );

    struct Position {
        address nftContract;
        uint256 nftId;
        address owner;
        uint256 principal;
        bool open;
    }

    mapping(bytes32 => Position) public positionOf;
    uint256 public locks;

    error NotTheOwner(address owner);
    error NoSuchPosition();

    function lock(address nftContract, uint256 nftId, uint256 principal)
        external
        returns (bytes32 positionId)
    {
        address owner = IVaultCollateral(nftContract).ownerOf(nftId);
        if (owner != msg.sender) revert NotTheOwner(owner);

        locks += 1;
        positionId = keccak256(abi.encodePacked("atlas", address(this), locks));
        positionOf[positionId] =
            Position({nftContract: nftContract, nftId: nftId, owner: msg.sender, principal: principal, open: true});

        emit CollateralLocked(positionId, nftContract, msg.sender, nftId, principal);
    }

    function clear(bytes32 positionId) external {
        Position memory p = _open(positionId);
        emit ObligationCleared(positionId, p.nftContract, p.owner, p.nftId, p.principal);
    }

    function unlock(bytes32 positionId) external {
        Position memory p = _open(positionId);
        positionOf[positionId].open = false;
        emit CollateralUnlocked(positionId, p.nftContract, p.owner, p.nftId, p.principal);
    }

    function _open(bytes32 positionId) private view returns (Position memory p) {
        p = positionOf[positionId];
        if (!p.open) revert NoSuchPosition();
    }
}
