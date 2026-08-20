import { ethers } from "ethers";
import { proofProvider } from "@gluwa/usc-sdk";
import { OPERATIONS, REGISTRY_ABI, STATE_NAMES } from "./abi.mjs";
import { findSourceEvent } from "./schemas.mjs";
import { attestedTip, resolveChainKey } from "./chainkey.mjs";
import {
  CC3_RPC,
  EXPLORER,
  PROVER_URL,
  SOURCE_CHAIN_ID,
  SOURCE_RPC,
  loadPrivateKey,
  requireAddress,
} from "./config.mjs";

/**
 * Relaying one source-chain event into the registry, as a library.
 *
 * The relay is trusted with nothing. It carries bytes: the transaction, a merkle
 * proof of its place in a block, and a continuity proof back to an attested
 * checkpoint. Every claim in those bytes is re-checked by the BlockProver
 * precompile inside the registry's own transaction, so a lying relay produces a
 * reverted transaction and nothing else.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Which emitter this relay files for: the first allowlisted address in the
 * receipt.
 *
 * The registry picks nothing, so this is a convenience for a command line that
 * takes a transaction hash and no more. Anything the relay chooses here it then
 * states in the proof, and the registry checks the named log against the named
 * address rather than searching for either.
 */
export async function chooseEmitter(registry, chainKey, receipt) {
  const seen = new Set();
  for (const entry of receipt.logs) {
    const address = ethers.getAddress(entry.address);
    if (seen.has(address)) continue;
    seen.add(address);
    if (await registry.allowedEmitter(chainKey, address)) return address;
  }
  throw new Error(
    `no allowlisted emitter among ${seen.size} contracts in the receipt; run setEmitter first`,
  );
}

/**
 * A source provider that survives one node not having the transaction.
 *
 * ethers' FallbackProvider quorums across endpoints, which is the wrong shape
 * here: a node that answers null is not lying, it just does not have the data,
 * and one honest answer is enough. So the endpoints are tried in order and the
 * first non-empty answer wins.
 */
export function sourceProvider(rpcs = SOURCE_RPC) {
  const urls = String(rpcs).split(",").map((u) => u.trim()).filter(Boolean);
  const providers = urls.map((url) => new ethers.JsonRpcProvider(url));
  if (providers.length === 1) return providers[0];

  return new Proxy(providers[0], {
    get(target, prop) {
      const original = target[prop];
      if (typeof original !== "function" || !String(prop).startsWith("get")) {
        return typeof original === "function" ? original.bind(target) : original;
      }
      return async (...args) => {
        let lastError;
        for (const provider of providers) {
          try {
            const answer = await provider[prop](...args);
            if (answer !== null && answer !== undefined) return answer;
          } catch (error) {
            lastError = error;
          }
        }
        if (lastError) throw lastError;
        return null;
      };
    },
  });
}

export function connect(sourceRpc = SOURCE_RPC) {
  const source = sourceProvider(sourceRpc);
  const cc3 = new ethers.JsonRpcProvider(CC3_RPC);
  const wallet = new ethers.Wallet(loadPrivateKey(), cc3);
  const registry = new ethers.Contract(requireAddress("registry"), REGISTRY_ABI, wallet);
  return { source, cc3, wallet, registry };
}

/**
 * Waits for the same condition the registry enforces, `height + depth <= tip`.
 * Waiting for it off-chain turns an inevitable revert into a wait.
 */
export async function waitForFinality({ cc3, chainKey, height, depth, pollSeconds = 30, log }) {
  for (;;) {
    const tip = await attestedTip(cc3, chainKey);
    const ready = tip.exists && height + depth <= tip.height;
    log?.(
      `  attested tip ${tip.height}, need ${height + depth}` +
        (ready ? "  ready" : `  waiting ${height + depth - tip.height} blocks`),
    );
    if (ready) return tip;
    await sleep(pollSeconds * 1000);
  }
}

/**
 * The SDK defaults to a ten second timeout, which is fine for a small Sepolia
 * transaction and not fine for a mainnet one: an old, twelve kilobyte payload
 * with eighty continuity roots takes the prover longer than that to assemble.
 * A short timeout there looks like a refusal and is not one, so this waits
 * properly and retries a couple of times before believing the answer.
 */
export async function fetchProof(chainKey, txHash, { emitter, logIndex, attempts = 3, log } = {}) {
  const timeout = Number(process.env.PROOF_TIMEOUT_MS ?? 120_000);
  const builder = new proofProvider.service.ProofBuilder(chainKey, PROVER_URL, timeout);

  let result;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    result = await builder.getProof(txHash);
    if (result.success && result.data) break;
    log?.(`  prover attempt ${attempt} failed: ${result.error ?? "unknown error"}`);
    if (attempt < attempts) await sleep(5000);
  }
  if (!result.success || !result.data) {
    throw new Error(`prover refused: ${result.error ?? "unknown error"}`);
  }
  const d = result.data;
  return {
    raw: d,
    proof: {
      chainKey,
      height: d.headerNumber,
      emitter,
      logIndex,
      encodedTransaction: d.txBytes,
      merkleProof: {
        root: d.merkleProof.root,
        siblings: d.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })),
      },
      continuityProof: {
        lowerEndpointDigest: d.continuityProof.lowerEndpointDigest,
        roots: d.continuityProof.roots,
      },
    },
  };
}

/**
 * Runs one operation end to end.
 *
 * Returns `{ outcome: "recorded" }` with the Creditcoin transaction, or
 * `{ outcome: "refused" }` carrying the decoded registry error. A refusal is an
 * answer, not a failure: it is the registry doing its job.
 */
export async function relay({
  txHash,
  operation = "pledge",
  force = false,
  sourceChainId = SOURCE_CHAIN_ID,
  sourceRpc = SOURCE_RPC,
  log = () => {},
}) {
  const op = OPERATIONS[operation];
  if (!op) throw new Error(`unknown operation ${operation}`);

  const { source, cc3, registry } = connect(sourceRpc);

  const receipt = await source.getTransactionReceipt(txHash);
  if (!receipt) throw new Error(`no receipt on the source chain for ${txHash}`);

  const chainKey = await resolveChainKey(cc3, sourceChainId);
  const emitter = await chooseEmitter(registry, chainKey, receipt);
  const { schema, position, parsed, fields } = findSourceEvent(receipt, operation, emitter);
  log(`operation  ${operation}  ->  registry.${op.method}`);
  log("source");
  log(`  tx         ${txHash}`);
  log(`  block      ${receipt.blockNumber}, status ${receipt.status}`);
  log(`  schema     ${schema.name}, event ${parsed.name} from ${emitter}`);
  log(`  log index  ${position} of ${receipt.logs.length} in the receipt`);
  log(`  token      ${fields.token} #${fields.tokenId}`);
  log(`  borrower   ${fields.borrower}`);
  log(`  amount     ${fields.amount}`);
  log(`  instanceId ${fields.instanceId}`);

  const depth = Number(await registry.minConfirmations(chainKey));

  log("\ncreditcoin");
  log(`  registry   ${await registry.getAddress()}`);
  log(`  chainId ${sourceChainId} -> chainKey ${chainKey}`);
  log(`  minConf    ${depth}`);
  log(`  emitter    ${emitter}, allowlisted`);

  await waitForFinality({ cc3, chainKey, height: receipt.blockNumber, depth, log });

  /*
    The registry no longer searches the receipt for the log it is being asked
    about, so the relay has to name it. This is the same log findSourceEvent
    picked under the same emitter, which is what keeps the two in agreement.
  */
  const { raw, proof } = await fetchProof(chainKey, txHash, {
    emitter,
    logIndex: position,
    log,
  });
  log("\nproof");
  log(`  headerNumber      ${raw.headerNumber}`);
  log(`  txIndex           ${raw.txIndex}`);
  log(`  txBytes           ${(raw.txBytes.length - 2) / 2} bytes`);
  log(`  merkle siblings   ${raw.merkleProof.siblings.length}`);
  log(`  continuity roots  ${raw.continuityProof.roots.length}`);

  /**
   * A lifecycle event that does not name the collateral is resolved the same way
   * the registry resolves it: through the lien this emitter has open under that
   * instance id.
   */
  const assetKey =
    fields.token === ethers.ZeroAddress
      ? await registry.assetOfInstance(chainKey, emitter, fields.instanceId)
      : await registry.assetKeyOf(chainKey, fields.token, fields.tokenId);

  if (assetKey === ethers.ZeroHash) {
    throw new Error(`no open lien for ${emitter} instance ${fields.instanceId}`);
  }
  log(`\nassetKey  ${assetKey}`);

  let refusal = null;
  try {
    await registry[op.method].staticCall(proof);
  } catch (error) {
    refusal = registry.interface.parseError(error.data ?? error.error?.data ?? "0x");
    if (!refusal) throw error;
  }

  if (refusal) {
    log(`\nREFUSED  ${refusal.name}(${refusal.args.map(String).join(", ")})`);
    let forced = null;
    if (force) {
      /**
       * The refusal is already conclusive off-chain, so submitting it costs gas
       * and produces a failed transaction on purpose. Worth it for a demo: a
       * revert in the explorer is checkable by anybody, a console line is not.
       */
      const rejected = await registry[op.method](proof, { gasLimit: 1_000_000 });
      const outcome = await cc3.waitForTransaction(rejected.hash);
      forced = { hash: rejected.hash, status: outcome.status, block: outcome.blockNumber };
      log(`  submitted anyway ${rejected.hash}`);
      log(`  mined    block ${outcome.blockNumber}, status ${outcome.status} (0 is the refusal)`);
      log(`  explorer ${EXPLORER}/tx/${rejected.hash}`);
    }
    return { outcome: "refused", assetKey, error: refusal, forced };
  }

  const tx = await registry[op.method](proof);
  const mined = await tx.wait();
  log(`\nsubmitted ${tx.hash}`);
  log(`mined     block ${mined.blockNumber}, gas ${mined.gasUsed}`);
  log(`explorer  ${EXPLORER}/tx/${tx.hash}`);

  const record = await registry.getStatus(assetKey);
  const collisions = Number(await registry.collisionCount(assetKey));
  log("\nregistry record");
  log(`  state       ${STATE_NAMES[Number(record.state)]}`);
  log(`  emitter     ${record.emitter}`);
  log(`  amount      ${record.amount}`);
  log(`  instanceId  ${record.instanceId}`);
  log(`  certificate ${await registry.certificateOf(assetKey)}`);
  log(`  collisions  ${collisions}`);

  return {
    outcome: "recorded",
    assetKey,
    hash: tx.hash,
    block: mined.blockNumber,
    gasUsed: mined.gasUsed,
    state: STATE_NAMES[Number(record.state)],
    collisions,
  };
}
