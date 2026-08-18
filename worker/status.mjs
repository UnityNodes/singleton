import { ethers } from "ethers";
import { REGISTRY_ABI, STATE_NAMES } from "./abi.mjs";
import { resolveChainKey } from "./chainkey.mjs";
import { CC3_RPC, EXPLORER, SOURCE_CHAIN_ID, addresses, requireAddress } from "./config.mjs";

/**
 * What a lender would call before lending: everything the registry knows about
 * one asset, read from Creditcoin with no key and no trust.
 *
 *   node worker/status.mjs                       the demo asset
 *   node worker/status.mjs 0xToken 42
 */
const [tokenArg, idArg] = process.argv.slice(2);
const token = tokenArg ?? requireAddress("deed");
const tokenId = BigInt(idArg ?? addresses.tokenId);

const cc3 = new ethers.JsonRpcProvider(CC3_RPC);
const registry = new ethers.Contract(requireAddress("registry"), REGISTRY_ABI, cc3);
const chainKey = await resolveChainKey(cc3, SOURCE_CHAIN_ID);

const assetKey = await registry.assetKeyOf(chainKey, token, tokenId);
const record = await registry.getStatus(assetKey);
const certificate = await registry.certificateOf(assetKey);
const collisions = Number(await registry.collisionCount(assetKey));

console.log(`asset      ${token} #${tokenId} on chain id ${SOURCE_CHAIN_ID} (key ${chainKey})`);
console.log(`assetKey   ${assetKey}`);
console.log(`state      ${STATE_NAMES[Number(record.state)]}`);

if (Number(record.state) !== 0) {
  console.log(`lien held by ${record.emitter}`);
  console.log(`  borrower    ${record.borrower}`);
  console.log(`  amount      ${ethers.formatEther(record.amount)}`);
  console.log(`  instanceId  ${record.instanceId}`);
  console.log(`  proven at   source height ${record.sourceHeight}`);
  console.log(`  recorded    ${new Date(Number(record.recordedAt) * 1000).toISOString()}`);
  console.log(`  certificate ${certificate}`);
}

console.log(`\nrefused pledges on this asset: ${collisions}`);
for (let i = 0; i < collisions; i++) {
  const c = await registry.collisionAt(assetKey, i);
  console.log(
    `  ${i + 1}. ${c.emitter} for ${ethers.formatEther(c.amount)}` +
      ` at source height ${c.sourceHeight}, instance ${c.instanceId}`,
  );
}

console.log(`\nregistry ${EXPLORER}/address/${await registry.getAddress()}`);
