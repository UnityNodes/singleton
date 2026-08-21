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
/** Every full length value this repository states, and whether it is still ours. */
const verdicts = new Map();
let onChain = 0;
let notTransactions = 0;

for (const [hash, where] of seen) {
  const cc3 = await receipt(CC3, hash);
  if (cc3) {
    onChain++;
    const to = (cc3.to ?? "").toLowerCase();
    verdicts.set(hash, to === CURRENT ? "live" : "superseded");
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
    verdicts.set(hash, "source chain");
    continue;
  }
  notTransactions++;
}

console.log(`${seen.size} distinct 32 byte values across ${files.length} tracked files`);
console.log(`  ${onChain} are transactions on Creditcoin, Sepolia or Ethereum`);
console.log(`  ${notTransactions} are not, which is expected: event signatures, asset keys, instance ids`);

/*
  Stage two: addresses that behave like a registry.

  This asks the chain instead of matching text: any address cited here that
  answers `admin()` and `minAttestors(uint64)` is a SingletonRegistry, and there
  is only one live one. No list of past deployments has to be kept up to date
  for it to work, which is the point.
*/
const REGISTRY_PROBES = ["0xf851a440", "0x48b5474b0000000000000000000000000000000000000000000000000000000000000001"];

/*
  deployed.json is where `CURRENT` comes from, and it records the address it
  replaced on purpose so a redeploy leaves a trail. Auditing the source of truth
  against itself would only ever report the trail.
*/
const ADDRESS_EXEMPT = new Set([...KEEPS_HISTORY, "worker/deployed.json"]);

const addresses = new Map();
for (const rel of files) {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  for (const m of text.matchAll(/0x[0-9a-fA-F]{40}\b/g)) {
    const a = m[0].toLowerCase();
    if (!addresses.has(a)) addresses.set(a, new Set());
    addresses.get(a).add(rel);
  }
}

async function call(to, data) {
  try {
    const r = await fetch(CC3, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "eth_call", params: [{ to, data }, "latest"] }),
    });
    const { result } = await r.json();
    return result && result !== "0x" ? result : null;
  } catch { return null; }
}

/*
  Every cited address enters the dictionary, not only the superseded ones. A
  prefix of the live registry has to resolve to something, or stage three
  reports the address the project actually runs as unaccounted for.
*/
for (const addr of addresses.keys()) if (!verdicts.has(addr)) verdicts.set(addr, "address");
verdicts.set(CURRENT, "live");

const supersededRegistries = [];
let registriesSeen = 0;
for (const [addr, where] of addresses) {
  if (addr === CURRENT) continue;
  /*
    Probed even when only the history file cites it. A superseded registry named
    nowhere else still has to enter the dictionary, or stage three cannot
    recognise its abbreviation on a slide.
  */
  const answers = await Promise.all(REGISTRY_PROBES.map((d) => call(addr, d)));
  if (!answers.every(Boolean)) continue;
  verdicts.set(addr, "superseded");
  supersededRegistries.push(addr);
  registriesSeen++;
  const stale = [...where].filter((f) => !ADDRESS_EXEMPT.has(f));
  if (stale.length === 0) continue;
  findings.push(
    `${addr}\n    answers admin() and minAttestors(), so it is a SingletonRegistry,\n` +
      `    but the live one is ${CURRENT}\n    cited in: ${stale.join(", ")}`,
  );
}

console.log(
  `  ${registriesSeen} superseded registr${registriesSeen === 1 ? "y" : "ies"} named, ` +
    `which is what the history file is for`,
);

/*
  Stage three: the abbreviations.

  Both earlier stages match full length values, and the stale reference that
  survived longest was neither. It was `0x25b...` shortened to eight characters
  on a slide, which no search for forty two characters will ever find. So the
  full values already resolved above become a dictionary, and every shortened
  reference in the repository is looked up in it. What resolves to something
  superseded is named; what resolves to nothing is listed rather than passed
  over, because an abbreviation nothing accounts for is exactly where the last
  one hid.
*/
const SHORT_EXEMPT = new Set([...ADDRESS_EXEMPT, "script/audit-claims.mjs"]);

const unknown = [];
for (const rel of files) {
  if (SHORT_EXEMPT.has(rel)) continue;
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  for (const m of text.matchAll(/0x[0-9a-fA-F]{8,63}\b/g)) {
    const short = m[0].toLowerCase();
    /* Full length values are stages one and two. This stage is the shortened ones. */
    if (short.length === 42 || short.length === 66) continue;
    const matches = [...verdicts].filter(([full]) => full.startsWith(short));
    if (matches.length === 0) {
      unknown.push([short, rel]);
      continue;
    }
    const bad = matches.filter(([, v]) => v === "superseded");
    if (bad.length > 0) {
      findings.push(
        `${short} in ${rel}\n    is the start of ${bad[0][0]},\n` +
          `    which belongs to a registry that is no longer live`,
      );
    }
  }
}

if (unknown.length > 0) {
  console.log(`\n${unknown.length} shortened value${unknown.length === 1 ? "" : "s"} nothing here accounts for.`);
  console.log(`  Function selectors and interface ids look like this and are fine.`);
  for (const [short, rel] of unknown) console.log(`    ${short}  ${rel}`);
}

/*
  Stage four: the hand written selectors.

  web/src/lib/registry.ts encodes calls by hand, because every call this app
  makes is a few static words wide and a library would weigh more than the read
  path. The cost of that choice is four bytes of hex per function with nothing
  checking them: a typo does not fail to compile, it asks the chain a question
  no contract answers, and the page renders an empty value as though the chain
  had said so. The compiler already knows the right answer, in the artifact.
*/
const artifacts = [
  "out/SingletonRegistry.sol/SingletonRegistry.json",
  "out/IChainInfo.sol/IChainInfo.json",
  "out/IAttestorStash.sol/IAttestorStash.json",
];
const known = new Map();
for (const rel of artifacts) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) continue;
  const ids = JSON.parse(fs.readFileSync(full, "utf8")).methodIdentifiers ?? {};
  for (const [sig, sel] of Object.entries(ids)) known.set("0x" + sel.toLowerCase(), sig);
}

if (known.size === 0) {
  console.log(`\nno build artifacts, so the selectors were not checked. run forge build first.`);
} else {
  const file = "web/src/lib/registry.ts";
  const text = fs.readFileSync(path.join(root, file), "utf8");
  let checked = 0;
  const aliases = [];
  for (const m of text.matchAll(/^\s*(\w+):\s*"(0x[0-9a-fA-F]{8})",/gm)) {
    const [, name, sel] = m;
    const sig = known.get(sel.toLowerCase());
    checked++;
    if (!sig) {
      findings.push(`${sel} in ${file} is named ${name},\n    and no compiled function has that selector`);
    } else if (!sig.startsWith(name + "(")) {
      /*
        Not a fault. The page names ChainInfo and AttestorStash by what they do
        rather than by their selectors, which are snake_case on one precompile
        and camelCase on the other. Printed so the mapping is visible instead of
        being something a reader has to take on trust.
      */
      aliases.push(`${name} is ${sig}`);
    }
  }
  console.log(`\n${checked} hand written selectors checked against the compiled artifacts`);
  if (aliases.length > 0) {
    console.log(`  ${aliases.length} are named locally for what they do:`);
    for (const a of aliases) console.log(`    ${a}`);
  }
}

if (findings.length === 0) {
  console.log(`\nevery cited Creditcoin transaction and registry address is the live one`);
  process.exit(0);
}
console.log(`\n${findings.length} stale reference${findings.length === 1 ? "" : "s"}:\n`);
for (const f of findings) console.log(`  ${f}\n`);
process.exit(1);
