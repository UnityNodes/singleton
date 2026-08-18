// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IPledgeAdapter} from "../interfaces/IPledgeAdapter.sol";
import {EvmV1Decoder} from "../vendor/EvmV1Decoder.sol";

/**
 * Reads Blur's Blend on Ethereum mainnet, proxy
 * 0x29469395eAf6f95920E59F858042f0e28D98a20B.
 *
 * Blend is the opposite of NFTfi in every way that matters to a decoder. Not one
 * of its events indexes anything, so every field arrives in the data, and the
 * lifecycle events are deliberately terse: `Repay(lienId, collection)` names no
 * token id at all.
 *
 * That terseness is why the registry keeps an instance index. This adapter
 * returns a zero collateral token for a repayment, and the registry resolves the
 * lien through the id it recorded when the loan was taken. Naming the emitter as
 * well as the instance in that lookup is what keeps one protocol out of
 * another's liens.
 *
 * Signatures below were checked against live mainnet logs. Field names come from
 * the verified ABI of the implementation at
 * 0xB258CA5559b11cD702F363796522b04D7722Ea56.
 *
 * Seizure is not mapped. When a Blend auction fails the lender takes the token
 * through `Seize(lienId, collection)`, which ends the lien as surely as a
 * repayment does, but an adapter may declare only one release event and
 * repayment is the ordinary path. A seized lien therefore stays on file until
 * somebody proves otherwise, which is the conservative direction for a registry
 * whose whole job is to be slow to release a claim.
 */
contract BlendAdapter is IPledgeAdapter {
    /// LoanOfferTaken(bytes32,uint256,address,address,address,uint256,uint256,uint256,uint256)
    bytes32 public constant LOAN_OFFER_TAKEN_SIG =
        0x06a333c2d6fe967ca967f7a35be2eb45e8caeb6cf05e16f55d42b91b5fe31255;

    /// Repay(uint256,address)
    bytes32 public constant REPAY_SIG =
        0x2469cc9e12e74c63438d5b1117b318cd3a4cdaf9d659d9eac6d975d14d963254;

    uint8 internal constant KIND_PLEDGE = 0;
    uint8 internal constant KIND_RELEASE = 2;

    error UnsupportedKind(uint8 kind);

    function eventSignatures()
        external
        pure
        returns (bytes32 pledgeSig, bytes32 settleSig, bytes32 releaseSig)
    {
        return (LOAN_OFFER_TAKEN_SIG, bytes32(0), REPAY_SIG);
    }

    function translate(uint8 kind, EvmV1Decoder.LogEntry calldata log)
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
        if (kind == KIND_PLEDGE) {
            (, uint256 lienId, address collection,, address obligor, uint256 loanAmount,, uint256 id,)
            = abi.decode(
                log.data,
                (bytes32, uint256, address, address, address, uint256, uint256, uint256, uint256)
            );
            return (collection, id, obligor, loanAmount, bytes32(lienId));
        }

        if (kind == KIND_RELEASE) {
            // Repay carries the lien and its collection, never the token id, so
            // the registry is asked to resolve the lien it already recorded.
            (uint256 lienId,) = abi.decode(log.data, (uint256, address));
            return (address(0), 0, address(0), 0, bytes32(lienId));
        }

        revert UnsupportedKind(kind);
    }
}
