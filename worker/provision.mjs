import { ethers } from "ethers";
import { REGISTRY_ABI } from "./abi.mjs";
import { resolveChainKey } from "./chainkey.mjs";
import { CC3_RPC, EXPLORER, addresses, loadPrivateKey, requireAddress } from "./config.mjs";

/**
 * Brings a freshly deployed registry to the configuration the demo expects.
 *
 * The depth and the attestor floor for a chain are stated before any emitter on
 * it is allowlisted. The registry refuses to read a chain nobody has stated
 * both for, so the order is not cosmetic: an emitter allowlisted first would sit
 * there looking configured while every proof against it reverted.
 *
 * Chain keys are resolved live against ChainInfo, never hardcoded: key 1 is
 * Sepolia on CC3 testnet and Ethereum on CC3 mainnet.
 *
 *   node worker/provision.mjs           applies the plan
 *   node worker/provision.mjs --check   reads the registry back and says nothing
 */
const DEPTH = Number(process.env.MIN_CONFIRMATIONS ?? 64);

/*
  Below three, one attestor is a majority of the set that attested the block a
  lien was read from. Creditcoin bonds seven for Sepolia and four for Ethereum
  as this is written, so three is a floor with room to rotate rather than a
  number chosen to be met.
*/
const FLOOR = Number(process.env.MIN_ATTESTORS ?? 3);

const PLAN = [
  {
    chainId: 11155111,
    emitters: [
      { name: "Harbor Credit", address: requireAddress("harbor") },
      { name: "Meridian Credit", address: requireAddress("meridian") },
      {
        name: "Consented Credit",
        address: requireAddress("consentedCredit"),
        adapter: requireAddress("consentedAdapter"),
      },
    ],
  },
  {
    chainId: 1,
    emitters: [
      { name: "NFTfi v3", address: requireAddress("nftfi"), adapter: requireAddress("nftfiAdapter") },
      { name: "Blur Blend", address: requireAddress("blend"), adapter: requireAddress("blendAdapter") },
    ],
  },
];

/**
 * How many attestors are bonded for a chain right now, read from the same
 * precompile the registry reads. Reported next to the floor so that a passing
 * check says the guard is set and satisfied, not only that it is set.
 */
async function attestors(provider, chainKey) {
  const stash = new ethers.Contract(
    "0x0000000000000000000000000000000000000fd4",
    ["function getAttestorsCount(uint64) view returns (uint256)"],
    provider,
  );
  return stash.getAttestorsCount(chainKey);
}

const check = process.argv.includes("--check");
const cc3 = new ethers.JsonRpcProvider(CC3_RPC);
const signer = check ? cc3 : new ethers.Wallet(loadPrivateKey(), cc3);
const registry = new ethers.Contract(requireAddress("registry"), REGISTRY_ABI, signer);

console.log(`registry ${addresses.registry}`);
console.log(`${check ? "reading" : "configuring"} ${PLAN.length} source chains\n`);

let wrong = 0;

for (const chain of PLAN) {
  const chainKey = await resolveChainKey(cc3, chain.chainId);
  console.log(`chain id ${chain.chainId} -> chain key ${chainKey}`);

  const depth = Number(await registry.minConfirmations(chainKey));
  if (check) {
    console.log(`  minConfirmations ${depth}${depth === DEPTH ? "" : `  WRONG, want ${DEPTH}`}`);
    if (depth !== DEPTH) wrong++;
  } else if (depth !== DEPTH) {
    const tx = await registry.setMinConfirmations(chainKey, DEPTH);
    await tx.wait();
    console.log(`  minConfirmations ${DEPTH}  ${EXPLORER}/tx/${tx.hash}`);
  } else {
    console.log(`  minConfirmations ${DEPTH}  already set`);
  }

  const floor = Number(await registry.minAttestors(chainKey));
  const bonded = Number(await attestors(cc3, chainKey));
  if (check) {
    console.log(
      `  minAttestors ${floor}${floor === FLOOR ? "" : `  WRONG, want ${FLOOR}`}` +
        `  (${bonded} bonded right now)`,
    );
    if (floor !== FLOOR) wrong++;
    if (bonded < FLOOR) {
      console.log(`  the attestor set is below the floor, this chain records nothing`);
      wrong++;
    } else if (bonded - FLOOR <= 1) {
      /*
        Not a misconfiguration, so not counted as wrong, but not silence either.
        A check that prints "matches the plan" while the chain is a
        deregistration or two from halting has told the operator the less useful
        of two true things. The count is stated rather than the word "one",
        because the guard refuses below the floor and not at it: four bonded
        against a floor of three survives one departure and stops on the second.
        Both live sets have moved inside the window this node still answers
        from: Sepolia 0 to 1 to 6 to 7, Ethereum 0 to 1 to 3 to 4.
      */
      const departures = bonded - FLOOR + 1;
      console.log(
        `  margin ${bonded - FLOOR}: ${departures} deregistration${departures === 1 ? "" : "s"}` +
          ` would halt this chain`,
      );
    }
  } else if (floor !== FLOOR) {
    const tx = await registry.setMinAttestors(chainKey, FLOOR);
    await tx.wait();
    console.log(`  minAttestors ${FLOOR}  ${EXPLORER}/tx/${tx.hash}`);
  } else {
    console.log(`  minAttestors ${FLOOR}  already set  (${bonded} bonded right now)`);
  }

  for (const emitter of chain.emitters) {
    const address = ethers.getAddress(emitter.address);
    const allowed = await registry.allowedEmitter(chainKey, address);
    const adapter = await registry.adapterOf(chainKey, address);
    const wantAdapter = emitter.adapter ? ethers.getAddress(emitter.adapter) : ethers.ZeroAddress;

    if (check) {
      const ok = allowed && adapter === wantAdapter;
      console.log(
        `  ${emitter.name.padEnd(16)} ${address}  allowed ${allowed}  adapter ${adapter}${ok ? "" : "  WRONG"}`,
      );
      if (!ok) wrong++;
      continue;
    }

    if (!allowed) {
      const tx = await registry.setEmitter(chainKey, address, true);
      await tx.wait();
      console.log(`  allowed ${emitter.name.padEnd(16)} ${EXPLORER}/tx/${tx.hash}`);
    }
    if (adapter !== wantAdapter) {
      const tx = await registry.setAdapter(chainKey, address, wantAdapter);
      await tx.wait();
      console.log(`  adapter ${emitter.name.padEnd(16)} ${EXPLORER}/tx/${tx.hash}`);
    }
  }
  console.log("");
}

if (check) {
  console.log(wrong === 0 ? "configuration matches the plan" : `${wrong} settings do not match the plan`);
  process.exit(wrong === 0 ? 0 : 1);
}
