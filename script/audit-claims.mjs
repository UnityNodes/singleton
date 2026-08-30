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
/*
  Keeping a superseded address and abbreviating one are different faults, and
  they used to share an exemption. docs/VERIFICATION.md is a history, so a stale
  address in it is the point; an eight character prefix in it is not, and 28 of
  them sat there under a rule this project states in CAVEATS.md caveat 6 as
  "eight hex characters is not a transaction anybody can look up". Only the file
  that names the rule and this file, which has to quote prefixes to test for
  them, are exempt now.
*/
const SHORT_EXEMPT = new Set(["worker/deployed.json", "docs/CAVEATS.md", "script/audit-claims.mjs"]);

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

/*
  The rule CAVEATS caveat 6 states, enforced where it was being broken. An
  ellipsis after a hex prefix is what marks it as a truncated identifier rather
  than a four byte selector, and a truncated identifier is not something a reader
  can look up. Twenty eight of them sat in the verification log, which is the one
  document whose whole job is to be checkable.
*/
for (const rel of files) {
  if (SHORT_EXEMPT.has(rel) || !rel.endsWith(".md")) continue;
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  for (const m of text.matchAll(/0x[0-9a-fA-F]{4,63}(?:\.\.\.|\u2026)/g)) {
    findings.push(
      `${m[0]} in ${rel}\n    is a truncated identifier, which caveat 6 says nobody can look up`,
    );
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

/*
  Stage five: the counts that drift.
 
  A test count, a proof count, a slide count and a running time are each stated
  in several files and computed in none of them, so every redeploy and every
  re release updates some of the places and misses others. Three of these have
  already been wrong in public. The truth is computable from what is in the
  repository, so it is computed and the prose is checked against it.
*/
const WORDS = {
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const numberOf = (t) => (/^\d+$/.test(t) ? Number(t) : WORDS[t.toLowerCase()] ?? null);
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

/*
  The one pager states its numbers as markup, `<span class="big">15</span><p>
  inclusion proofs`, so a pattern expecting the number beside the noun sees
  nothing there. It went out for weeks saying 12 proofs, 61 tests and a running
  time of 1:25 while the repository held 15, 88 and 1:47, and every check here
  passed the whole time because none of them opened it. Reading the artefact
  found that, not reading the files the checks already knew about.
*/
const prose = (rel) =>
  rel.endsWith(".html") || rel.endsWith("build.py")
    ? read(rel)
        .replace(/<style[\s\S]*?<\/style>/g, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
    : read(rel);
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;

const tests = execSync("cat test/*.t.sol | grep -c 'function test_'", { cwd: root, encoding: "utf8" }).trim();
const steps = JSON.parse(read("worker/demo.json")).steps.length;
const slides = (read("deck/pitch.html").match(/class="slide slide-accent"/g) ?? []).length;
const runtime = Number(read("web/src/routes/Demo.tsx").match(/const RUNTIME = (\d+)/)?.[1]);
const chapters = (read("web/src/routes/Demo.tsx").match(/^\s*\{ at: \d+,/gm) ?? []).length;
let seconds = null;
try {
  seconds = Number(execSync(
    "ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 web/public/demo/singleton.mp4",
    { cwd: root, encoding: "utf8" },
  ).trim());
} catch {}

const counts = [
  { what: "tests", truth: Number(tests), re: /\b(\d+) tests\b/g,
    where: ["README.md", "deck/build.py", "web/src/routes/Demo.tsx", "deck/one-pager.html"] },
  { what: "proofs", truth: steps, re: /\b(\w+|\d+) (?:inclusion )?proofs\b/g,
    where: ["README.md", "docs/DEMO.md", "docs/QUESTIONS.md", "deck/one-pager.html", "deck/build.py"],
    /* A count under ten is a part of the run, not the run. Only totals are checked. */
    skip: (n) => n === null || n < 10 },
  { what: "slides", truth: slides, re: /\b(\w+|\d+) slides\b/g, where: ["README.md"] },
  /*
    The caveat count is the one number in this repository that only ever grows,
    which is exactly why the prose about it goes stale without anyone noticing:
    nothing breaks when a page still says nine and the file holds thirteen.
  */
  { what: "limitations", truth: (read("docs/CAVEATS.md").match(/^## \d+\./gm) ?? []).length,
    re: /\b(\w+|\d+) (?:real )?limitations\b/g,
    where: ["README.md", "docs/CAVEATS.md", "docs/QUESTIONS.md", "deck/build.py"] },
  { what: "chapters", truth: chapters, re: /^\| (\d) \| \d:\d\d to/gm, where: ["docs/DEMO.md"],
    last: true },
];

let checkedCounts = 0;
for (const c of counts) {
  for (const rel of c.where) {
    const text = prose(rel);
    const hits = [...text.matchAll(c.re)].map((m) => numberOf(m[1])).filter((n) => n !== null);
    const values = c.last ? hits.slice(-1) : hits;
    for (const n of values) {
      if (c.skip?.(n)) continue;
      checkedCounts++;
      if (n !== c.truth) {
        findings.push(`${rel} says ${n} ${c.what}, and the repository has ${c.truth}`);
      }
    }
  }
}

if (seconds !== null) {
  checkedCounts++;
  if (Math.abs(runtime - seconds) > 1.5) {
    findings.push(`web/src/routes/Demo.tsx sets RUNTIME ${runtime}, and the video is ${seconds.toFixed(1)}s`);
  }
  /*
    Named patterns rather than the largest time in the file. Taking the maximum
    passed a mutation that changed "Total 1:45" while a table row further up
    still said 1:47, which is the failure this stage exists to catch: one place
    updated, another not. Both the statements of the total and the end of the
    last row have to agree with the file on disk.
  */
  const totals = [
    { rel: "docs/DEMO.md", re: /^Total (\d:\d\d)\./m, what: "a total" },
    { rel: "docs/DEMO.md", re: /^\| \d \| \d:\d\d to (\d:\d\d) \|/gm, what: "a last chapter ending" },
    { rel: "README.md", re: /\| The demo, (\d:\d\d) \|/, what: "a running time" },
    { rel: "deck/one-pager.html", re: /\/demo, (\d:\d\d), voiced and captioned/, what: "a running time" },
    { rel: "deck/build.py", re: /\/demo, (\d:\d\d), voiced and captioned/, what: "a running time" },
  ];
  /*
    The site says the running time in words rather than digits, and said "ninety
    seconds" for a video that had grown to 1:47. Reading the pages found it; none
    of the checks above could, because they only ever looked at two files.
  */
  const spoken = { "ninety seconds": 90, "two minutes": 120, "a minute": 60 };
  for (const rel of ["web/src/routes/Landing.tsx", "web/src/routes/Demo.tsx"]) {
    const text = read(rel);
    for (const [phrase, claimed] of Object.entries(spoken)) {
      if (!text.includes(phrase)) continue;
      checkedCounts++;
      const under = new RegExp(`under (a few )?${phrase.replace(/[a-z]+ /, "\\w+ ")}`).test(text)
        || text.includes(`under ${phrase}`);
      const ok = under ? seconds < claimed : Math.abs(seconds - claimed) <= 3;
      if (!ok) {
        findings.push(
          `${rel} says the demo runs ${under ? "under " : ""}${phrase}, and the video is ${clock(seconds)}`,
        );
      }
    }
  }
  /*
    docs/DEMO.md spells its own running time out in its title, in words, and
    that line sat at "a hundred and fourteen seconds" through two separate
    corrections of the actual duration in the body of the same file, because
    nothing had ever looked at the title. The fixed phrases above only cover a
    handful of exact strings; a title's number moves every time the recording
    does, so it is parsed rather than matched.
  */
  const ONES = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  };
  const TENS = {
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  };
  const wordsToNumber = (phrase) => {
    let total = 0, current = 0;
    for (const w of phrase.toLowerCase().split(/[\s-]+/)) {
      if (w === "a" || w === "and") continue;
      if (w === "hundred") { current = (current || 1) * 100; continue; }
      if (TENS[w] !== undefined) { current += TENS[w]; continue; }
      if (ONES[w] !== undefined) { current += ONES[w]; continue; }
      return null;
    }
    return total + current || null;
  };
  const titleMatch = read("docs/DEMO.md").match(/^# Demo, ([a-z][a-z\s-]+) seconds$/m);
  if (seconds !== null && titleMatch) {
    checkedCounts++;
    const claimed = wordsToNumber(titleMatch[1]);
    if (claimed === null || Math.abs(claimed - Math.round(seconds)) > 1) {
      findings.push(
        `docs/DEMO.md title says "${titleMatch[1]} seconds", and the video is ${Math.round(seconds)}`,
      );
    }
  }
  for (const t of totals) {
    const text = read(t.rel);
    const hits = t.re.global ? [...text.matchAll(t.re)].map((m) => m[1]) : [text.match(t.re)?.[1]];
    const stated = t.re.global ? hits.slice(-1) : hits;
    for (const v of stated.filter(Boolean)) {
      checkedCounts++;
      if (v !== clock(seconds)) {
        findings.push(`${t.rel} states ${t.what} of ${v}, and the video is ${clock(seconds)}`);
      }
    }
  }
}

console.log(`\n${checkedCounts} stated counts checked against what the repository actually holds`);
console.log(`  ${tests} tests, ${steps} proofs, ${slides} slides, ${chapters} chapters, ${seconds === null ? "video not measured" : clock(seconds) + " of video"}`);

/*
  Stage six: the tests the prose names.
 
  Several documents defend a claim by naming the test that would fail if the
  claim stopped being true, which is the strongest form of citation this project
  has and the easiest to break: renaming a test is a refactor nothing warns you
  about, and the sentence keeps its confident shape while pointing at nothing.
*/
const suite = execSync("cat test/*.t.sol", { cwd: root, encoding: "utf8" });
const cited = new Map();
for (const rel of ["README.md", ...execSync("git ls-files 'docs/*.md'", { cwd: root, encoding: "utf8" }).trim().split("\n")]) {
  for (const m of read(rel).matchAll(/\btest_[A-Za-z0-9_]+/g)) {
    if (!cited.has(m[0])) cited.set(m[0], new Set());
    cited.get(m[0]).add(rel);
  }
}
for (const [name, where] of cited) {
  if (!suite.includes(`function ${name}(`)) {
    findings.push(`${name} is cited in ${[...where].join(", ")},\n    and no test in test/ has that name`);
  }
}
console.log(`  ${cited.size} tests named in prose, each looked for in test/`);

/*
  Stage seven: links between documents.
 
  External links are deliberately not checked. The hackathon's own host answers
  405 to anything that is not a browser, and the Creditcoin RPC answers 405 to a
  GET because it is a JSON-RPC endpoint, so a checker that followed them would
  report two failures that are not failures and teach everyone to ignore it.
  Links to files in this repository have no such excuse.
*/
let links = 0;
for (const rel of ["README.md", ...execSync("git ls-files 'docs/*.md' 'deck/*.md'", { cwd: root, encoding: "utf8" }).trim().split("\n")]) {
  const dir = path.dirname(rel);
  for (const m of read(rel).matchAll(/\]\(([^)#][^)]*)\)/g)) {
    const target = m[1].split("#")[0];
    if (!target || target.startsWith("http")) continue;
    links++;
    const direct = path.join(root, target);
    const relative = path.join(root, dir, target);
    if (!fs.existsSync(direct) && !fs.existsSync(relative)) {
      findings.push(`${rel} links to ${target}, which is not a file in this repository`);
    }
  }
}
console.log(`  ${links} links between documents, each resolved to a file`);

/*
  Stage nine: the word offsets the web app decodes by.
 
  The same file that writes selectors by hand also reads return values by word
  index, and an index is even quieter than a selector when it is wrong: the call
  succeeds, a word comes back, and the page renders a real number from the wrong
  field. Adding one member to a struct is all it takes. `Record` and `Collision`
  both gained one on 2026-08-20, and nothing but a person looking at a screen
  said the offsets still lined up. The compiler knows the order, so it is asked.
*/
if (known.size > 0) {
  const abi = JSON.parse(read("out/SingletonRegistry.sol/SingletonRegistry.json")).abi;
  const layoutOf = (fn) => {
    const e = abi.find((x) => x.name === fn && x.type === "function");
    const flat = [];
    for (const c of e?.outputs?.[0]?.components ?? []) {
      if (c.components) for (const n of c.components) flat.push(`${c.name}.${n.name}`);
      else flat.push(c.name);
    }
    return flat;
  };
  const text = read("web/src/lib/registry.ts");
  let offsets = 0;
  for (const [fn, varName] of [["getStatus", "status"], ["collisionAt", "c"]]) {
    const layout = layoutOf(fn);
    const re = new RegExp(`(\\w+):[^\n]*word\\(${varName}, (\\d+)\\)`, "g");
    for (const m of text.matchAll(re)) {
      const [, field, at] = m;
      offsets++;
      const actual = layout[Number(at)];
      if (actual !== field) {
        findings.push(
          `web/src/lib/registry.ts reads ${field} from word ${at} of ${fn},\n` +
            `    and the compiled layout has ${actual ?? "nothing"} there`,
        );
      }
    }
    const sec = new RegExp(`security: security\\(${varName}, (\\d+)\\)`).exec(text);
    if (sec) {
      offsets++;
      const at = Number(sec[1]);
      if (layout[at] !== "security.attestedTip") {
        findings.push(
          `web/src/lib/registry.ts reads the attestor block from word ${at} of ${fn},\n` +
            `    and the compiled layout has ${layout[at] ?? "nothing"} there`,
        );
      }
    }
  }
  console.log(`  ${offsets} decode offsets checked against the compiled struct layout`);
}

/*
  Stage eight: the claim itself.
 
  Everything above checks what the repository says. This checks what it is for.
  The whole argument is that a lien can be on record while the asset stays in
  the borrower's own wallet, and that is two calls to verify: the registry says
  claimed, and the collateral contract on the source chain says the borrower
  still owns it. If that ever stopped being true the demo would have become
  quietly custodial and every document here would still read the same.
*/
const PLEDGED_SIG = "0xbfb86e5d7136ec550644fc6d0fcc8e6504e3dc19aacdeec2dec3d459854b4823";
const demo = JSON.parse(read("worker/demo.json"));
const registryOf = (sel, arg) => call(deployed.registry, sel + arg);
/* Several steps move the same asset, so the count is of assets and not of steps. */
const checkedAssets = new Set();
for (const step of demo.steps.filter((x) => x.operation === "pledge")) {
  const r = await receipt(SEPOLIA, step.tx);
  const log = r?.logs?.find((l) => l.topics[0]?.toLowerCase() === PLEDGED_SIG);
  if (!log) continue;
  const token = "0x" + log.topics[1].slice(26);
  const tokenId = BigInt(log.topics[2]);
  const pad = (v) => v.toString(16).padStart(64, "0");
  const assetKey = await registryOf("0xa5fa9d70", pad(1n) + pad(BigInt(token)) + pad(tokenId));
  if (!assetKey) continue;
  if (checkedAssets.has(assetKey)) continue;
  const status = await registryOf("0x5de28ae0", assetKey.slice(2));
  const state = Number(BigInt("0x" + status.slice(2, 66)));
  if (state !== 1) continue;
  checkedAssets.add(assetKey);
  const owner = "0x" + (await (async () => {
    for (const url of SEPOLIA) {
      try {
        const res = await fetch(url, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "eth_call",
            params: [{ to: token, data: "0x6352211e" + pad(tokenId) }, "latest"] }),
        });
        const { result } = await res.json();
        if (result && result !== "0x") return result.slice(26);
      } catch {}
    }
    return null;
  })());
  const borrower = "0x" + log.topics[3].slice(26);
  if (owner.toLowerCase() !== borrower.toLowerCase()) {
    findings.push(
      `token ${token} #${tokenId} is on record as claimed,\n` +
        `    but it is held by ${owner}, not by the borrower ${borrower}`,
    );
  }
}
console.log(
  `  ${checkedAssets.size} asset${checkedAssets.size === 1 ? "" : "s"} on record as claimed, ` +
    `each still in the borrower's own wallet`,
);

/*
  Stage ten: the block the register was born in.

  The page sweeps logs down to this block rather than a fixed number back from
  the head, so it is the one number that decides whether a judge sees the demo's
  history or an empty table. A recorded block is only as good as its proof, so
  it is not read back from the file that states it: the chain is asked whether
  the address has code there and none in the block before, which is true of
  exactly one block.
*/
const genesisSources = {
  "worker/deployed.json": deployed.registryBlock,
  "web/src/lib/registry.ts": Number(
    read("web/src/lib/registry.ts").match(/genesis: ([\d_]+)/)?.[1].replaceAll("_", "") ??
      NaN,
  ),
};

const codeAt = async (block) => {
  const r = await fetch(CC3, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: ++id, method: "eth_getCode",
      params: [deployed.registry, "0x" + block.toString(16)],
    }),
  });
  const { result } = await r.json();
  return result && result !== "0x";
};

const stated = new Set(Object.values(genesisSources));
if (stated.size !== 1) {
  findings.push(
    `the register's first block is stated more than one way:\n` +
      Object.entries(genesisSources).map(([f, b]) => `    ${b} in ${f}`).join("\n"),
  );
} else {
  const block = [...stated][0];
  const [here, before] = [await codeAt(block), await codeAt(block - 1)];
  if (!here || before) {
    findings.push(
      `${deployed.registry} is recorded as created in block ${block},\n` +
        `    but the chain says code ${here ? "is" : "is not"} there and ` +
        `${before ? "was already there" : "was not there"} in ${block - 1}`,
    );
  } else {
    console.log(`  the register was created in block ${block}, and the log sweep floors there`);
  }
}

if (findings.length === 0) {
  console.log(`\nevery cited Creditcoin transaction and registry address is the live one`);
  process.exit(0);
}
console.log(`\n${findings.length} stale reference${findings.length === 1 ? "" : "s"}:\n`);
for (const f of findings) console.log(`  ${f}\n`);
process.exit(1);
