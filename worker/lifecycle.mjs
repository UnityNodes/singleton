import { ethers } from "ethers";
import { HARBOR_ABI, MERIDIAN_ABI, SOURCE_EVENTS_ABI } from "./abi.mjs";
import { SEPOLIA_RPC, addresses, loadPrivateKey, requireAddress } from "./config.mjs";

/**
 * Moves a lien forward on the source chain: repayment, then discharge.
 *
 * Each call emits one real log, and each log becomes its own inclusion proof.
 * The registry learns about the whole life of the lien this way, never from us
 * telling it.
 *
 *   node worker/lifecycle.mjs harbor settle
 *   node worker/lifecycle.mjs harbor release
 *   node worker/lifecycle.mjs meridian settle 0
 */
const [lenderArg, actionArg, positionArg] = process.argv.slice(2);
const lender = (lenderArg ?? "harbor").toLowerCase();
const action = (actionArg ?? "settle").toLowerCase();
if (!["harbor", "meridian"].includes(lender)) throw new Error("lender must be harbor or meridian");
if (!["settle", "release"].includes(action)) throw new Error("action must be settle or release");

const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
const wallet = new ethers.Wallet(loadPrivateKey(), provider);

const deed = requireAddress("deed");
const tokenId = BigInt(addresses.tokenId);
const target = requireAddress(lender);
const contract = new ethers.Contract(
  target,
  lender === "harbor" ? HARBOR_ABI : MERIDIAN_ABI,
  wallet,
);

let tx;
if (lender === "harbor") {
  tx = action === "settle"
    ? await contract.repayLien(deed, tokenId)
    : await contract.dischargeLien(deed, tokenId);
} else {
  const positionId = BigInt(positionArg ?? 0);
  tx = action === "settle"
    ? await contract.repay(positionId)
    : await contract.closePosition(positionId);
}

console.log(`${lender} ${action}`);
console.log(`sent   ${tx.hash}`);
const receipt = await tx.wait();
console.log(`mined  block ${receipt.blockNumber}, status ${receipt.status}`);

const iface = new ethers.Interface(SOURCE_EVENTS_ABI);
for (const log of receipt.logs) {
  let parsed;
  try {
    parsed = iface.parseLog(log);
  } catch {
    continue;
  }
  console.log(`\n${parsed.name}  token ${parsed.args.collateralToken} #${parsed.args.tokenId}`);
  console.log(`          amount ${parsed.args.amount}`);
  console.log(`          instanceId ${parsed.args.pledgeInstanceId}`);
}

console.log(`\nrelay it: node worker/relay.mjs ${tx.hash} ${action}`);
console.log(`sepolia:  https://sepolia.etherscan.io/tx/${tx.hash}`);
