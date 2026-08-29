/*
  Run it with:

    FOUNDRY_PROFILE=gates forge build
    cd gates && npm ci && node run/gate-custom-event.mjs

  The artifact is resolved from this file rather than from the working
  directory, which is what it used to do and what made it unrunnable anywhere
  but the one directory somebody happened to be standing in.
*/
import { ethers } from "ethers";
import { proofProvider } from "@gluwa/usc-sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifact = path.join(here, "..", "..", "out", "GateProbe.sol", "GateProbe.json");
if (!fs.existsSync(artifact)) {
  console.error(`no build at ${artifact}\nbuild it first: FOUNDRY_PROFILE=gates forge build`);
  process.exit(1);
}
const CREATION = JSON.parse(fs.readFileSync(artifact, "utf8")).bytecode.object;
const cc  = new ethers.JsonRpcProvider("https://rpc.cc3-testnet.creditcoin.network");
const eth = new ethers.JsonRpcProvider("https://ethereum-rpc.publicnode.com");
const pb  = new proofProvider.service.ProofBuilder(3, "https://prover.cc3-testnet.creditcoin.network");
const abi = ethers.AbiCoder.defaultAbiCoder();

const CTOR = ["uint64","uint64","bytes","bytes32","tuple(bytes32 hash,bool isLeft)[]","bytes32","bytes32[]","bytes32"];
const OUT  = ["bool","uint8","uint256","uint256","address","bytes32[]","bytes"];

const TRANSFER = ethers.id("Transfer(address,address,uint256)");
const HEAD = await eth.getBlockNumber();

// find a mainnet tx containing a CUSTOM (non-Transfer) event with >=2 topics AND non-empty data
console.log("hunting a real mainnet tx with a custom multi-field event...\n");
let target = null;
for (let bn = HEAD - 400; bn > HEAD - 460 && !target; bn--) {
  const b = await eth.getBlock(bn);
  for (const h of (b?.transactions ?? []).slice(0, 30)) {
    const r = await eth.getTransactionReceipt(h);
    if (!r) continue;
    const custom = r.logs.find(l =>
      l.topics[0] !== TRANSFER && l.topics.length >= 3 && l.data && l.data.length > 66);
    if (custom) { target = { hash: h, bn, rcpt: r, log: custom }; break; }
  }
}
if (!target) { console.log("none found"); process.exit(1); }

const L = target.log;
console.log(`tx      ${target.hash}`);
console.log(`block   ${target.bn}`);
console.log(`event   topic0 ${L.topics[0]}`);
console.log(`        emitter ${L.address}`);
console.log(`        ${L.topics.length} topics (${L.topics.length-1} indexed args), data ${(L.data.length-2)/2} bytes (${(L.data.length-2)/64} non-indexed words)`);
console.log(`        NOT a Transfer. Exactly the shape Singleton needs.\n`);

const d = (await pb.getProof(target.hash)).data;
console.log(`proof   continuityRoots ${d.continuityProof.roots.length}, merkleSiblings ${d.merkleProof.siblings.length}\n`);

const args = abi.encode(CTOR, [
  3, d.headerNumber, d.txBytes, d.merkleProof.root,
  d.merkleProof.siblings.map(s => [s.hash, s.isLeft]),
  d.continuityProof.lowerEndpointDigest, d.continuityProof.roots,
  L.topics[0],
]);

const raw = await cc.call({ data: CREATION + args.slice(2) });
const [verified, status, totalLogs, matchedLogs, emitter, topics, data] = abi.decode(OUT, raw);

console.log("═══ RESULT ON LIVE CREDITCOIN ═══");
console.log(`  BlockProver verified        ${verified}`);
console.log(`  receiptStatus               ${status}   (RPC: ${target.rcpt.status})`);
console.log(`  total logs in receipt       ${totalLogs}   (RPC: ${target.rcpt.logs.length})`);
console.log(`  getLogsByEventSignature ->  ${matchedLogs} match(es)`);
console.log(`  emitter                     ${emitter}`);
console.log(`                              RPC says ${L.address}  match=${emitter.toLowerCase()===L.address.toLowerCase()}`);
console.log(`  topics returned             ${topics.length}   (RPC: ${L.topics.length})`);
topics.forEach((t,i) => console.log(`     topic[${i}] ${t}\n              RPC ${L.topics[i]}  match=${t===L.topics[i]}`));
console.log(`  data bytes                  ${(data.length-2)/2}   (RPC: ${(L.data.length-2)/2})`);
console.log(`  data identical              ${data.toLowerCase()===L.data.toLowerCase()}`);

const pass = verified && Number(status)===target.rcpt.status && Number(matchedLogs)>0
  && emitter.toLowerCase()===L.address.toLowerCase()
  && topics.length===L.topics.length
  && topics.every((t,i)=>t===L.topics[i])
  && data.toLowerCase()===L.data.toLowerCase();
console.log(`\n  GATE: ${pass ? "PASS ✅" : "FAIL ❌"}`);
