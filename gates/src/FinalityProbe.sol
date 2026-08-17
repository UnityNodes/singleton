// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * Singleton v2 Fix #1 gate.
 *
 * The finality window needs a Creditcoin CONTRACT to read the latest attested
 * height for a chain, on-chain, in the same transaction that accepts a pledge.
 * The brief calls it `latestAttested(chainKey)`; nothing by that name exists.
 * The real ChainInfo precompile exposes snake_case getters, and whether they are
 * callable from contract code, not just from eth_call by an SDK, is the thing
 * that decides whether Fix #1 is buildable as designed.
 */
interface IChainInfoFull {
    struct ChainInfo {
        uint64 chainKey;
        uint64 chainId;
        bytes chainName;
        uint8 chainEncoding;
    }

    struct HeightHashResult {
        uint64 height;
        bytes32 hash;
        bool isAttestation;
        bool exists;
    }

    function get_latest_attestation_height_and_hash(uint64 chainKey)
        external
        view
        returns (HeightHashResult memory);

    function get_latest_checkpoint_height_and_hash(uint64 chainKey)
        external
        view
        returns (HeightHashResult memory);

    function is_height_attested(uint64 chainKey, uint64 targetHeight)
        external
        view
        returns (bool);
}

contract FinalityProbe {
    address constant CHAIN_INFO = 0x0000000000000000000000000000000000000fD3;

    constructor(uint64 chainKey, uint64 candidateHeight, uint64 minConfirmations) {
        IChainInfoFull info = IChainInfoFull(CHAIN_INFO);

        IChainInfoFull.HeightHashResult memory latest =
            info.get_latest_attestation_height_and_hash(chainKey);
        IChainInfoFull.HeightHashResult memory ckpt =
            info.get_latest_checkpoint_height_and_hash(chainKey);

        bool candidateAttested = info.is_height_attested(chainKey, candidateHeight);

        // the exact guard Fix #1 needs, evaluated on-chain
        bool passesWindow =
            latest.exists && candidateHeight + minConfirmations <= latest.height;

        bytes memory out = abi.encode(
            latest.height,
            latest.exists,
            latest.isAttestation,
            ckpt.height,
            candidateAttested,
            passesWindow
        );
        assembly {
            return(add(out, 32), mload(out))
        }
    }
}
