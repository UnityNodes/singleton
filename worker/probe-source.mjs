import { ethers } from "ethers";
import { proofProvider } from "@gluwa/usc-sdk";
import { attestedTip, resolveChainKey } from "./chainkey.mjs";
import { CC3_RPC, PROVER_URL, SOURCE_CHAIN_ID, SOURCE_RPC } from "./config.mjs";

/**
 * Proves the whole read path for a source chain without spending anything on
 * either side: any transaction, a proof from the prover service, the precompile
 * verifying it, and the deployed decoder reading the receipt back out.
 *
 * Everything runs through eth_call, so this answers "is this chain usable" for a
 * chain we hold no funds on. The gates in gates/ did the same for Ethereum; this
 * does it for whatever SOURCE_CHAIN_ID names, and for an arbitrary transaction
 * rather than one we crafted.
 *
 *   node worker/probe-source.mjs               picks a settled transaction
 *   node worker/probe-source.mjs 0x<txHash>
 */
const PROVER = "0x0000000000000000000000000000000000000FD2";
const DECODER = process.env.DECODER ?? "0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f";

const PROVER_ABI = [
  "function verify(uint64 chainKey,uint64 height,bytes encodedTransaction,(bytes32 root,(bytes32 hash,bool isLeft)[] siblings) merkleProof,(bytes32 lowerEndpointDigest,bytes32[] roots) continuityProof) view returns (bool)",
  "function calculateTxIndex((bytes32 root,(bytes32 hash,bool isLeft)[] siblings) merkleProof) view returns (uint64)",
];

const DECODER_ABI = [
  "function decodeReceiptFields(bytes encodedTransaction) pure returns ((uint8 receiptStatus,uint64 receiptGasUsed,(address address_,bytes32[] topics,bytes data)[] receiptLogs,bytes receiptLogsBloom) fields)",
];

const source = new ethers.JsonRpcProvider(SOURCE_RPC);
const cc3 = new ethers.JsonRpcProvider(CC3_RPC);

const chainKey = await resolveChainKey(cc3, SOURCE_CHAIN_ID);
const tip = await attestedTip(cc3, chainKey);
console.log(`source chain id ${SOURCE_CHAIN_ID} -> chain key ${chainKey}`);
console.log(`attested tip    ${tip.height}`);

let txHash = process.argv[2];
if (!txHash) {
  const head = await source.getBlockNumber();
  console.log(`source head     ${head}, lag ${head - tip.height} blocks behind attestation`);
  for (let height = tip.height - 8; height > tip.height - 40 && !txHash; height--) {
    const block = await source.getBlock(height);
    for (const candidate of block?.transactions ?? []) {
      const receipt = await source.getTransactionReceipt(candidate);
      if (receipt?.status === 1 && receipt.logs.length > 0) {
        txHash = candidate;
        break;
      }
    }
  }
  if (!txHash) throw new Error("no settled transaction with logs found near the attested tip");
  console.log(`picked          ${txHash}`);
}

const receipt = await source.getTransactionReceipt(txHash);
if (!receipt) throw new Error(`no receipt for ${txHash}`);
console.log(`block           ${receipt.blockNumber}, status ${receipt.status}, logs ${receipt.logs.length}`);

const builder = new proofProvider.service.ProofBuilder(chainKey, PROVER_URL);
const result = await builder.getProof(txHash);
if (!result.success || !result.data) {
  throw new Error(`prover refused: ${result.error ?? "unknown error"}`);
}
const d = result.data;
console.log("\nprover");
console.log(`  headerNumber     ${d.headerNumber}`);
console.log(`  txIndex          ${d.txIndex}`);
console.log(`  txBytes          ${(d.txBytes.length - 2) / 2} bytes`);
console.log(`  merkle siblings  ${d.merkleProof.siblings.length}`);
console.log(`  continuity roots ${d.continuityProof.roots.length}`);

const merkleProof = {
  root: d.merkleProof.root,
  siblings: d.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })),
};
const continuityProof = {
  lowerEndpointDigest: d.continuityProof.lowerEndpointDigest,
  roots: d.continuityProof.roots,
};

const prover = new ethers.Contract(PROVER, PROVER_ABI, cc3);
const verified = await prover.verify(chainKey, d.headerNumber, d.txBytes, merkleProof, continuityProof);
const derivedIndex = await prover.calculateTxIndex(merkleProof);

const decoder = new ethers.Contract(DECODER, DECODER_ABI, cc3);
const fields = await decoder.decodeReceiptFields(d.txBytes);

console.log("\non creditcoin");
console.log(`  BlockProver.verify        ${verified}`);
console.log(`  calculateTxIndex          ${derivedIndex}  (prover says ${d.txIndex})`);
console.log(`  decoded receiptStatus     ${fields.receiptStatus}  (source rpc says ${receipt.status})`);
console.log(`  decoded log count         ${fields.receiptLogs.length}  (source rpc says ${receipt.logs.length})`);

const first = fields.receiptLogs[0];
if (first) {
  const live = receipt.logs[0];
  console.log(`  first log emitter         ${first.address_}`);
  console.log(`                            source rpc ${live.address}  match ${first.address_.toLowerCase() === live.address.toLowerCase()}`);
  console.log(`  first log topic0          ${first.topics[0]}  match ${first.topics[0] === live.topics[0]}`);
}

const pass =
  verified &&
  Number(derivedIndex) === Number(d.txIndex) &&
  Number(fields.receiptStatus) === receipt.status &&
  fields.receiptLogs.length === receipt.logs.length &&
  (!first || first.address_.toLowerCase() === receipt.logs[0].address.toLowerCase());

console.log(`\n  source chain ${SOURCE_CHAIN_ID} read path: ${pass ? "PASS" : "FAIL"}`);
process.exit(pass ? 0 : 1);
