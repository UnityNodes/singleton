import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Checks every hash and address this repository states against the chains.
 *
 * Written after the third time a stale reference survived a redeploy. The
 * pattern is always the same: a transaction that was true on the registry
 * deployed last week still resolves, still decodes, and still looks right in a
 * browser, so nothing about reading the page tells you it belongs to a contract
 * the project no longer runs. Only a machine that knows which registry is
 * current can see it.
 *
 * History is not the failure. docs/VERIFICATION.md names superseded
 * deployments on purpose, so it is exempt; everywhere else, a Creditcoin
 * transaction has to belong to the registry that is live now.
 *
 *   node script/audit-claims.mjs
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deployed = JSON.parse(fs.readFileSync(path.join(root, "worker/deployed.json"), "utf8"));
const CURRENT = deployed.registry.toLowerCase();

/** The history file states what was superseded and why. It is the one place stale is correct. */
const KEEPS_HISTORY = new Set(["docs/VERIFICATION.md"]);

const CC3 = "https://rpc.cc3-testnet.creditcoin.network";
/*
  Several Sepolia endpoints, and the reason is measured rather than defensive:
  publicnode answers null for receipts this project cites and tenderly answers
  them, so an audit with one endpoint reports missing transactions that exist.
*/
const SEPOLIA = [
  "https://sepolia.gateway.tenderly.co",
  "https://ethereum-sepolia-rpc.publicnode.com",
];
const MAINNET = ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"];

const files = execSync(
  "git ls-files 'docs/*.md' 'README.md' 'deck/*.html' 'deck/*.py' 'deck/*.md' " +
    "'worker/*.mjs' 'worker/*.json' 'src/**' 'test/**' 'script/*' 'web/src/**' " +
    "| grep -v pitch.html",
  { cwd: root, encoding: "utf8" },
).trim().split("\n");

const seen = new Map();
for (const rel of files) {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  for (const m of text.matchAll(/0x[0-9a-fA-F]{64}\b/g)) {
    const h = m[0].toLowerCase();
    if (!seen.has(h)) seen.set(h, new Set());
    seen.get(h).add(rel);
  }
}

let id = 0;
async function receipt(urls, hash) {
  for (const url of [].concat(urls)) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: ++id, method: "eth_getTransactionReceipt", params: [hash],
        }),
      });
      const { result } = await r.json();
      if (result) return result;
    } catch {}
  }
  return null;
}

const findings = [];
let onChain = 0;
let notTransactions = 0;

for (const [hash, where] of seen) {
  const cc3 = await receipt(CC3, hash);
  if (cc3) {
    onChain++;
    const to = (cc3.to ?? "").toLowerCase();
    const stale = [...where].filter((f) => !KEEPS_HISTORY.has(f));
    if (to !== CURRENT && stale.length > 0) {
      findings.push(
        `${hash}\n    is a Creditcoin transaction to ${to},\n` +
          `    but the live registry is ${CURRENT}\n` +
          `    cited in: ${stale.join(", ")}`,
      );
    }
    continue;
  }
  if ((await receipt(SEPOLIA, hash)) || (await receipt(MAINNET, hash))) {
    onChain++;
    continue;
  }
  notTransactions++;
}

console.log(`${seen.size} distinct 32 byte values across ${files.length} tracked files`);
console.log(`  ${onChain} are transactions on Creditcoin, Sepolia or Ethereum`);
console.log(`  ${notTransactions} are not, which is expected: event signatures, asset keys, instance ids`);

if (findings.length === 0) {
  console.log(`\nevery cited Creditcoin transaction belongs to the live registry`);
  process.exit(0);
}
console.log(`\n${findings.length} stale reference${findings.length === 1 ? "" : "s"}:\n`);
for (const f of findings) console.log(`  ${f}\n`);
process.exit(1);
