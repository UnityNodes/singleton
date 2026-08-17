// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {SingletonRegistry} from "../src/SingletonRegistry.sol";

/**
 * Deploys the registry on Creditcoin and configures it for one source chain.
 *
 * Two things this script deliberately does not do.
 *
 * It does not resolve the chain key on-chain. `ChainInfo` is a precompile, so it
 * has no code in a forked simulation and any call to it returns empty. The key
 * is resolved off-chain against live CC3 by worker/chainkey.mjs, from the chain
 * id, and passed in. Pinning the id and resolving the key is the rule from
 * docs/VERIFICATION.md: chain key 1 is Sepolia on CC3 testnet and Ethereum on
 * CC3 mainnet.
 *
 * It does not link EvmV1Decoder itself. That address only exists on CC3, so it
 * lives in the `cc3` foundry profile and would break every local test if it were
 * in the default one.
 *
 *   SOURCE_CHAIN_KEY=1 HARBOR=0x.. MERIDIAN=0x.. FOUNDRY_PROFILE=cc3 \
 *   forge script script/DeployRegistry.s.sol:DeployRegistry \
 *     --rpc-url $CC3_RPC --broadcast --private-key $PK --legacy
 */
contract DeployRegistry is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        uint64 sourceChainKey = uint64(vm.envUint("SOURCE_CHAIN_KEY"));
        uint64 minConfirmations = uint64(vm.envOr("MIN_CONFIRMATIONS", uint256(64)));
        address harbor = vm.envOr("HARBOR", address(0));
        address meridian = vm.envOr("MERIDIAN", address(0));

        vm.startBroadcast(pk);

        SingletonRegistry registry = new SingletonRegistry();
        registry.setMinConfirmations(sourceChainKey, minConfirmations);
        if (harbor != address(0)) registry.setEmitter(sourceChainKey, harbor, true);
        if (meridian != address(0)) registry.setEmitter(sourceChainKey, meridian, true);

        vm.stopBroadcast();

        console.log("registry        ", address(registry));
        console.log("sourceChainKey  ", sourceChainKey);
        console.log("minConfirmations", minConfirmations);
        console.log("allowed harbor  ", harbor);
        console.log("allowed meridian", meridian);
    }
}
