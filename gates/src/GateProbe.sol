// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {INativeQueryVerifier, NativeQueryVerifierLib} from "./VerifierInterface.sol";
import {EvmV1Decoder} from "./vendor/EvmV1Decoder.sol";

/**
 * Singleton Day-1 Gate.
 *
 * The one thing the brief flags as unconfirmed: does getLogsByEventSignature
 * pull a CUSTOM multi-field event, not the toy Transfer that the official
 * example decodes, and return correct indexed topics and non-indexed data?
 *
 * Runs entirely inside a constructor so it executes on a live Creditcoin node
 * against the real BlockProver precompile, with no deployment and no funds.
 */
contract GateProbe {
    constructor(
        uint64 chainKey,
        uint64 blockHeight,
        bytes memory encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] memory siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] memory continuityRoots,
        bytes32 wantedSignature
    ) {
        INativeQueryVerifier verifier = NativeQueryVerifierLib.getVerifier();

        bool verified = verifier.verifyAndEmit(
            chainKey,
            blockHeight,
            encodedTransaction,
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings}),
            INativeQueryVerifier.ContinuityProof({
                lowerEndpointDigest: lowerEndpointDigest,
                roots: continuityRoots
            })
        );

        uint8 status;
        uint256 totalLogs;
        uint256 matchedLogs;
        address emitter;
        bytes32[] memory topics;
        bytes memory data;

        if (verified) {
            EvmV1Decoder.ReceiptFields memory r =
                EvmV1Decoder.decodeReceiptFields(encodedTransaction);
            status = r.receiptStatus;
            totalLogs = r.receiptLogs.length;

            EvmV1Decoder.LogEntry[] memory matched =
                EvmV1Decoder.getLogsByEventSignature(r, wantedSignature);
            matchedLogs = matched.length;

            if (matchedLogs > 0) {
                emitter = matched[0].address_;
                topics = matched[0].topics;
                data = matched[0].data;
            }
        }

        bytes memory out =
            abi.encode(verified, status, totalLogs, matchedLogs, emitter, topics, data);
        assembly {
            return(add(out, 32), mload(out))
        }
    }
}
