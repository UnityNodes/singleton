/*
  Does the register still show a judge the trail behind a record?

  The state of an asset is a direct call and cannot go stale. Its history is a
  log sweep, and a sweep has a floor, and a floor is exactly the sort of number
  that is right on the day it is written and silently wrong a week later. That
  is not a hypothetical: the page shipped with a fixed 32,000 block lookback,
  the register's records fell out of the bottom of it around 2026-08-26, and for
  three days every asset on the page rendered an empty history while every other
  check in this repository stayed green.

  So this reads the bundle the site is actually serving rather than the source
  in the tree, pulls the floor and the window width out of it, and sweeps for a
  demo asset the deck names. Zero entries is a failure.

    node script/history-still-visible.mjs
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deployed = JSON.parse(fs.readFileSync(path.join(root, "worker/deployed.json"), "utf8"));
const SITE = process.env.SITE ?? "https://singleton.unitynodes.com";
const RPC = "https://rpc.cc3-testnet.creditcoin.network";

const rpc = async (method, params) => {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const { result, error } = await r.json();
  if (error) throw new Error(error.message);
  return result;
};

const die = (why) => {
  console.log(`  ${why}`);
  process.exit(1);
};

const index = await fetch(`${SITE}/`).then((r) => r.text());
const asset = index.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
if (!asset) die(`${SITE}/ served no application bundle to read`);
const bundle = await fetch(`${SITE}${asset}`).then((r) => r.text());

const stated = bundle.match(/genesis:(\d+),size:(\d+(?:e\d+)?)/);
const floor = Number(stated?.[1]);
const size = Number(stated?.[2]);
if (!floor || !size) die(`${asset} states no sweep floor and width this script can read`);

/*
  The deck and the one pager both point a judge at this asset, so it is the one
  whose trail has to be there. Its key is a pure hash of chain key, token and id,
  so it is derived here rather than pasted.
*/
const key = await rpc("eth_call", [
  {
    to: deployed.registry,
    data:
      "0xa5fa9d70" +
      deployed.sourceChainKey.toString(16).padStart(64, "0") +
      deployed.deed.slice(2).toLowerCase().padStart(64, "0") +
      (43).toString(16).padStart(64, "0"),
  },
  "latest",
]);

const head = Number(await rpc("eth_blockNumber", []));
const slices = [];
for (let to = head; to >= floor; to -= size) slices.push({ from: Math.max(floor, to - size + 1), to });

let logs = [];
let missed = 0;
for (const { from, to } of slices) {
  try {
    logs = logs.concat(
      await rpc("eth_getLogs", [
        {
          address: deployed.registry,
          topics: [null, key],
          fromBlock: "0x" + from.toString(16),
          toBlock: "0x" + to.toString(16),
        },
      ]),
    );
  } catch {
    missed++;
  }
}

if (logs.length === 0) {
  die(
    `the served page sweeps ${floor.toLocaleString()} to ${head.toLocaleString()} ` +
      `in ${slices.length} windows of ${size.toLocaleString()} and finds no history ` +
      `for the asset the deck points at${missed ? `, with ${missed} unanswered` : ""}`,
  );
}

const at = logs.map((l) => parseInt(l.blockNumber, 16));
console.log(
  `  ${logs.length} entries for the deck's asset, in blocks ` +
    `${Math.min(...at).toLocaleString()} to ${Math.max(...at).toLocaleString()}, ` +
    `inside a sweep that floors at ${floor.toLocaleString()}` +
    `${missed ? ` (${missed} window${missed === 1 ? "" : "s"} unanswered)` : ""}`,
);
