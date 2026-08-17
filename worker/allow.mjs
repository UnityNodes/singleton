import { ethers } from "ethers";
import { REGISTRY_ABI } from "./abi.mjs";
import { resolveChainKey } from "./chainkey.mjs";
import { CC3_RPC, EXPLORER, SOURCE_CHAIN_ID, loadPrivateKey, requireAddress } from "./config.mjs";

/**
 * Admin operations on the registry: the allowlist and the confirmation depth.
 *
 * The allowlist governs which logs are read, never whether they are true. That
 * distinction is caveat 9 and it is the reason an administrator here can
 * exclude a protocol but cannot fabricate a pledge.
 *
 *   node worker/allow.mjs 0xEmitter [on|off]
 *   node worker/allow.mjs --min-conf 64
 */
const cc3 = new ethers.JsonRpcProvider(CC3_RPC);
const wallet = new ethers.Wallet(loadPrivateKey(), cc3);
const registry = new ethers.Contract(requireAddress("registry"), REGISTRY_ABI, wallet);
const chainKey = await resolveChainKey(cc3, SOURCE_CHAIN_ID);

const [first, second] = process.argv.slice(2);
if (!first) throw new Error("usage: node worker/allow.mjs <emitter> [on|off] | --min-conf <blocks>");

if (first === "--min-conf") {
  const depth = Number(second);
  const tx = await registry.setMinConfirmations(chainKey, depth);
  await tx.wait();
  console.log(`minConfirmations[${chainKey}] = ${depth}`);
  console.log(`${EXPLORER}/tx/${tx.hash}`);
} else {
  const emitter = ethers.getAddress(first);
  const allowed = (second ?? "on") !== "off";
  const tx = await registry.setEmitter(chainKey, emitter, allowed);
  await tx.wait();
  console.log(`allowedEmitter[${chainKey}][${emitter}] = ${allowed}`);
  console.log(`${EXPLORER}/tx/${tx.hash}`);
}
