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
 * A lien here ends two ways and both are proven: `Repay` when the borrower pays,
 * `Seize` when an auction fails and the lender takes the token. The two logs are
 * identical in shape, so one branch reads both.
 */
contract BlendAdapter is IPledgeAdapter {
    /// LoanOfferTaken(bytes32,uint256,address,address,address,uint256,uint256,uint256,uint256)
    bytes32 public constant LOAN_OFFER_TAKEN_SIG =
        0x06a333c2d6fe967ca967f7a35be2eb45e8caeb6cf05e16f55d42b91b5fe31255;

    /// Repay(uint256,address)
    bytes32 public constant REPAY_SIG =
        0x2469cc9e12e74c63438d5b1117b318cd3a4cdaf9d659d9eac6d975d14d963254;

    /// Seize(uint256,address), identical in shape to Repay
    bytes32 public constant SEIZE_SIG =
        0xb71caf41fe0e019dbe21a1ae3493f11a729c31548ed1e304ae7f6e8c8df275de;

    uint8 internal constant KIND_PLEDGE = 0;
    uint8 internal constant KIND_RELEASE = 2;

    error UnsupportedKind(uint8 kind);

    /**
     * Blend ends a lien two ways and the registry accepts both: `Repay` when the
     * borrower pays, `Seize` when an auction fails and the lender takes the
     * token. Either way the lien is over, and either way the log carries the
     * lien id and nothing else useful, which the instance index resolves.
     *
     * There is no settlement: Blend has no state between drawn and closed.
     */
    function signaturesFor(uint8 kind) external pure returns (bytes32[] memory signatures) {
        if (kind == KIND_PLEDGE) {
            signatures = new bytes32[](1);
            signatures[0] = LOAN_OFFER_TAKEN_SIG;
            return signatures;
        }
        if (kind == KIND_RELEASE) {
            signatures = new bytes32[](2);
            signatures[0] = REPAY_SIG;
            signatures[1] = SEIZE_SIG;
            return signatures;
        }
        return new bytes32[](0);
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
            // Repay and Seize carry the lien and its collection, never the token
            // id, so the registry is asked to resolve the lien it recorded.
            (uint256 lienId,) = abi.decode(log.data, (uint256, address));
            return (address(0), 0, address(0), 0, bytes32(lienId));
        }

        revert UnsupportedKind(kind);
    }
}
