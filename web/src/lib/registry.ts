/**
 * The chain layer.
 *
 * Hand written ABI encoding, because every call this app makes is four static
 * words wide and a library would weigh more than the whole read path. Nothing
 * here is trusted: each value comes back from an eth_call anybody can repeat.
 */

const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);

const DEPLOYED = "0xcccE8847a63f6fD460FA86CDaE8a05bAe102e0F7";

export const CFG = {
  rpc: params.get("rpc") ?? "https://rpc.cc3-testnet.creditcoin.network",
  registry: params.get("registry") ?? DEPLOYED,
  explorer: "https://creditcoin-testnet.blockscout.com",
  chainInfo: "0x0000000000000000000000000000000000000fD3",
  stash: "0x0000000000000000000000000000000000000fd4",
  prover: "0x0FD2",
};

/**
 * How the register's logs are swept, in one object.
 *
 * `genesis` is the Creditcoin block the register was created in. A sweep needs a
 * floor, and a fixed lookback is the wrong one: it is correct on the day it is
 * written and silently blind afterwards, because the chain moves and the records
 * do not. This floor cannot go stale, and `script/audit-claims.mjs` holds it to
 * the chain by asserting the address has code here and none in the block before.
 *
 * The numbers live together in an object so that the built bundle still states
 * them where a script can read them: property names survive minification, and a
 * standalone constant does not. `script/history-still-visible.mjs` pulls these
 * out of the JavaScript the site is actually serving and repeats the sweep,
 * which is the only way to catch a floor that has gone blind. Every other check
 * in this repository stayed green through three days of exactly that.
 */
export const SWEEP = { genesis: 5_344_289, size: 16_000, lanes: 4 };

/// Null when the page was pointed at a register whose first block it cannot know.
export const GENESIS: number | null =
  CFG.registry.toLowerCase() === DEPLOYED.toLowerCase() ? SWEEP.genesis : null;

export const SOURCES: Record<number, { name: string; explorer: string }> = {
  11155111: { name: "Sepolia", explorer: "https://sepolia.etherscan.io" },
  1: { name: "Ethereum", explorer: "https://etherscan.io" },
};

export const COLLATERAL: Record<string, string> = {
  "0xee79491615882b5421daceb765564f4c4a09dd64": "Demo deed",
  "0xd774557b647330c91bf44cfeab205095f7e6c367": "NFTfi collateral",
  "0xbd3531da5cf5857e7cfaa92426877b022e612cf8": "Pudgy Penguins",
  "0x524cab2ec69124574082676e6f654a18df49a048": "Lil Pudgys",
  "0x60e4d786628fea6478f785a6d7e704777c86a7c6": "Mutant Ape",
};

/**
 * Names for addresses this page can recognise, and whether they are ours.
 *
 * The two demo lenders are marked because the whole claim is that the register
 * reads protocols that never heard of it. Rendering our own contracts in the
 * same typography as NFTfi would invite exactly the misreading the project
 * exists to avoid.
 */
export const OURS = new Set([
  "0xaad02e7bebc37acb5dc67c42f70d61d8c86df3e5",
  "0xfa72380654232c5538d1f17e2d8d6c261bd263ad",
]);

export const isOurs = (address: string) => OURS.has(address.toLowerCase());

export const PROTOCOLS: Record<string, string> = {
  "0xaad02e7bebc37acb5dc67c42f70d61d8c86df3e5": "Harbor Credit",
  "0xfa72380654232c5538d1f17e2d8d6c261bd263ad": "Meridian Credit",
  "0xb6adec2acc851d30d5fb64f3137234bcdcbbad0d": "NFTfi v3",
  "0x29469395eaf6f95920e59f858042f0e28d98a20b": "Blur Blend",
};

const SELECTOR = {
  assetKeyOf: "0xa5fa9d70",
  getStatus: "0x5de28ae0",
  collisionCount: "0x1cf4e706",
  collisionAt: "0x6f81b28f",
  certificateOf: "0x27027589",
  minConfirmations: "0xfd166d65",
  supportedChains: "0x69e18c3c",
  attestedTip: "0x809112da",
  minAttestors: "0x48b5474b",
  attestorsCount: "0x8de0db2f",
  minBond: "0x588a794d",
};

export const TOPIC: Record<string, EntryKind> = {
  "0xb4de7f620eb5d8eaab350bc099399f71c08c2fde907ce2b8d68f9651b0535eb8": "pledge",
  "0x78bf8702fc87c1887744d1d92e9af8673bc6da890a1da46b549888e34f4a2400": "refused",
  "0x181a581803236c268c5f5e8ad0f668e8a3032c00311e3954bcf84a3ec8d90a09": "settled",
  "0x99b0f20d6946893f54e3836d815265d601b32da1ef5a840d17fe8295e68a9bf6": "released",
};

export type EntryKind = "pledge" | "refused" | "settled" | "released";
export type AssetState = "free" | "pledged" | "settled";

const STATE: AssetState[] = ["free", "pledged", "settled"];
export const ZERO = "0x0000000000000000000000000000000000000000";

export interface RegistryLog {
  topics: string[];
  transactionHash: string;
  blockNumber: string;
  logIndex: string;
}

/**
 * How much attestor security stood behind a record when it was made.
 *
 * The registry reads these off the chain at the moment it accepts a proof and
 * stores them with the lien, so a record made under a full quorum and one made
 * under a thin one do not read the same years later.
 */
export interface Security {
  attestedTip: number;
  attestors: number;
  minBond: bigint;
}

export interface Collision {
  emitter: string;
  borrower: string;
  amount: bigint;
  sourceHeight: number;
  security: Security;
}

export interface Record_ {
  assetKey: string;
  chainId: number;
  token: string;
  tokenId: string;
  state: AssetState;
  emitter: string;
  borrower: string;
  amount: bigint;
  instanceId: string;
  sourceHeight: number;
  recordedAt: number;
  certificate: string;
  security: Security;
  collisions: Collision[];
}

export interface ChainFacts {
  chainKey: number;
  tip: number;
  depth: number;
  attestors: number;
  floor: number;
  bond: bigint;
}

const pad = (hex: string) => hex.replace(/^0x/, "").padStart(64, "0");
const word = (data: string, i: number) => data.slice(2 + i * 64, 2 + (i + 1) * 64);
const big = (w: string) => BigInt("0x" + w);
const addr = (w: string) => "0x" + w.slice(24);
const uint = (v: string | number | bigint) => pad(BigInt(v).toString(16));

/**
 * The three trailing words of a record or a refusal. Both structs end with the
 * same block, so both are read the same way from wherever it starts.
 */
const security = (data: string, at: number): Security => ({
  attestedTip: Number(big(word(data, at))),
  attestors: Number(big(word(data, at + 1))),
  minBond: big(word(data, at + 2)),
});

let rpcId = 0;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(CFG.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  if (!res.ok) throw new Error(`the node answered ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message ?? "the node refused the call");
  return body.result as T;
}

const call = (to: string, data: string) => rpc<string>("eth_call", [{ to, data }, "latest"]);

/** A dynamic array of structs carrying a dynamic member, decoded by hand. */
function decodeChains(hex: string) {
  const base = Number(big(word(hex, 0))) / 32;
  const count = Number(big(word(hex, base)));
  const out: { chainKey: number; chainId: number }[] = [];
  for (let i = 0; i < count; i++) {
    const off = base + 1 + Number(big(word(hex, base + 1 + i))) / 32;
    out.push({ chainKey: Number(big(word(hex, off))), chainId: Number(big(word(hex, off + 1))) });
  }
  return out;
}

export async function readChains(): Promise<Record<number, ChainFacts>> {
  const chains = decodeChains(await call(CFG.chainInfo, SELECTOR.supportedChains));
  const facts: Record<number, ChainFacts> = {};

  await Promise.all(
    chains
      .filter((c) => SOURCES[c.chainId])
      .map(async ({ chainKey, chainId }) => {
        const [tip, depth, attestors, floor, bond] = await Promise.all([
          call(CFG.chainInfo, SELECTOR.attestedTip + uint(chainKey)),
          call(CFG.registry, SELECTOR.minConfirmations + uint(chainKey)),
          call(CFG.stash, SELECTOR.attestorsCount + uint(chainKey)),
          call(CFG.registry, SELECTOR.minAttestors + uint(chainKey)),
          call(CFG.stash, SELECTOR.minBond + uint(chainKey)),
        ]);
        facts[chainId] = {
          chainKey,
          tip: Number(big(word(tip, 0))),
          depth: Number(big(word(depth, 0))),
          attestors: Number(big(word(attestors, 0))),
          floor: Number(big(word(floor, 0))),
          bond: big(word(bond, 0)),
        };
      }),
  );

  return facts;
}

export async function assetKeyOf(chainKey: number, token: string, tokenId: string) {
  return call(CFG.registry, SELECTOR.assetKeyOf + uint(chainKey) + pad(token.toLowerCase()) + uint(tokenId));
}

export async function readAsset(
  chain: ChainFacts,
  chainId: number,
  token: string,
  tokenId: string,
): Promise<Record_> {
  const assetKey = await assetKeyOf(chain.chainKey, token, tokenId);

  const [status, certificate, countHex] = await Promise.all([
    call(CFG.registry, SELECTOR.getStatus + pad(assetKey)),
    call(CFG.registry, SELECTOR.certificateOf + pad(assetKey)),
    call(CFG.registry, SELECTOR.collisionCount + pad(assetKey)),
  ]);

  const count = Number(big(word(countHex, 0)));
  const collisions = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      call(CFG.registry, SELECTOR.collisionAt + pad(assetKey) + uint(i)).then((c) => ({
        emitter: addr(word(c, 0)),
        borrower: addr(word(c, 1)),
        amount: big(word(c, 2)),
        sourceHeight: Number(big(word(c, 5))),
        security: security(c, 7),
      })),
    ),
  );

  return {
    assetKey,
    chainId,
    token,
    tokenId,
    state: STATE[Number(big(word(status, 0)))],
    emitter: addr(word(status, 1)),
    borrower: addr(word(status, 2)),
    amount: big(word(status, 3)),
    instanceId: "0x" + word(status, 4),
    sourceHeight: Number(big(word(status, 6))),
    recordedAt: Number(big(word(status, 7))),
    certificate: addr(word(certificate, 0)),
    security: security(status, 8),
    collisions,
  };
}

/**
 * The public node abandons a log query it cannot answer inside ten seconds, so
 * the register is read in windows. A window that fails costs its own slice and
 * nothing else, which is why this degrades to fewer entries rather than to an
 * error, and why the count of slices that went unanswered comes back with the
 * logs instead of being swallowed.
 *
 * The sweep runs down to the block the register was created in. It used to run
 * a fixed eight windows back from the head, which was the whole of its life on
 * the day that was written and, by the time a judge opened the page, twenty
 * thousand blocks short of every record in it. The floor has to be attached to
 * the register, not to the head, because only one of the two stands still.
 *
 * The width and the lane count are measured rather than guessed, and the
 * measurement is counterintuitive: the node scans linearly and serves these
 * queries more or less one at a time, so widening the window pays and widening
 * the concurrency does not. Against this register, 13 slices of 4,000 across 4
 * lanes took 20 seconds, 4 slices of 16,000 took 6, and 8 lanes lost 3 slices to
 * timeouts while going slower than 4. A slice that does fail is retried once,
 * split in half, because half the range is half the work the node timed out on.
 */
export async function readLogs(
  topics: (string | null)[],
  { size = SWEEP.size, lanes = SWEEP.lanes, fallbackWindows = 2 } = {},
): Promise<{ head: number; logs: RegistryLog[]; from: number; missed: number }> {
  const head = Number(big((await rpc<string>("eth_blockNumber", [])).slice(2).padStart(64, "0")));
  const floor = Math.max(0, GENESIS ?? head - fallbackWindows * size);

  const window = ({ from, to }: { from: number; to: number }) =>
    rpc<RegistryLog[]>("eth_getLogs", [
      {
        address: CFG.registry,
        topics,
        fromBlock: "0x" + from.toString(16),
        toBlock: "0x" + to.toString(16),
      },
    ]);

  const slices = [];
  for (let to = head; to >= floor; to -= size) {
    slices.push({ from: Math.max(floor, to - size + 1), to });
  }

  const answers: (RegistryLog[] | null)[] = [];
  for (let i = 0; i < slices.length; i += lanes) {
    answers.push(
      ...(await Promise.all(
        slices.slice(i, i + lanes).map((slice) =>
          window(slice).catch(async () => {
            const mid = Math.floor((slice.from + slice.to) / 2);
            const halves = await Promise.all([
              window({ from: slice.from, to: mid }).catch(() => null),
              window({ from: mid + 1, to: slice.to }).catch(() => null),
            ]);
            return halves.some((h) => h === null) ? null : halves.flat() as RegistryLog[];
          }),
        ),
      )),
    );
  }

  const missed = answers.filter((a) => a === null).length;
  const logs = answers.flatMap((a) => a ?? []).filter((l) => TOPIC[l.topics[0]]);
  logs.sort(
    (a, b) =>
      Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)) ||
      Number(BigInt(b.logIndex) - BigInt(a.logIndex)),
  );
  return { head, logs, from: floor, missed };
}

export async function readState(assetKey: string) {
  const [status, countHex] = await Promise.all([
    call(CFG.registry, SELECTOR.getStatus + pad(assetKey)),
    call(CFG.registry, SELECTOR.collisionCount + pad(assetKey)),
  ]);
  return {
    state: STATE[Number(big(word(status, 0)))],
    emitter: addr(word(status, 1)),
    recordedAt: Number(big(word(status, 7))),
    collisions: Number(big(word(countHex, 0))),
  };
}

/* ------------------------------------------------------------- helpers */

export const short = (hex: string, head = 6, tail = 4) =>
  hex && hex.length > head + tail + 4 ? `${hex.slice(0, 2 + head)}…${hex.slice(-tail)}` : hex ?? "";

export const nameOf = (map: Record<string, string>, a?: string) =>
  (a ? map[a.toLowerCase()] : undefined) ?? null;

export const num = (v: number | bigint) => Number(v).toLocaleString("en-US");

/**
 * The amount exactly as the protocol wrote it, with no decimals assumed.
 *
 * The registry stores an integer and the source event carries no decimals, so
 * there is nothing here that knows whether an amount is wei or six decimal
 * USDC. Dividing by ten to the eighteen anyway printed a five thousand dollar
 * NFTfi loan as `0`, under a label that said "in the protocol's own unit". The
 * raw integer is that unit, and needs no caveat.
 */
export function amount(raw: bigint) {
  return raw.toLocaleString("en-US");
}

/**
 * A CTC bond, where the unit is known.
 *
 * Unlike a loan amount this one carries no ambiguity: the precompile returns
 * wei of CTC and nothing else, so dividing is safe here in a way it is not
 * anywhere else in this file.
 */
export function ctc(wei: bigint) {
  const whole = wei / 10n ** 18n;
  return `${whole.toLocaleString("en-US")} CTC`;
}

export function ago(seconds: number) {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return `${Math.round(d / 86400)}d ago`;
}

export const txUrl = (hash: string) => `${CFG.explorer}/tx/${hash}`;
export const srcUrl = (chainId: number, path: string) => `${SOURCES[chainId]?.explorer}/${path}`;

export const ENTRY_WORDS: Record<EntryKind, string> = {
  pledge: "Lien recorded, first to file",
  refused: "Second pledge refused, kept on file",
  settled: "Debt behind the lien settled",
  released: "Lien released, asset free again",
};

/** The register indexes by hash, so the assets it has handled are named here. */
export const KNOWN_ASSETS = [
  { chainId: 11155111, token: "0xee79491615882b5421dACEb765564f4c4a09dd64", tokenId: "43" },
  { chainId: 11155111, token: "0xee79491615882b5421dACEb765564f4c4a09dd64", tokenId: "42" },
  { chainId: 1, token: "0xd774557b647330C91Bf44cfEAB205095f7E6c367", tokenId: "7819" },
  { chainId: 1, token: "0xBd3531dA5CF5857e7CfAA92426877b022e612cf8", tokenId: "8189" },
  { chainId: 1, token: "0xBd3531dA5CF5857e7CfAA92426877b022e612cf8", tokenId: "4271" },
];
