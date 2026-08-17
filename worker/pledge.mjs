import { ethers } from "ethers";
import { HARBOR_ABI, MERIDIAN_ABI, PLEDGED_ABI } from "./abi.mjs";
import { SEPOLIA_RPC, addresses, loadPrivateKey, requireAddress } from "./config.mjs";

/**
 * Emits a real pledge on Sepolia from one of the two lenders.
 *
 * Nothing here knows about Creditcoin. That is the whole claim: the lender is
 * unmodified and unaware, and the registry witnesses it anyway.
 *
 *   node worker/pledge.mjs harbor 1000
 *   node worker/pledge.mjs meridian 750
 */
const [lenderArg, amountArg] = process.argv.slice(2);
const lender = (lenderArg ?? "harbor").toLowerCase();
if (lender !== "harbor" && lender !== "meridian") {
  throw new Error("first argument must be harbor or meridian");
}

const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
const wallet = new ethers.Wallet(loadPrivateKey(), provider);

const deed = requireAddress("deed");
const tokenId = BigInt(addresses.tokenId);
const amount = ethers.parseEther(amountArg ?? "1000");

const target = requireAddress(lender);
const contract = new ethers.Contract(
  target,
  lender === "harbor" ? HARBOR_ABI : MERIDIAN_ABI,
  wallet,
);

console.log(`lender    ${lender} ${target}`);
console.log(`asset     ${deed} #${tokenId}`);
console.log(`borrower  ${wallet.address}`);
console.log(`amount    ${ethers.formatEther(amount)}`);

const tx =
  lender === "harbor"
    ? await contract.openLien(deed, tokenId, amount)
    : await contract.drawAgainst(deed, tokenId, amount);

console.log(`\nsent      ${tx.hash}`);
const receipt = await tx.wait();
console.log(`mined     block ${receipt.blockNumber}, status ${receipt.status}`);

const iface = new ethers.Interface(PLEDGED_ABI);
for (const log of receipt.logs) {
  let parsed;
  try {
    parsed = iface.parseLog(log);
  } catch {
    continue;
  }
  if (parsed?.name !== "Pledged") continue;
  console.log(`\nPledged   token       ${parsed.args.collateralToken}`);
  console.log(`          tokenId     ${parsed.args.tokenId}`);
  console.log(`          borrower    ${parsed.args.borrower}`);
  console.log(`          amount      ${ethers.formatEther(parsed.args.amount)}`);
  console.log(`          instanceId  ${parsed.args.pledgeInstanceId}`);
}

console.log(`\nrelay it: node worker/relay.mjs ${tx.hash}`);
console.log(`sepolia:  https://sepolia.etherscan.io/tx/${tx.hash}`);
