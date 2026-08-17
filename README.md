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

Pre-build. Both technical gates have passed against live CC3 testnet.
See [docs/VERIFICATION.md](docs/VERIFICATION.md) for the raw results.

| Gate | Question | Result |
|---|---|---|
| Custom event decode | Does `getLogsByEventSignature` pull a custom multi-field event, not just the toy `Transfer` the official example decodes? | PASS |
| Finality window | Can a contract read the latest attested height on-chain, in the same transaction that accepts a pledge? | PASS |

No unknowns remain between here and a working registry.

---

## How it works

A protocol on Ethereum accepts collateral and emits its own pledge event. Nobody
modifies that protocol and nobody asks its permission.

An off-chain worker builds an inclusion proof of that transaction with
`@gluwa/usc-sdk` and submits it to the registry on Creditcoin. The registry then,
in one transaction:

1. Verifies the proof through `BlockProver.verify` at `0x0FD2`.
2. Rejects anything inside the reorg window, using the attested height read from
   `ChainInfo.get_latest_attestation_height_and_hash` at `0x0FD3`.
3. Requires `receiptStatus == 1`, because inclusion is not success.
4. Decodes the pledge log, and requires its emitter to be allowlisted for that
   chain.
5. Derives `assetKey = keccak256(chainKey, tokenAddress, tokenId)`.
6. Burns a per-transaction nullifier so the same proof cannot be replayed.
7. Records the pledge if the asset is free, and reverts with `DoublePledge` if it
   is not.

The asset key deliberately excludes the emitter. If it did not, the same asset
pledged in two different protocols would produce two different keys and never
collide, which is the entire point.

---

## Repository layout

```
src/            registry and interfaces
  vendor/       EvmV1Decoder, vendored from @gluwa/usc-contracts
gates/          the two probes that cleared the technical unknowns
  src/          probe contracts, run inside a constructor via eth_call
  run/          scripts that execute them against live CC3
test/           Foundry tests
script/         deployment
docs/           brief, verification log, caveats
```

## Honest limits

Read [docs/CAVEATS.md](docs/CAVEATS.md) before reading anything else. The design
has five real limitations and none of them are hidden. The most important one:
this is a positive record and a priority rule, not prevention. Attestcoin proves
that something happened. It cannot prove that something did not.

## Licence

MIT. See [LICENSE](LICENSE).
