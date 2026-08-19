/**
 * The chain layer.
 *
 * Hand written ABI encoding, because every call this app makes is four static
 * words wide and a library would weigh more than the whole read path. Nothing
 * here is trusted: each value comes back from an eth_call anybody can repeat.
 */

const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);

export const CFG = {
  rpc: params.get("rpc") ?? "https://rpc.cc3-testnet.creditcoin.network",
  registry: params.get("registry") ?? "0x020a11bCF77eDF881ca7FFE865390E8192CeC187",
  explorer: "https://creditcoin-testnet.blockscout.com",
  chainInfo: "0x0000000000000000000000000000000000000fD3",
  prover: "0x0FD2",
};

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

export interface Collision {
  emitter: string;
  borrower: string;
  amount: bigint;
  sourceHeight: number;
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
  collisions: Collision[];
}

export interface ChainFacts {
  chainKey: number;
  tip: number;
  depth: number;
}

const pad = (hex: string) => hex.replace(/^0x/, "").padStart(64, "0");
const word = (data: string, i: number) => data.slice(2 + i * 64, 2 + (i + 1) * 64);
const big = (w: string) => BigInt("0x" + w);
const addr = (w: string) => "0x" + w.slice(24);
const uint = (v: string | number | bigint) => pad(BigInt(v).toString(16));

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
        const [tip, depth] = await Promise.all([
          call(CFG.chainInfo, SELECTOR.attestedTip + uint(chainKey)),
          call(CFG.registry, SELECTOR.minConfirmations + uint(chainKey)),
        ]);
        facts[chainId] = {
          chainKey,
          tip: Number(big(word(tip, 0))),
          depth: Number(big(word(depth, 0))),
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
    collisions,
  };
}

/**
 * The public node abandons a log query it cannot answer inside ten seconds, so
 * the register is read in narrow windows at once. A window that fails costs its
 * own slice and nothing else, which is why this degrades to fewer entries
 * rather than to an error.
 */
export async function readLogs(
  topics: (string | null)[],
  { windows = 8, size = 4000 } = {},
): Promise<{ head: number; logs: RegistryLog[] }> {
  const head = Number(big((await rpc<string>("eth_blockNumber", [])).slice(2).padStart(64, "0")));
  const slices = Array.from({ length: windows }, (_, i) => {
    const to = head - i * size;
    return { from: Math.max(0, to - size + 1), to };
  }).filter((w) => w.to >= 0);

  const answers = await Promise.all(
    slices.map(({ from, to }) =>
      rpc<RegistryLog[]>("eth_getLogs", [
        {
          address: CFG.registry,
          topics,
          fromBlock: "0x" + from.toString(16),
          toBlock: "0x" + to.toString(16),
        },
      ]).catch(() => [] as RegistryLog[]),
    ),
  );

  const logs = answers.flat().filter((l) => TOPIC[l.topics[0]]);
  logs.sort(
    (a, b) =>
      Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)) ||
      Number(BigInt(b.logIndex) - BigInt(a.logIndex)),
  );
  return { head, logs };
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

export function ether(wei: bigint) {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
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
  { chainId: 11155111, token: "0xee79491615882b5421dACEb765564f4c4a09dd64", tokenId: "42" },
  { chainId: 1, token: "0xd774557b647330C91Bf44cfEAB205095f7E6c367", tokenId: "7819" },
  { chainId: 1, token: "0xBd3531dA5CF5857e7CfAA92426877b022e612cf8", tokenId: "8189" },
  { chainId: 1, token: "0xBd3531dA5CF5857e7CfAA92426877b022e612cf8", tokenId: "4271" },
];
