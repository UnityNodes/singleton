// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IPledgeAdapter} from "../interfaces/IPledgeAdapter.sol";
import {EvmV1Decoder} from "../vendor/EvmV1Decoder.sol";

/**
 * Reads NFTfi v3 on Ethereum mainnet.
 *
 * NFTfi is a real lending protocol with real loans against real NFTs, and it
 * has never heard of this registry. That is the entire claim of the product,
 * and this adapter is what it costs to make it true: one pure contract, no
 * cooperation, no deployment on their side, nothing asked of anybody.
 *
 * Field names and layout come from the verified ABI of CollectionOfferLoan at
 * 0xB6adEc2ACc851d30d5fB64f3137234BCDCBBad0D, and the signatures below were
 * checked against real logs on chain rather than derived from documentation.
 *
 * Two honest notes about the mapping.
 *
 * NFTfi is custodial: `LoanTerms.escrow` names the contract holding the token
 * for the duration of the loan. A borrower who has deposited the NFT cannot
 * pledge it elsewhere, so no collision can originate here. That is caveat 6,
 * and it is why the collision demonstration runs against non-custodial lenders
 * instead.
 *
 * NFTfi has no separate settlement step: repayment returns the token in the
 * same transaction, so `LoanRepaid` is a release, not a settlement, and the
 * settlement signature is deliberately zero. The registry answers
 * `TransitionUnsupported` for a settlement against this emitter, which is the
 * truth rather than a convenient approximation.
 */
contract NftfiV3Adapter is IPledgeAdapter {
    /// LoanStarted(uint32,address,address,(uint256,uint256,uint256,address,uint32,uint16,uint16,uint256,address,uint64,address,address,address,address,bool))
    bytes32 public constant LOAN_STARTED_SIG =
        0x4d3634f72248e203ec6eab4996f443daca55feea347f82ff609b2d0f5bbaae5a;

    /// LoanRepaid(uint32,address,address,uint256,uint256,uint256,uint256,address,address)
    bytes32 public constant LOAN_REPAID_SIG =
        0x6ee3573bd905753c83bc1aaca3c15bfa36391db95b778bd825eb010645a7ee45;

    uint8 internal constant KIND_PLEDGE = 0;
    uint8 internal constant KIND_RELEASE = 2;

    struct LoanTerms {
        uint256 loanPrincipalAmount;
        uint256 maximumRepaymentAmount;
        uint256 nftCollateralId;
        address loanERC20Denomination;
        uint32 loanDuration;
        uint16 loanInterestRateForDurationInBasisPoints;
        uint16 loanAdminFeeInBasisPoints;
        uint256 originationFee;
        address nftCollateralWrapper;
        uint64 loanStartTime;
        address nftCollateralContract;
        address borrower;
        address lender;
        address escrow;
        bool isProRata;
    }

    error UnsupportedKind(uint8 kind);
    error UnexpectedTopics(uint256 count);

    function eventSignatures()
        external
        pure
        returns (bytes32 pledgeSig, bytes32 settleSig, bytes32 releaseSig)
    {
        return (LOAN_STARTED_SIG, bytes32(0), LOAN_REPAID_SIG);
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
        if (log.topics.length != 4) revert UnexpectedTopics(log.topics.length);

        // loanId leads the topics in both events, so one lien keeps one identity
        // from the loan being taken to the loan being repaid.
        instanceId = log.topics[1];

        if (kind == KIND_PLEDGE) {
            LoanTerms memory terms = abi.decode(log.data, (LoanTerms));
            return (
                terms.nftCollateralContract,
                terms.nftCollateralId,
                terms.borrower,
                terms.loanPrincipalAmount,
                instanceId
            );
        }

        if (kind == KIND_RELEASE) {
            /**
             * The borrower in a repayment log is whoever held the obligation at
             * the end, which NFTfi lets change hands during the loan. The
             * registry binds a release to the emitter and the loan id, never to
             * the borrower, so a transferred obligation still closes its lien.
             */
            (uint256 principal, uint256 collateralId,,, address collateral,) =
                abi.decode(log.data, (uint256, uint256, uint256, uint256, address, address));
            return (collateral, collateralId, address(uint160(uint256(log.topics[2]))), principal, instanceId);
        }

        revert UnsupportedKind(kind);
    }
}
