// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IBlockProver} from "../../src/interfaces/IBlockProver.sol";
import {IChainInfo} from "../../src/interfaces/IChainInfo.sol";

/**
 * Model of the BlockProver precompile.
 *
 * Deliberately not permissive: it returns true only for a triple that was
 * explicitly attested, so a proof for one chain does not verify under another.
 * test_model_bindsChainKey breaks it on purpose before anything else in the
 * suite is trusted.
 */
contract ProverModel {
    mapping(bytes32 => bool) public attested;


    function attest(uint64 chainKey, uint64 height, bytes calldata encodedTransaction) external {
        attested[keccak256(abi.encode(chainKey, height, encodedTransaction))] = true;
    }

    function verify(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        IBlockProver.MerkleProof calldata,
        IBlockProver.ContinuityProof calldata
    ) external view returns (bool) {
        return attested[keccak256(abi.encode(chainKey, height, encodedTransaction))];
    }

    /**
     * The batch form, modelled as every member having to be attested.
     *
     * The live precompile checks each transaction individually inside a batch,
     * which was measured against it rather than assumed: a forged member of an
     * otherwise honest batch is refused. A model that waved a batch through on
     * the strength of its first member would let the registry's batch path pass
     * tests the real one would fail.
     */
    function verify(
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata encodedTransactions,
        IBlockProver.MerkleProof[] calldata,
        IBlockProver.ContinuityProof calldata
    ) external view returns (bool) {
        for (uint256 i; i < heights.length; i++) {
            bytes32 key = keccak256(abi.encode(chainKey, heights[i], encodedTransactions[i]));
            if (!attested[key]) return false;
        }
        return heights.length > 0;
    }

    function calculateTxIndex(IBlockProver.MerkleProof calldata proof)
        external
        pure
        returns (uint64)
    {
        return uint64(uint256(proof.root) & 0xffff);
    }
}

/// Mirrors the live CC3 testnet values read on 2026-08-17.
contract ChainInfoModel {
    // constants, not storage: vm.etch copies runtime code and leaves storage
    // empty, so anything a constructor would have written reads back as zero
    uint64 public constant ETH_TIP = 25_776_130;
    uint64 public constant SEPOLIA_TIP = 11_509_380;

    function get_latest_attestation_height_and_hash(uint64 chainKey)
        external
        pure
        returns (IChainInfo.HeightHashResult memory)
    {
        uint64 tip = chainKey == 3 ? ETH_TIP : SEPOLIA_TIP;
        return IChainInfo.HeightHashResult({
            height: tip, hash: bytes32(uint256(1)), isAttestation: true, exists: true
        });
    }
}
