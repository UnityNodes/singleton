import { ethers } from "ethers";
import { CC3_RPC, CHAIN_INFO, SOURCE_CHAIN_ID } from "./config.mjs";

const CHAIN_INFO_ABI = [
  "function get_supported_chains() view returns (tuple(uint64 chainKey, uint64 chainId, bytes chainName, uint8 chainEncoding)[])",
  "function get_latest_attestation_height_and_hash(uint64) view returns (tuple(uint64 height, bytes32 hash, bool isAttestation, bool exists))",
];

export function chainInfo(provider) {
  return new ethers.Contract(CHAIN_INFO, CHAIN_INFO_ABI, provider);
}

/**
 * Resolves a universal EVM chain id to the key this Creditcoin network uses.
 *
 * Measured on both live networks: key 1 is Sepolia on CC3 testnet and Ethereum
 * on CC3 mainnet. Anything that pins the key instead of the id reads a different
 * chain after promotion without a single line changing.
 */
export async function resolveChainKey(provider, chainId = SOURCE_CHAIN_ID) {
  const chains = await chainInfo(provider).get_supported_chains();
  const hit = chains.find((c) => Number(c.chainId) === Number(chainId));
  if (!hit) {
    const known = chains.map((c) => `${c.chainKey}->${c.chainId}`).join(", ");
    throw new Error(`chain id ${chainId} is not attested here; supported: ${known}`);
  }
  return Number(hit.chainKey);
}

export async function attestedTip(provider, chainKey) {
  const tip = await chainInfo(provider).get_latest_attestation_height_and_hash(chainKey);
  return { height: Number(tip.height), exists: tip.exists };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const provider = new ethers.JsonRpcProvider(CC3_RPC);
  const chainId = Number(process.argv[2] ?? SOURCE_CHAIN_ID);
  const key = await resolveChainKey(provider, chainId);
  const tip = await attestedTip(provider, key);
  console.log(`chainId ${chainId} -> chainKey ${key}`);
  console.log(`attested tip ${tip.height} (exists ${tip.exists})`);
}
