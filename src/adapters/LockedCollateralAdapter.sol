// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IPledgeAdapter} from "../interfaces/IPledgeAdapter.sol";
import {EvmV1Decoder} from "../vendor/EvmV1Decoder.sol";

/**
 * Reference adapter, for a protocol whose lifecycle events look like this:
 *
 *   CollateralLocked  (bytes32 indexed positionId, address indexed nftContract,
 *                      address indexed owner, uint256 nftId, uint256 principal)
 *   ObligationCleared (same shape)
 *   CollateralUnlocked(same shape)
 *
 * Nothing about that schema matches the registry's native one: the instance id
 * leads the topics, the token id lives in the data, and the amount trails it.
 * The adapter is the whole integration, and the protocol is not touched.
 *
 * It is pure, it holds no state, and it is short on purpose. An adapter decides
 * what a log means rather than merely which logs are read, which makes it the
 * weakest link in the chain and the one worth keeping readable in one sitting.
 * That is caveat 9.
 */
contract LockedCollateralAdapter is IPledgeAdapter {
    bytes32 public constant LOCKED_SIG =
        keccak256("CollateralLocked(bytes32,address,address,uint256,uint256)");
    bytes32 public constant CLEARED_SIG =
        keccak256("ObligationCleared(bytes32,address,address,uint256,uint256)");
    bytes32 public constant UNLOCKED_SIG =
        keccak256("CollateralUnlocked(bytes32,address,address,uint256,uint256)");

    error UnexpectedTopics(uint256 count);

    function eventSignatures()
        external
        pure
        returns (bytes32 pledgeSig, bytes32 settleSig, bytes32 releaseSig)
    {
        return (LOCKED_SIG, CLEARED_SIG, UNLOCKED_SIG);
    }

    function translate(uint8, EvmV1Decoder.LogEntry calldata log)
        external
        pure
        returns (
            address collateralToken,
            uint256 tokenId,
            address borrower,
            uint256 amount,
            bytes32 instanceId
        )
    {
        if (log.topics.length != 4) revert UnexpectedTopics(log.topics.length);

        instanceId = log.topics[1];
        collateralToken = address(uint160(uint256(log.topics[2])));
        borrower = address(uint160(uint256(log.topics[3])));
        (tokenId, amount) = abi.decode(log.data, (uint256, uint256));
    }
}
