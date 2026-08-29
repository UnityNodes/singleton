# Singleton

**One asset, one lien, proven on-chain and trusted to no one.**

An asset can be financed once. That is the invariant, and the name is the
invariant: across every lending protocol on a chain, a pledged asset has exactly
one live claim on it.

Nothing enforces that today. Two protocols that have never heard of each other
will each lend against the same collateral, because neither can see what the
other recorded.

Singleton is a neutral registry on Creditcoin that witnesses pledge events from
unmodified, competing EVM protocols and refuses the second claim. Generalised, it
is a first-to-file priority registry for on-chain collateral, in the shape of
UCC-9.

Two unrelated lenders. One RWA token. The second pledge reverts, live, with no
shared database and no integration between them.

Built for [BUIDL CTC 2026 Fall](https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail)
on the Attestcoin Protocol. RWA track.

---

## Why this can only exist on Creditcoin

An EVM contract cannot read event logs. Not another contract's, and not its own.
`LOG0` through `LOG4` are write-only, receipts live in a trie that execution
never touches, and `BLOCKHASH` reaches back only 256 blocks.

So a neutral witness of events emitted by unmodified competing protocols is
either an off-chain indexer, which is a trusted party and therefore not neutral,
or a contract that consumes an inclusion proof of somebody else's log. The
second only exists on Creditcoin, through the BlockProver precompile at
`0x0FD2`.

This is not a framing device. It is a property of the virtual machine, and it is
the reason the product has no equivalent anywhere else.

---

## Status

The registry is live on CC3 testnet and has taken one asset through its whole
life against two unrelated lenders on Sepolia: pledged, a second pledge refused
live, the refusal kept on file, settled, released, and re-pledged by the lender
that lost the first race. Six more proofs read two real protocols on Ethereum
mainnet, which have never heard of it, including a lien that ended in a failed
auction rather than a repayment. Fifteen proofs, every hash in
[docs/VERIFICATION.md](docs/VERIFICATION.md), replayable with
`node worker/demo.mjs`.

| | |
|---|---|
| The site, live | **https://singleton.unitynodes.com** &middot; the register at [/register](https://singleton.unitynodes.com/register) |
| The demo, 1:46 | [/demo](https://singleton.unitynodes.com/demo), captioned, no wallet needed to follow it |
| The deck | [singleton-deck.pdf](https://singleton.unitynodes.com/singleton-deck.pdf), eleven slides |
| The one pager | [singleton-one-pager.pdf](https://singleton.unitynodes.com/singleton-one-pager.pdf) |
| Registry, CC3 testnet | `0xcccE8847a63f6fD460FA86CDaE8a05bAe102e0F7`, verified on Blockscout |
| Harbor Credit, Sepolia | `0xaaD02e7Bebc37Acb5dc67c42F70d61d8C86dF3e5` |
| Meridian Credit, Sepolia | `0xfA72380654232c5538d1F17e2D8d6c261bd263AD` |
| Demo assets | `RwaDeed 0xee79491615882b5421dACEb765564f4c4a09dd64`, token 43 claimed with a refusal on file, token 42 through its whole life |
| Read from mainnet | NFTfi v3 `0xB6adEc2ACc851d30d5fB64f3137234BCDCBBad0D` and Blur Blend `0x29469395eAf6f95920E59F858042f0e28D98a20B`, both unmodified |

**A record inherits the security of an attestor set, so the set is part of the
record.** The number stored is the one bonded for that chain when the record was
filed. It is not the set that stood behind the original attestation of the
source block, which is a different number and, on Creditcoin, is not reachable
from inside a transaction at all. Caveat 11 says so with the case that shows it. Creditcoin bonds seven attestors for Sepolia and four for
Ethereum, a hundred CTC each, and those numbers move: read at historical
heights, Sepolia went 0 to 1 to 6 to 7 between 2026-05-01 and 2026-07-09, and
Ethereum went 0 to 1 to 3 to 4, having appeared on the supported chain list a
month before a single attestor was bonded for it. Every bridge and oracle
shipped so far stores a record made under seven the same way as one made under
two. This registry reads the count and the bond inside the transaction that
accepts a proof, keeps both with the lien and with every refusal, emits them in a
log that outlives the record itself, and refuses to file anything at all once the
set has fallen below a stated floor. The floor gates entry and never exit, so no
attestor rotation can strand an asset already on file.

Many pledges can be filed from one continuity proof. Measured on chain, not
estimated: four pledges filed one at a time cost 1,582,616 gas, and the same four
as a single batch cost 989,237, which is 37.5 percent less. All or nothing on
purpose: a batch that cannot file one of its members takes the whole transaction
with it.

The reason for that saving is not what this file said until 2026-08-20, and the
correction is worth more than the original claim. On Creditcoin a contract's code
size is charged on **every call**, not only at deployment: the same trivial call
costs 22,318 gas against an account with no code and 189,996 against this
registry, and three deployments at three sizes put it at roughly 13 gas per byte.
So four separate pledges pay to enter a 12.8 KB contract four times, and a batch
pays once. That accounts for 566,034 of the 593,379 saved. Sharing the continuity
proof is the remaining 27,345. Measured, then written down, in
[docs/VERIFICATION.md](docs/VERIFICATION.md).

93 tests cover it, including both suppression attacks that independent reviews
found on 2026-08-19 and the regressions that keep them closed. The registry and both
adapters are verified on Blockscout, so the refusal in the demo decodes to
`AssetNotFree(bytes32 assetKey, address incumbent)` rather than to a blob of
hex.

Three technical gates were cleared against the live chain before any of it was
built: a custom multi-field event decodes byte for byte, the attested tip is
readable on-chain inside the accepting transaction, and the whole Sepolia read
path verifies through `eth_call` alone.

---

## How it works

A protocol on the source chain accepts collateral and emits its own event.
Nobody modifies that protocol and nobody asks its permission.

An off-chain relay builds an inclusion proof of that transaction with
`@gluwa/usc-sdk` and submits it to the registry on Creditcoin. The relay is
trusted with nothing: it carries bytes, and the registry re-checks every claim in
them inside its own transaction.

1. Verifies the proof through `BlockProver.verify` at `0x0FD2`.
2. Rejects anything inside the reorg window, using the attested height read from
   `ChainInfo.get_latest_attestation_height_and_hash` at `0x0FD3`, and reads how
   many attestors were bonded behind it from `AttestorStash` at `0x0FD4`.
3. Requires `receiptStatus == 1`, because inclusion is not success.
4. Reads the log the proof names, requires it to have been written by the
   emitter the proof names, requires that emitter to be allowlisted for the
   chain, and decodes it either natively or through that emitter's adapter. The
   registry searches the receipt for nothing, because the party who sends the
   source transaction is usually the borrower.
5. Derives `assetKey = keccak256(chainKey, tokenAddress, tokenId)`.
6. Burns a per-operation nullifier so the same proof cannot be replayed.
7. Records the pledge if the asset is free and issues a soulbound certificate to
   the emitter. If it is not free, the transaction reverts with `AssetNotFree`.

The asset key deliberately excludes the emitter. If it did not, the same asset
pledged in two different protocols would produce two different keys and never
collide, which is the entire point.

### One asset, four proofs

Each transition is its own inclusion proof of its own real log, so the source
chain carries the whole life of the lien rather than only its first moment.

| Proof | Entry point | Effect |
|---|---|---|
| Pledge | `registerPledge` | FREE to PLEDGED, certificate issued |
| Refused second pledge | `reportCollision` | recorded against the asset, incumbent untouched |
| Settlement | `registerSettlement` | PLEDGED to SETTLED |
| Release | `registerRelease` | back to FREE, certificate burned, re-pledging allowed |

Settlement and release are bound to the emitter on file and to the instance id of
the lien currently recorded, so a proof of last year's lien cannot move this
year's.

`registerPledge` reverts on a collision, because that is what an integrating
protocol needs and a revert discards its own logs. The evidence is kept by the
separate, non-reverting `reportCollision`, and `collisionCount(assetKey)` tells a
lender how many times somebody already tried.

### Protocols that speak their own schema

Most real lenders will not emit Singleton's event shape, and asking them to is
the integration this product exists to avoid. An adapter, one pure contract per
protocol, maps their native log onto `(token, tokenId, borrower, amount,
instanceId)`. See [src/adapters](src/adapters) and caveat 9: the allowlist
decides which logs are read, an adapter decides what they mean, and those are
different powers.

This is not hypothetical. Two real protocols on Ethereum mainnet are read this
way, and the two could hardly be less alike.

[NFTfi v3](src/adapters/NftfiV3Adapter.sol) keeps the collateral inside a struct
in the log data and has no settlement step, so repayment maps to release and a
settlement proof is refused rather than approximated.
[Blur's Blend](src/adapters/BlendAdapter.sol) indexes nothing at all, and its
`Repay` names no token id, so the adapter returns a zero token and the registry
resolves the lien through the instance id it recorded when the loan was opened,
under that emitter and no other. Blend also ends liens two ways, by repayment and
by seizure after a failed auction, so a transition may name several events and
both are proven.

Nothing was deployed on mainnet and nothing was asked of either protocol.
Creditcoin attests Ethereum, so an existing loan can simply be read.

---

## How this is kept honest

The claims in this repository are checked by machine, and each check exists
because the failure it looks for already happened once.

Every hash, address and hand written selector this repository states is checked
by `node script/audit-claims.mjs`: transactions resolved against three chains,
addresses asked whether they behave like a registry, abbreviations looked up in
what the first two stages resolved, and the four byte selectors in the web app
matched against the compiler's own `methodIdentifiers`, the counts that drift
recomputed from the repository, the tests the prose names looked for in `test/`,
and the claim itself settled with two calls: the registry says claimed, and the
collateral contract says the borrower still holds it. It was written after the
third redeploy produced the same stale reference, and it failed on its first
run. What it found second was worse than a stale link: an unopenable citation
under the words "checked rather than assumed", holding up a claim about Aave
that turned out to be false. Caveat 6 carries the correction.

`./script/before-judging.sh` is the one to run before submitting or presenting.
It is read only and needs no key: the tests, the audit, the configuration on
chain, the six links a judge opens, and the attestor margin behind the source
chains. Nothing it checks lives in this repository, which is the point. The
submission sits untouched for days and the world underneath it moves.

`./script/from-a-clone.sh` answers the other half of that: it clones this
repository into a temporary directory and runs the tests, the deck build, the
audit, the web build and a live configuration read there, with nothing borrowed
from the machine it was cloned on. It reads the source for absolute paths first,
because a clone on the same machine still resolves them and that is how the same
fault survived twice.

---

## Repository layout

```
src/            registry and interfaces
  emitters/     the two Sepolia lenders and the demo RWA deed
  adapters/     NFTfi v3, Blur Blend, and a reference for a locked schema
  vendor/       EvmV1Decoder, vendored from @gluwa/usc-contracts
worker/         off-chain relay: proofs, lifecycle, admin
web/            the site: landing page, register and demo, React and Vite
deck/           the pitch deck and the one pager, built to PDF
gates/          the probes that cleared the technical unknowns
  src/          probe contracts, run inside a constructor via eth_call
  run/          scripts that execute them against live CC3
test/           Foundry tests
script/         deploy, publish, record the demo, and the checks that
                hold this repository to what it says
docs/           brief, verification log, caveats
```

## Honest limits

Read [docs/CAVEATS.md](docs/CAVEATS.md) before reading anything else. The design
has fourteen real limitations and none of them are hidden. The most important one:
this is a positive record and a priority rule, not prevention. Attestcoin proves
that something happened. It cannot prove that something did not.

## Licence

MIT. See [LICENSE](LICENSE).
