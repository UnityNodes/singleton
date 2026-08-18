import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { relay } from "./relay-core.mjs";
import { REGISTRY_ABI, STATE_NAMES } from "./abi.mjs";
import { resolveChainKey } from "./chainkey.mjs";
import { CC3_RPC, EXPLORER, SOURCE_CHAIN_ID, addresses, requireAddress } from "./config.mjs";

/**
 * Replays the whole life of one asset into a registry, from source transactions
 * that already exist.
 *
 * Every step is a real inclusion proof of a real log that was mined on the
 * source chain, so this is a replay of evidence, not a simulation. Because the
 * transactions are already past the finality window, the whole sequence runs in
 * a couple of minutes, which makes it usable on camera and after a redeploy.
 *
 *   node worker/demo.mjs            runs worker/demo.json
 *   node worker/demo.mjs --list     prints the steps without touching a chain
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const steps = JSON.parse(fs.readFileSync(path.join(here, "demo.json"), "utf8")).steps;

if (process.argv.includes("--list")) {
  steps.forEach((s, i) => console.log(`${i + 1}. ${s.operation.padEnd(9)} ${s.tx}  ${s.note}`));
  process.exit(0);
}

const cc3 = new ethers.JsonRpcProvider(CC3_RPC);
const registry = new ethers.Contract(requireAddress("registry"), REGISTRY_ABI, cc3);
const chainKey = await resolveChainKey(cc3, SOURCE_CHAIN_ID);
const assetKey = await registry.assetKeyOf(chainKey, requireAddress("deed"), BigInt(addresses.tokenId));

console.log(`registry  ${await registry.getAddress()}`);
console.log(`asset     ${requireAddress("deed")} #${addresses.tokenId}`);
console.log(`assetKey  ${assetKey}\n`);

const results = [];
for (const [index, step] of steps.entries()) {
  console.log(`${"=".repeat(72)}\nStep ${index + 1}: ${step.note}\n`);
  const result = await relay({
    txHash: step.tx,
    operation: step.operation,
    force: step.force === true,
    log: (line) => console.log(line),
  });

  if (step.expect && result.outcome !== step.expect) {
    throw new Error(`step ${index + 1} expected ${step.expect}, got ${result.outcome}`);
  }
  results.push({ step: index + 1, note: step.note, ...result });
  console.log("");
}

const record = await registry.getStatus(assetKey);
console.log("=".repeat(72));
console.log("final state");
console.log(`  ${STATE_NAMES[Number(record.state)]}` + (record.emitter === ethers.ZeroAddress ? "" : ` held by ${record.emitter}`));
console.log(`  refused pledges on file: ${await registry.collisionCount(assetKey)}`);
console.log(`  certificate: ${await registry.certificateOf(assetKey)}`);
console.log("\nsteps");
for (const r of results) {
  const tail = r.outcome === "recorded"
    ? `${EXPLORER}/tx/${r.hash}`
    : `${r.error.name}${r.forced ? ` ${EXPLORER}/tx/${r.forced.hash}` : ""}`;
  console.log(`  ${r.step}. ${r.note.padEnd(38)} ${r.outcome.padEnd(9)} ${tail}`);
}
