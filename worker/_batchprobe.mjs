import { ethers } from "ethers";
import { proofProvider } from "@gluwa/usc-sdk";

const TXS = [
  "0x591155be5d626689bd0222474d5061ac60c786bd31bdf52de0c1456fd0132a18",
  "0xe0c7e6a4252fbf5bab42f58ca1103df830b4ef81e7846a80e8bfbb3cf6471e85",
];
const builder = new proofProvider.service.ProofBuilder(1, "https://prover.cc3-testnet.creditcoin.network", 180000);
const d = (await builder.getBatchProof(TXS)).data;
const cont = { lowerEndpointDigest: d.continuityProof.lowerEndpointDigest, roots: d.continuityProof.roots };
const items = [];
for (const [header, byIndex] of d.merkleProofs.entries())
  for (const [txIndex, e] of byIndex.entries())
    items.push({ header, txBytes: e.txBytes, mp: { root: e.merkleProof.root, siblings: e.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })) } });

const cc3 = new ethers.JsonRpcProvider("https://rpc.cc3-testnet.creditcoin.network");
const batch = new ethers.Contract("0x0000000000000000000000000000000000000FD2",
  ["function verify(uint64,uint64[],bytes[],(bytes32 root,(bytes32 hash,bool isLeft)[] siblings)[],(bytes32 lowerEndpointDigest,bytes32[] roots)) view returns (bool)"], cc3);

const run = async (label, h, t, m) => {
  try { console.log(label, "->", await batch.verify(1, h, t, m, cont)); }
  catch (e) { console.log(label, "-> revert:", (e.revert && e.revert.args ? e.revert.args[0] : e.shortMessage).slice(0, 60)); }
};

const H = items.map((i) => i.header), T = items.map((i) => i.txBytes), M = items.map((i) => i.mp);
await run("honest pair                    ", H, T, M);

const flip = (hex) => hex.slice(0, -4) + (hex.slice(-4) === "0000" ? "0001" : "0000");
await run("second item txBytes corrupted  ", H, [T[0], flip(T[1])], M);
await run("first item txBytes corrupted   ", H, [flip(T[0]), T[1]], M);
const badRoot = { root: "0x" + "11".repeat(32), siblings: M[1].siblings };
await run("second item merkle root forged ", H, T, [M[0], badRoot]);
await run("second item height lied about  ", [H[0], H[1] + 1], T, M);
