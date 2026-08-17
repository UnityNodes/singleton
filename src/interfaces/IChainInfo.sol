// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * The ChainInfo precompile at 0x0fD3.
 *
 * The selectors are snake_case even though the SDK wrappers are camelCase.
 * Calling `getSupportedChains()` returns "Unknown selector"; the precompile
 * answers to `get_supported_chains()`. Verified live.
 *
 * `get_latest_attestation_height_and_hash` is what makes the finality window
 * buildable: a registry can read the attested tip on-chain, inside the same
 * transaction that accepts a pledge.
 */
interface IChainInfo {
    struct ChainInfoData {
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

    function get_supported_chains() external view returns (ChainInfoData[] memory chains);

    function get_latest_attestation_height_and_hash(uint64 chainKey)
        external
        view
        returns (HeightHashResult memory result);

    function get_latest_checkpoint_height_and_hash(uint64 chainKey)
        external
        view
        returns (HeightHashResult memory result);

    function is_height_attested(uint64 chainKey, uint64 targetHeight)
        external
        view
        returns (bool isAttested);

    function get_attestation_genesis_height(uint64 chainKey)
        external
        view
        returns (uint64 genesisHeight);
}

library ChainInfoLib {
    address internal constant PRECOMPILE = 0x0000000000000000000000000000000000000fD3;

    function infoAt() internal pure returns (IChainInfo) {
        return IChainInfo(PRECOMPILE);
    }

    /**
     * Resolves a universal EVM chain id to the chain key this Creditcoin network
     * uses for it.
     *
     * Pinning the chain id rather than the chain key is deliberate. Verified on
     * both live networks: chainKey 1 means Sepolia on CC3 testnet and Ethereum
     * on CC3 mainnet. Source pinned by key would silently read a different chain
     * after promotion; pinned by id, one source is correct on both.
     */
    function resolveChainKey(uint64 chainId) internal view returns (uint64 chainKey, bool found) {
        IChainInfo.ChainInfoData[] memory chains = infoAt().get_supported_chains();
        for (uint256 i; i < chains.length; i++) {
            if (chains[i].chainId == chainId) {
                return (chains[i].chainKey, true);
            }
        }
        return (0, false);
    }
}
