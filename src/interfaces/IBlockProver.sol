// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * The BlockProver precompile at 0x0FD2.
 *
 * Names and shapes here were read from the SDK ABI and exercised against live
 * CC3 testnet, not taken from prose. Two points that cost time if assumed:
 *
 * - there is no `verifySingle`; the single form of `verify` is the view function
 *   below, and the batch form takes arrays
 * - `verify` is view, `verifyAndEmit` is not. A registry that writes its own
 *   state does not need the precompile to emit anything, so it uses `verify`
 */
interface IBlockProver {
    struct MerkleProofEntry {
        bytes32 hash;
        bool isLeft;
    }

    struct MerkleProof {
        bytes32 root;
        MerkleProofEntry[] siblings;
    }

    struct ContinuityProof {
        bytes32 lowerEndpointDigest;
        bytes32[] roots;
    }

    function verify(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external view returns (bool);

    function verifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external returns (bool);

    /// Recovers the transaction's index in its block from merkle path laterality.
    /// Used here only to key the replay nullifier.
    function calculateTxIndex(MerkleProof calldata merkleProof) external view returns (uint64);
}

library BlockProverLib {
    address internal constant PRECOMPILE = 0x0000000000000000000000000000000000000FD2;

    function proverAt() internal pure returns (IBlockProver) {
        return IBlockProver(PRECOMPILE);
    }
}
