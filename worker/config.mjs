import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const CC3_RPC = process.env.CC3_RPC ?? "https://rpc.cc3-testnet.creditcoin.network";
export const PROVER_URL =
  process.env.PROVER_URL ?? "https://prover.cc3-testnet.creditcoin.network";
export const SEPOLIA_RPC =
  process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";

/**
 * The chain the pledges are read from. Sepolia by default, because that is
 * where the demo lenders live, but the registry reads any chain Creditcoin
 * attests, and NFTfi on Ethereum mainnet is read through the same path.
 */
export const SOURCE_RPC = process.env.SOURCE_RPC ?? SEPOLIA_RPC;

/** Pin the chain id, never the chain key. The key differs per Creditcoin network. */
export const SOURCE_CHAIN_ID = Number(process.env.SOURCE_CHAIN_ID ?? 11155111);

export const CHAIN_INFO = "0x0000000000000000000000000000000000000fD3";
export const EXPLORER = "https://creditcoin-testnet.blockscout.com";

const deployedPath = path.join(here, "deployed.json");
const deployed = fs.existsSync(deployedPath)
  ? JSON.parse(fs.readFileSync(deployedPath, "utf8"))
  : {};

export const addresses = {
  registry: process.env.REGISTRY ?? deployed.registry,
  deed: process.env.DEED ?? deployed.deed,
  harbor: process.env.HARBOR ?? deployed.harbor,
  meridian: process.env.MERIDIAN ?? deployed.meridian,
  borrower: process.env.BORROWER ?? deployed.borrower,
  tokenId: process.env.TOKEN_ID ?? deployed.tokenId ?? 42,
  nftfi: process.env.NFTFI ?? deployed.nftfi,
  nftfiAdapter: process.env.NFTFI_ADAPTER ?? deployed.nftfiAdapter,
  blend: process.env.BLEND ?? deployed.blend,
  blendAdapter: process.env.BLEND_ADAPTER ?? deployed.blendAdapter,
};

export function saveDeployed(patch) {
  const merged = { ...deployed, ...patch };
  fs.writeFileSync(deployedPath, `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

/**
 * The signing key is read from a file by default. Passing a raw key on the
 * command line puts it in the shell history of whoever runs the demo.
 */
export function loadPrivateKey() {
  if (process.env.PRIVATE_KEY) return process.env.PRIVATE_KEY.trim();
  const file = process.env.DEPLOYER_KEY_FILE;
  if (file && fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  throw new Error("set PRIVATE_KEY or DEPLOYER_KEY_FILE");
}

export function requireAddress(name) {
  const value = addresses[name];
  if (!value) throw new Error(`missing address for ${name}; set ${name.toUpperCase()} or fill worker/deployed.json`);
  return value;
}
