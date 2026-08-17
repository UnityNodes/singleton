# Build brief

BUIDL CTC 2026 Fall, Creditcoin. Submission deadline 2026-09-06.
Track: RWA primary, DeFi secondary.

This is the version to build from. It carries the three API corrections that
came out of testing against live CC3, and it resolves the conflict between the
anti-griefing binding and the collision demo.

---

## 1. Product

Singleton is a neutral registry on Creditcoin that witnesses lien and pledge
events from unmodified competing EVM protocols and refuses to let one asset be
pledged twice. Generalised, it is a UCC-9 first-to-file priority registry for
on-chain collateral.

Demo line: two unrelated lenders, one RWA token, the second pledge reverts live,
with no shared database and no integration.

## 2. Why only Creditcoin

An EVM contract cannot read event logs. `LOG0` to `LOG4` are write-only, receipts
live in a trie execution never touches, and `BLOCKHASH` reaches 256 blocks.

So a neutral cross-protocol witness is either an off-chain indexer, which is a
trusted party and therefore not neutral, or a contract consuming an inclusion
proof of somebody else's log. The second exists only through BlockProver `0x0FD2`
on Creditcoin.

This is a property of the machine, not a positioning claim, and it is the reason
the product cannot be built anywhere else.

## 3. Beachhead: on-chain RWA collateral

Asset is a tokenised RWA, ERC-721 or ERC-1155. The canonical key is free:

```
assetKey = keccak256(chainKey, tokenAddress, tokenId)
```

A token tuple names an asset uniquely across every protocol with no agreement
between them. Off-chain invoices are the larger market and the harder key; they
are roadmap, not this submission. See caveat 8.

The key excludes the emitter deliberately. Including it would give the same asset
two keys in two protocols and there would be no collision to catch. The cost is
caveat 5.

## 4. Event we decode

```solidity
event Pledged(
    address indexed collateralToken,
    uint256 indexed tokenId,
    address indexed borrower,
    uint256 amount,
    bytes32 pledgeInstanceId
);
```

`pledgeInstanceId` exists so later lifecycle proofs bind to the current pledge
rather than any past one. Real protocols get a thin ABI adapter mapping their
native event onto the same tuple. The adapter is a semi-trusted layer and is
named as one in caveat 9.

## 5. Registry flow

`registerPledge(proof)` on Creditcoin. Every name below was checked on chain.

1. `BlockProver(0x0FD2).verify(chainKey, height, txBytes, merkleProof, continuityProof)`,
   the view form. The registry writes its own state and does not need the
   precompile to emit, so `verifyAndEmit` is unnecessary. Revert on false.
2. Finality window. Read the tip from
   `ChainInfo(0x0fD3).get_latest_attestation_height_and_hash(chainKey)` and
   require `height + MIN_CONFIRMATIONS[chainKey] <= tip.height`. Written as an
   addition, because `tip - depth` underflows and reverts opaquely on a chain
   whose tip is below the configured depth.
3. `require(receiptStatus == 1)`. Inclusion is not success.
4. `getLogsByEventSignature(receipt, PLEDGED_SIG)`, exactly one match, and the
   emitter must be allowlisted for that chain.
5. Derive `assetKey`.
6. Nullifier. `txIndex` is not in the proof payload; derive it with
   `BlockProver.calculateTxIndex(merkleProof)`, then burn
   `keccak256(chainKey, height, txIndex)`.
7. First to file. If the asset is free, record it and mint a soulbound
   certificate to the emitter. Otherwise emit `DoublePledge` and revert.
8. `getStatus(assetKey)` for protocols to consult before lending.

Note on step 6: `calculateTxIndex` recovers position from merkle path laterality.
That mechanism is the entire basis of another entry in this hackathon, index41.
Here it is plumbing for a nullifier. Do not present it as novel.

## 6. Lifecycle, four proofs against one key

Each transition is a separate inclusion proof of a separate real log, so
Attestcoin carries every state change rather than gating the first one.

1. PLEDGE, first to file.
2. Second PLEDGE on the same key, collision reject. This is the demo moment.
3. SETTLEMENT proof, state becomes SETTLED.
4. RELEASE proof, state returns to FREE and a legitimate re-pledge passes.

SETTLEMENT and RELEASE are accepted only when `log.instanceId` matches the stored
instance, otherwise an old proof could be replayed after a re-pledge.

## 7. Custody, collision and the dual-log binding

These two ideas cannot both apply to the same pledge, and the brief must say so
rather than let it surface during the demo.

Requiring a `Transfer` of the token to the emitter in the same receipt proves the
owner really deposited the asset, and a griefer cannot forge it. But if the
protocol takes custody, the borrower no longer holds the token and cannot pledge
it anywhere else. There is nothing left to collide.

So:

- double pledging is only possible when at least the second leg is
  non-custodial, which locates the product in non-custodial liens and mixed
  cases
- the dual-log binding is an optional stronger mode for custodial emitters
- the demonstration is non-custodial

Custody prevents this fraud mechanically. Everywhere custody is absent the fraud
is live and unaddressed, and that is the market.

## 8. Demo, two acts

Act 1, collision. Two independent lenders on Sepolia. The borrower pledges token
42 to A, the proof lands, the decode is shown on screen, the key is recorded.
The borrower pledges the same 42 to B, the proof lands, the same key derives, and
`DoublePledge` reverts live.

Act 2, lifecycle. SETTLEMENT proof, then RELEASE proof, then a legitimate
re-pledge passes. Four proofs, one asset.

Worth the extra effort: run it against a real third-party emitter, a public
testnet lending protocol, not only our own mocks, with publicly checkable
transaction hashes. That removes the staged-demo objection entirely.

Close on the honesty slide: caveats out loud, invoices as roadmap.

## 9. Scope, three weeks

W1. `Pledged` schema, registry through decode, `assetKey` derivation, one proof
registering a first pledge from one Sepolia contract. Both gates are already
passed, so this starts immediately.

W2. Full mechanics. Finality window, instanceId binding, nullifier, collision
reject, soulbound certificate, `getStatus`, allowlist and adapter, a genuinely
separate second lender contract, SETTLEMENT and RELEASE lifecycle.

W3. Record the two-act demo including a real third-party emitter, thin UI showing
the key, the state and the revert in the explorer, one-pager with caveats at the
front, scripted pitch.

Out of scope and stated as vision: chains beyond Sepolia, e-invoice identifier
piggyback, LEI and VAT resolution, fuzzy multi-key registry, batch pledges.

## 10. Pitch, four pre-emptions

Say these first, before anybody asks.

**MonetaGo.** It proves the market wants this. It is a permissioned registry of
banks over Swift. We do the same job without a trusted operator: the witness is a
precompile proof, not a company.

**Positive record.** We will say it first. This is a positive record, not proof
of absence, because Attestcoin cannot prove a negative. That is exactly UCC-9
first-to-file, which already governs a trillion dollar lien world. Prevention
comes from priority, not omniscience.

**Allowlist.** Yes, we curate which logs are read. We do not curate whether they
are true. The BlockProver decides that and anybody can re-verify on chain.

**Canonicalisation.** For on-chain RWA the key is free, which is why that is our
demo. For off-chain invoices a canonical hash is genuinely hard and we do not
pretend to have solved it. Roadmap, not claim.

## 11. Stack

Creditcoin for the registry and `@gluwa/usc-sdk`. Ethereum Sepolia for two mock
lending contracts plus a real third-party emitter. A Node.js off-chain worker. A
thin React interface plus the Creditcoin explorer.

## References

- Attestcoin smart contracts, `EvmV1Decoder`, `getLogsByEventSignature`:
  `docs.creditcoin.org/attestcoin-protocol/dapp-builder-infrastructure/attestcoin-smart-contracts`
- SDK and `ProofBuilder`: `.../attestcoin-sdk-usc-sdk`
- Design patterns, put the information in events and do not trigger off
  `Transfer`: `.../dapp-design-patterns-readability`
- Official examples: `github.com/gluwa/usc-testnet-bridge-examples`
- Market precedent: MonetaGo Secure Financing
