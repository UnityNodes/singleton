import { ethers } from "ethers";
import fs from "fs";
const CREATION = JSON.parse(fs.readFileSync("FinalityProbe.json","utf8")).bytecode.object;
const cc = new ethers.JsonRpcProvider("https://rpc.cc3-testnet.creditcoin.network");
const abi = ethers.AbiCoder.defaultAbiCoder();
const OUT = ["uint64","bool","bool","uint64","bool","bool"];

console.log("Fix #1 gate: can a CONTRACT read the finality window on-chain?\n");
for (const [label, chainKey, back, minConf] of [
  ["Ethereum, candidate 200 blocks back, MIN_CONF=64", 3, 200, 64],
  ["Ethereum, candidate 10 blocks back,  MIN_CONF=64", 3, 10, 64],
  ["Sepolia,  candidate 200 blocks back, MIN_CONF=64", 1, 200, 64],
]) {
  // first read latest so we can build a realistic candidate height
  const probe0 = abi.encode(["uint64","uint64","uint64"], [chainKey, 1, 0]);
  const r0 = await cc.call({ data: CREATION + probe0.slice(2) });
  const latest = Number(abi.decode(OUT, r0)[0]);
  const candidate = latest - back;

  const args = abi.encode(["uint64","uint64","uint64"], [chainKey, candidate, minConf]);
  const raw = await cc.call({ data: CREATION + args.slice(2) });
  const [lh, exists, isAtt, ck, candAtt, passes] = abi.decode(OUT, raw);
  console.log(`${label}`);
  console.log(`   latest attested   ${lh}  exists=${exists} isAttestation=${isAtt}`);
  console.log(`   latest checkpoint ${ck}`);
  console.log(`   candidate ${candidate}  attested=${candAtt}`);
  console.log(`   passes window     ${passes}\n`);
}
