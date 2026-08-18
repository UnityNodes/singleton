import { relay } from "./relay-core.mjs";

/**
 * Relays one source-chain lifecycle event into the registry on Creditcoin.
 *
 *   node worker/relay.mjs <sourceTxHash> [pledge|collision|settle|release]
 *
 * FORCE_SUBMIT=1 sends a refused proof anyway, so the refusal exists as a failed
 * transaction anybody can open in the explorer.
 */
const txHash = process.argv[2];
const operation = (process.argv[3] ?? "pledge").toLowerCase();
if (!txHash) {
  throw new Error("usage: node worker/relay.mjs <sourceTxHash> [pledge|collision|settle|release]");
}

const result = await relay({
  txHash,
  operation,
  force: process.env.FORCE_SUBMIT === "1",
  log: (line) => console.log(line),
});

if (result.outcome === "refused") {
  if (result.error.name === "AssetNotFree") {
    console.log(`\nkeep the evidence: node worker/relay.mjs ${txHash} collision`);
  }
  process.exit(2);
}
