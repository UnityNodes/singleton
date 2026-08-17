import { ethers } from "ethers";
import { proofProvider } from "@gluwa/usc-sdk";
import { PLEDGED_ABI, REGISTRY_ABI, STATE_NAMES } from "./abi.mjs";
import { attestedTip, resolveChainKey } from "./chainkey.mjs";
import {
  CC3_RPC,
  EXPLORER,
  PROVER_URL,
  SEPOLIA_RPC,
  SOURCE_CHAIN_ID,
  loadPrivateKey,
  requireAddress,
} from "./config.mjs";

/**
 * Relays one source-chain pledge into the registry on Creditcoin.
 *
 * The relay is not trusted with anything. It carries bytes: the transaction, a
 * merkle proof of its place in a block, and a continuity proof back to an
 * attested checkpoint. Every claim in those bytes is re-checked by the
 * BlockProver precompile inside the registry's own transaction, so a lying
 * relay produces a reverted transaction and nothing else.
 *
 *   node worker/relay.mjs 0x<sepolia tx hash>
 */
const txHash = process.argv[2];
if (!txHash) throw new Error("usage: node worker/relay.mjs <sourceTxHash>");

const POLL_SECONDS = Number(process.env.POLL_SECONDS ?? 30);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const source = new ethers.JsonRpcProvider(SEPOLIA_RPC);
const cc3 = new ethers.JsonRpcProvider(CC3_RPC);
const wallet = new ethers.Wallet(loadPrivateKey(), cc3);
const registry = new ethers.Contract(requireAddress("registry"), REGISTRY_ABI, wallet);

// ------------------------------------------------------------- source side

const receipt = await source.getTransactionReceipt(txHash);
if (!receipt) throw new Error(`no receipt on the source chain for ${txHash}`);

const pledgedIface = new ethers.Interface(PLEDGED_ABI);
const pledged = receipt.logs
  .map((log) => {
    try {
      return { log, parsed: pledgedIface.parseLog(log) };
    } catch {
      return null;
    }
  })
  .filter((entry) => entry?.parsed?.name === "Pledged");

if (pledged.length !== 1) {
  throw new Error(`expected exactly one Pledged log, found ${pledged.length}`);
}

const { log, parsed } = pledged[0];
console.log("source");
console.log(`  tx         ${txHash}`);
console.log(`  block      ${receipt.blockNumber}, status ${receipt.status}`);
console.log(`  emitter    ${log.address}`);
console.log(`  token      ${parsed.args.collateralToken} #${parsed.args.tokenId}`);
console.log(`  borrower   ${parsed.args.borrower}`);
console.log(`  amount     ${ethers.formatEther(parsed.args.amount)}`);
console.log(`  instanceId ${parsed.args.pledgeInstanceId}`);

// ------------------------------------------------------- creditcoin context

const chainKey = await resolveChainKey(cc3, SOURCE_CHAIN_ID);
const depth = Number(await registry.minConfirmations(chainKey));
const allowed = await registry.allowedEmitter(chainKey, log.address);

console.log("\ncreditcoin");
console.log(`  registry   ${await registry.getAddress()}`);
console.log(`  chainId ${SOURCE_CHAIN_ID} -> chainKey ${chainKey}`);
console.log(`  minConf    ${depth}`);
console.log(`  emitter allowlisted ${allowed}`);
if (!allowed) throw new Error("emitter is not on the allowlist; run setEmitter first");

/**
 * The guard inside the registry is `height + depth <= tip`, so waiting for the
 * same condition off-chain turns an inevitable revert into a wait. Attestation
 * of Sepolia runs tens of blocks behind its head, so this is minutes, not hours.
 */
for (;;) {
  const tip = await attestedTip(cc3, chainKey);
  const ready = tip.exists && receipt.blockNumber + depth <= tip.height;
  const short = receipt.blockNumber + depth - tip.height;
  console.log(
    `  attested tip ${tip.height}, need ${receipt.blockNumber + depth}` +
      (ready ? "  ready" : `  waiting ${short} blocks`),
  );
  if (ready) break;
  await sleep(POLL_SECONDS * 1000);
}

// -------------------------------------------------------------------- proof

const builder = new proofProvider.service.ProofBuilder(chainKey, PROVER_URL);
const result = await builder.getProof(txHash);
if (!result.success || !result.data) {
  throw new Error(`prover refused: ${result.error ?? "unknown error"}`);
}
const d = result.data;
console.log("\nproof");
console.log(`  headerNumber      ${d.headerNumber}`);
console.log(`  txIndex           ${d.txIndex}`);
console.log(`  txBytes           ${(d.txBytes.length - 2) / 2} bytes`);
console.log(`  merkle siblings   ${d.merkleProof.siblings.length}`);
console.log(`  continuity roots  ${d.continuityProof.roots.length}`);

const proof = {
  chainKey,
  height: d.headerNumber,
  encodedTransaction: d.txBytes,
  merkleProof: {
    root: d.merkleProof.root,
    siblings: d.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })),
  },
  continuityProof: {
    lowerEndpointDigest: d.continuityProof.lowerEndpointDigest,
    roots: d.continuityProof.roots,
  },
};

// ------------------------------------------------------------------ submit

const assetKey = await registry.assetKeyOf(chainKey, parsed.args.collateralToken, parsed.args.tokenId);
console.log(`\nassetKey  ${assetKey}`);

try {
  await registry.registerPledge.staticCall(proof);
} catch (error) {
  const decoded = registry.interface.parseError(error.data ?? error.error?.data ?? "0x");
  if (decoded?.name === "AssetNotFree") {
    console.log("\nDOUBLE PLEDGE REFUSED");
    console.log(`  assetKey  ${decoded.args.assetKey}`);
    console.log(`  incumbent ${decoded.args.incumbent}`);
    console.log(`  this asset is already pledged; the registry will not record a second lien`);

    /**
     * The refusal is already conclusive off-chain, so submitting it costs gas
     * and produces a failed transaction on purpose. Worth it for a demo: a
     * reverted transaction in the explorer is checkable by anybody, while a
     * console line is not.
     */
    if (process.env.FORCE_SUBMIT === "1") {
      const rejected = await registry.registerPledge(proof, { gasLimit: 1_000_000 });
      console.log(`\n  submitted anyway ${rejected.hash}`);
      const outcome = await cc3.waitForTransaction(rejected.hash);
      console.log(`  mined    block ${outcome.blockNumber}, status ${outcome.status} (0 is the refusal)`);
      console.log(`  explorer ${EXPLORER}/tx/${rejected.hash}`);
    }
    process.exit(2);
  }
  throw error;
}

const tx = await registry.registerPledge(proof);
console.log(`\nsubmitted ${tx.hash}`);
const mined = await tx.wait();
console.log(`mined     block ${mined.blockNumber}, gas ${mined.gasUsed}`);
console.log(`explorer  ${EXPLORER}/tx/${tx.hash}`);

const record = await registry.getStatus(assetKey);
console.log("\nregistry record");
console.log(`  state       ${STATE_NAMES[Number(record.state)]}`);
console.log(`  emitter     ${record.emitter}`);
console.log(`  borrower    ${record.borrower}`);
console.log(`  amount      ${ethers.formatEther(record.amount)}`);
console.log(`  instanceId  ${record.instanceId}`);
console.log(`  chainKey    ${record.chainKey}`);
console.log(`  height      ${record.sourceHeight}`);
