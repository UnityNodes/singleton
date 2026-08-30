import { ethers } from "ethers";
import { proofProvider } from "@gluwa/usc-sdk";
import { REGISTRY_ABI } from "./abi.mjs";
import { findSourceEvent } from "./schemas.mjs";
import { resolveChainKey } from "./chainkey.mjs";
import { chooseEmitter, connect } from "./relay-core.mjs";
import { EXPLORER, PROVER_URL, SOURCE_CHAIN_ID, SOURCE_RPC } from "./config.mjs";

/**
 * Files many pledges from one continuity proof.
 *
 * The continuity proof is what grows with the gap since the last attestation,
 * and the batch form of the precompile takes one of them for a whole array of
 * transactions. So the saving is not a constant: it is the part that scales
 * with distance, paid once instead of once per pledge.
 *
 * One constraint, measured against the live precompile rather than read
 * anywhere: the shared proof is anchored at the lowest header the prover built
 * it from, so the batch must contain a transaction at that header. Drop it and
 * the precompile refuses the whole batch with a continuity mismatch.
 *
 *   node worker/batch.mjs 0xTx 0xTx 0xTx
 */
const txHashes = process.argv.slice(2).filter((a) => a.startsWith("0x"));
if (txHashes.length === 0) {
  throw new Error("usage: node worker/batch.mjs <sourceTxHash> [<sourceTxHash> ...]");
}

const { source, cc3, registry } = connect(SOURCE_RPC);
const chainKey = await resolveChainKey(cc3, SOURCE_CHAIN_ID);

console.log(`chain id ${SOURCE_CHAIN_ID} -> chain key ${chainKey}`);
console.log(`batching ${txHashes.length} transactions\n`);

const members = [];
for (const txHash of txHashes) {
  const receipt = await source.getTransactionReceipt(txHash);
  if (!receipt) throw new Error(`no receipt on the source chain for ${txHash}`);
  const emitter = await chooseEmitter(registry, chainKey, receipt);
  const { position, fields } = findSourceEvent(receipt, "pledge", emitter);
  members.push({ txHash, emitter, position, fields, block: receipt.blockNumber });
  console.log(`  ${txHash.slice(0, 12)} block ${receipt.blockNumber} log ${position} ${fields.token} #${fields.tokenId}`);
}

const builder = new proofProvider.service.ProofBuilder(chainKey, PROVER_URL, 180_000);
const result = await builder.getBatchProof(txHashes);
if (!result.success || !result.data) throw new Error(`prover refused: ${result.error}`);
const d = result.data;

/*
  The prover returns proofs nested by header and then by transaction index. The
  precompile takes flat parallel arrays, and every array has to line up with the
  emitter and log index this relay chose for that transaction, so the flattening
  is driven by the transaction hash rather than by iteration order.
*/
const byHash = new Map();
for (const [header, byIndex] of d.merkleProofs.entries()) {
  for (const [, entry] of byIndex.entries()) byHash.set(entry.txHash.toLowerCase(), { header, entry });
}

const b = {
  chainKey,
  heights: [],
  emitters: [],
  logIndexes: [],
  encodedTransactions: [],
  merkleProofs: [],
  sharedContinuityProof: {
    lowerEndpointDigest: d.continuityProof.lowerEndpointDigest,
    roots: d.continuityProof.roots,
  },
};

for (const m of members) {
  const found = byHash.get(m.txHash.toLowerCase());
  if (!found) throw new Error(`the prover returned no proof for ${m.txHash}`);
  b.heights.push(found.header);
  b.emitters.push(m.emitter);
  b.logIndexes.push(m.position);
  b.encodedTransactions.push(found.entry.txBytes);
  b.merkleProofs.push({
    root: found.entry.merkleProof.root,
    siblings: found.entry.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })),
  });
}

console.log(`\nproof spans headers ${d.fromHeader} to ${d.toHeader}`);
console.log(`one shared continuity proof, ${d.continuityProof.roots.length} roots`);
if (!b.heights.includes(d.fromHeader)) {
  console.log(`  warning: no member sits at ${d.fromHeader}, which the shared proof is anchored to`);
}

const estimate = await registry.registerPledges.estimateGas(b);
console.log(`\nestimated gas ${estimate} for ${members.length} pledges, ${estimate / BigInt(members.length)} each`);

const tx = await registry.registerPledges(b);
const mined = await tx.wait();
console.log(`\nsubmitted ${tx.hash}`);
console.log(`mined     block ${mined.blockNumber}, gas ${mined.gasUsed}`);
console.log(`per pledge ${mined.gasUsed / BigInt(members.length)}`);
console.log(`explorer  ${EXPLORER}/tx/${tx.hash}`);

/*
  A member somebody front-ran out of this batch does not fire PledgeRecorded,
  because it was already recorded before this transaction ran. Counting that
  event rather than trusting members.length is what actually tells an operator
  a griefing skip happened, without a separate staticCall.
*/
const recorded = mined.logs.filter((log) => {
  try { return registry.interface.parseLog(log)?.name === "PledgeRecorded"; }
  catch { return false; }
}).length;
if (recorded < members.length) {
  console.log(
    `  ${members.length - recorded} of ${members.length} were already filed before this ` +
      `transaction ran, and were skipped rather than taking the whole batch down`,
  );
}
