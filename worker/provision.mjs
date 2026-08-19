import { ethers } from "ethers";
import { REGISTRY_ABI } from "./abi.mjs";
import { resolveChainKey } from "./chainkey.mjs";
import { CC3_RPC, EXPLORER, addresses, loadPrivateKey, requireAddress } from "./config.mjs";

/**
 * Brings a freshly deployed registry to the configuration the demo expects.
 *
 * The depth for a chain is stated before any emitter on it is allowlisted. The
 * registry refuses to read a chain nobody has stated a depth for, so the order
 * is not cosmetic: an emitter allowlisted first would sit there looking
 * configured while every proof against it reverted.
 *
 * Chain keys are resolved live against ChainInfo, never hardcoded: key 1 is
 * Sepolia on CC3 testnet and Ethereum on CC3 mainnet.
 *
 *   node worker/provision.mjs           applies the plan
 *   node worker/provision.mjs --check   reads the registry back and says nothing
 */
const DEPTH = Number(process.env.MIN_CONFIRMATIONS ?? 64);

const PLAN = [
  {
    chainId: 11155111,
    emitters: [
      { name: "Harbor Credit", address: requireAddress("harbor") },
      { name: "Meridian Credit", address: requireAddress("meridian") },
    ],
  },
  {
    chainId: 1,
    emitters: [
      { name: "NFTfi v3", address: requireAddress("nftfi"), adapter: requireAddress("nftfiAdapter") },
      { name: "Blur Blend", address: requireAddress("blend"), adapter: requireAddress("blendAdapter") },
    ],
  },
];

const check = process.argv.includes("--check");
const cc3 = new ethers.JsonRpcProvider(CC3_RPC);
const signer = check ? cc3 : new ethers.Wallet(loadPrivateKey(), cc3);
const registry = new ethers.Contract(requireAddress("registry"), REGISTRY_ABI, signer);

console.log(`registry ${addresses.registry}`);
console.log(`${check ? "reading" : "configuring"} ${PLAN.length} source chains\n`);

let wrong = 0;

for (const chain of PLAN) {
  const chainKey = await resolveChainKey(cc3, chain.chainId);
  console.log(`chain id ${chain.chainId} -> chain key ${chainKey}`);

  const depth = Number(await registry.minConfirmations(chainKey));
  if (check) {
    console.log(`  minConfirmations ${depth}${depth === DEPTH ? "" : `  WRONG, want ${DEPTH}`}`);
    if (depth !== DEPTH) wrong++;
  } else if (depth !== DEPTH) {
    const tx = await registry.setMinConfirmations(chainKey, DEPTH);
    await tx.wait();
    console.log(`  minConfirmations ${DEPTH}  ${EXPLORER}/tx/${tx.hash}`);
  } else {
    console.log(`  minConfirmations ${DEPTH}  already set`);
  }

  for (const emitter of chain.emitters) {
    const address = ethers.getAddress(emitter.address);
    const allowed = await registry.allowedEmitter(chainKey, address);
    const adapter = await registry.adapterOf(chainKey, address);
    const wantAdapter = emitter.adapter ? ethers.getAddress(emitter.adapter) : ethers.ZeroAddress;

    if (check) {
      const ok = allowed && adapter === wantAdapter;
      console.log(
        `  ${emitter.name.padEnd(16)} ${address}  allowed ${allowed}  adapter ${adapter}${ok ? "" : "  WRONG"}`,
      );
      if (!ok) wrong++;
      continue;
    }

    if (!allowed) {
      const tx = await registry.setEmitter(chainKey, address, true);
      await tx.wait();
      console.log(`  allowed ${emitter.name.padEnd(16)} ${EXPLORER}/tx/${tx.hash}`);
    }
    if (adapter !== wantAdapter) {
      const tx = await registry.setAdapter(chainKey, address, wantAdapter);
      await tx.wait();
      console.log(`  adapter ${emitter.name.padEnd(16)} ${EXPLORER}/tx/${tx.hash}`);
    }
  }
  console.log("");
}

if (check) {
  console.log(wrong === 0 ? "configuration matches the plan" : `${wrong} settings do not match the plan`);
  process.exit(wrong === 0 ? 0 : 1);
}
