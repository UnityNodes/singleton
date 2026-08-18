# Verification log

Everything here was measured against live CC3 testnet on 2026-08-17, not read
from documentation. Where a documented claim and a measurement disagree, the
measurement is recorded and the disagreement is named.

Network: CC3 testnet, chainId 102031, RPC `https://rpc.cc3-testnet.creditcoin.network`.

---

## Gate 1: custom multi-field event decode

**Question.** The official example decodes a `Transfer`. Singleton needs to decode
a custom event with several indexed arguments and several non-indexed words. Does
`EvmV1Decoder.getLogsByEventSignature` handle that?

**Method.** A probe contract runs entirely inside its constructor, so a plain
`eth_call` executes it on a live Creditcoin node against the real BlockProver
precompile. No deployment, no funds. The constructor returns its results in place
of runtime code.

**Input.** A real Ethereum mainnet transaction, block 25,775,287, carrying a real
non-`Transfer` event: topic0 `0x9a853a2b...`, emitter `0x5C328f3B...`, three
topics (two indexed arguments) and 224 bytes of data (seven non-indexed words).

**Result.**

```
BlockProver verified        true
receiptStatus               1        (live RPC: 1)
total logs in receipt       11       (live RPC: 11)
getLogsByEventSignature     1 match by signature
emitter                     matched live RPC exactly
topic[0..2]                 all three matched byte for byte
data                        224 bytes, identical to live RPC
```

**Verdict.** PASS. The kill branch in the brief is not needed.

---

## Gate 2: finality window readable on-chain

**Question.** First-to-file written on a one-block-old proof can be reorged by the
attacker who won the race. The fix is a confirmation depth, which requires the
registry to read the latest attested height *on-chain*, inside the transaction
that accepts the pledge. Is that possible?

**Method.** Same constructor-probe technique, calling ChainInfo at `0x0fD3`.

**Result.**

```
Ethereum, candidate 200 blocks back, MIN_CONFIRMATIONS 64  ->  passes: true
Ethereum, candidate 10 blocks back,  MIN_CONFIRMATIONS 64  ->  passes: false
Sepolia,  candidate 200 blocks back, MIN_CONFIRMATIONS 64  ->  passes: true

latest attested (Ethereum)   25,776,130   exists, isAttestation
latest checkpoint (Ethereum) 25,776,000
```

**Verdict.** PASS. The guard rejects fresh blocks exactly as designed.

---

## Corrected API names

Three names used in earlier drafts of the brief do not exist. These are the real
ones, read from the SDK ABI and exercised on chain.

| Draft name | Reality |
|---|---|
| `verifySingle(proofData)` | `verify(uint64, uint64, bytes, MerkleProof, ContinuityProof) view returns (bool)` on `0x0FD2`. A batch form exists taking arrays. `verifyAndEmit` is the non-view variant. The registry uses the view form, because it does not need the emit. |
| `latestAttested(chainKey)` | `get_latest_attestation_height_and_hash(uint64) view returns (uint64 height, bytes32 hash, bool isAttestation, bool exists)` on ChainInfo `0x0fD3`. Note the snake_case: the SDK method is camelCase, the precompile selector is not. |
| `txIndex` from the proof payload | Not present in the payload. Derive with `calculateTxIndex(MerkleProof) view returns (uint64)` on `0x0FD2`, which recovers the index from merkle path laterality. |

---

## Platform facts worth recording

**Chains attested from CC3 testnet.** Read from ChainInfo, both networks:

```
CC3 TESTNET (102031)   chainKey 3 -> chainId 1          Ethereum
                       chainKey 1 -> chainId 11155111   Sepolia
CC3 MAINNET (102030)   chainKey 1 -> chainId 1          Ethereum
```

The same constant means a different chain per environment. Code written and
tested on testnet with `chainKey = 1` reads Sepolia; promoted to mainnet
unchanged, it reads Ethereum. Pin the chain id and resolve the key at
construction, never the reverse.

**Ethereum history is attested to genesis.** Every height probed came back
attested, down to block 1. Checkpoint gaps are 100 to 1000 blocks.

**Old proofs cost less than fresh ones.** Real gas, measured through
`BlockProver.verify` on live CC3:

| Transaction age | Continuity roots | Gas |
|---|---|---|
| 1 hour | 76 | 92,671 |
| 1 day | 76 | 105,666 |
| 1 month | 76 | 157,107 |
| 1 year | 1 | 81,243 |
| 3 years | 1 | 59,384 |
| 6 years | 1 | 50,410 |

The gas-costs page teaches the opposite, that fresher is cheaper. That holds only
inside the recent window. Past the checkpoint horizon the cost falls back to the
floor, because an old block sits beside a settled checkpoint while a fresh one
needs a long chain back to reach one. All rows verified true by the precompile.

**Inclusion is not success.** The precompile proves a transaction was in a block.
A reverted transaction is in a block too. The registry checks
`receiptStatus == 1` and so must anything built on this.

**The decoder is a deployed library.** `EvmV1Decoder` has public functions, so it
must be linked to `0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f` on CC3 testnet.
Without linking, the bytecode carries a `__$...$__` placeholder and any ethers
call fails with "invalid BytesLike value".

---

## Gate 3: the Sepolia read path, end to end

**Question.** Both earlier gates ran against Ethereum, chain key 3. The demo
emits its pledges on Sepolia, chain key 1. Does the prover service serve that
chain, does the precompile verify what it returns, and does `calculateTxIndex`
agree with the index the prover reports?

**Method.** `worker/probe-source.mjs`. It picks a settled Sepolia transaction
near the attested tip, asks `prover.cc3-testnet` for a proof with chain key 1,
then re-checks everything through `eth_call` on live CC3: `BlockProver.verify`,
`BlockProver.calculateTxIndex`, and `EvmV1Decoder.decodeReceiptFields` called
directly on the deployed library. Nothing is spent on either chain, which is why
this could be run with an unfunded Sepolia wallet.

**Result**, transaction `0xa25b64146a58be2edeaa9ae497013b0a371de6ed5dfccb3078bd367e10b735e0`,
Sepolia block 11,509,882:

```
BlockProver.verify        true
calculateTxIndex          2       (prover reports txIndex 2)
decoded receiptStatus     1       (source RPC: 1)
decoded log count         2       (source RPC: 2)
first log emitter         matched source RPC
first log topic0          matched source RPC
```

**Verdict.** PASS. Chain key 1 is served, and the nullifier derivation is
confirmed against an independent source: the prover's own `txIndex` field, which
the on-chain payload does not carry.

**Attestation lag, measured the same day.** Sepolia attested tip 11,509,840
against a head of 11,509,880: 40 blocks, roughly eight minutes. With
`MIN_CONFIRMATIONS = 64` a fresh pledge becomes registrable about twenty minutes
after it is mined. That is the wait the relay polls out, not a failure mode.

**`ReceiptFields` field order.** `(uint8 receiptStatus, uint64 receiptGasUsed,
LogEntry[] receiptLogs, bytes receiptLogsBloom)`. Logs come before the bloom, and
the gas field is `uint64`, not a `uint256` cumulative. An ABI written from the
obvious guess decodes to `BAD_DATA`.

---

## W1 live run: a Sepolia pledge registered on Creditcoin

Both acts of the demo, on public testnets, on 2026-08-17. Every hash below is
checkable by anybody.

**Sepolia**, deployed from `0x59De8802122068A3fc2950812d4621E8Aa0F8516`:

```
deed      0xee79491615882b5421dACEb765564f4c4a09dd64   RwaDeed, token 42
harbor    0xaaD02e7Bebc37Acb5dc67c42F70d61d8C86dF3e5   HarborCredit
meridian  0xfA72380654232c5538d1F17e2D8d6c261bd263AD   MeridianCredit
```

**Act 1, first to file.** Harbor opened a lien on deed 42, Sepolia transaction
`0x00df961cd3753ccb3f1d06a251128a48103b0f54b177a2e52b8e8050e45bdc0b`, block
11,510,076. The relay waited for `11510076 + 64 <= attestedTip`, which took about
fifteen minutes, then submitted the inclusion proof.

Registered on CC3, transaction
`0xe2091d601f72d74fc61b1369aa9f5603d850f80301c3369c13a4523f27caf3f4`, block
5,327,220, 282,534 gas. Record: `assetKey`
`0x8927ac9951b14386e6acf9c4865f37908223c007edc4d987aec68f7ad9334171`, state
PLEDGED, emitter Harbor, amount 1000, source height 11,510,076.

**Act 2, collision.** Meridian, a contract sharing no code with Harbor, drew
against the same deed 42, Sepolia transaction
`0x8de34d47d39abdb46a05d1834964e1eb2ae4b3b3ce930f46259f8a1aae2e387b`, block
11,510,077. Its log derives the same `assetKey` and the registry refused it:
CC3 transaction
`0x274eb0563cf9d4b355596d24181a339c04c36f401109631f40507dc90ae65b02`, block
5,327,230, status 0, reverting with `AssetNotFree` naming Harbor as incumbent.

After both, `ownerOf(42)` on Sepolia is still the borrower. The two liens exist
because neither lender took custody, which is what makes the collision possible
at all.

**Finding to settle in W2.** `registerPledge` emits `DoublePledge` and then
reverts in the same branch, so the event never survives: a revert discards logs.
The refusal is visible only as a failed transaction and an error selector. Either
drop the unreachable emit, or record the attempt through a path that does not
revert, which would also give lenders a queryable history of attempted double
pledges. That is a product decision, not a patch.

---

## W2 live run: the whole life of one asset

Six proofs against one deed, on the registry at
`0x24089da935030bDB09Fb7a47adF68c51661cbeF0`, on 2026-08-18. Each source
transaction is a real log mined on Sepolia; the sequence is replayable with
`node worker/demo.mjs`.

| Step | Source event | Result on CC3 | Gas |
|---|---|---|---|
| 1. Harbor lends against deed 42 | `Pledged`, block 11,510,076 | recorded, PLEDGED, certificate to Harbor, `0xf5d36a27...` | 443,352 |
| 2. Meridian lends against the same deed | `Pledged`, block 11,510,077 | refused live with `AssetNotFree`, failed transaction `0xd22f090a...` | reverted |
| 3. The refusal is kept | same log, `reportCollision` | recorded against the asset, `0x80772e08...` | 444,528 |
| 4. Harbor is repaid | `Settled`, block 11,513,436 | SETTLED, `0xd37cea53...` | 424,032 |
| 5. Harbor discharges the lien | `Released`, block 11,513,437 | FREE, certificate burned, `0xbd18647e...` | 433,048 |
| 6. Meridian re-files the same lien | the step 2 log again | recorded, PLEDGED by Meridian, `0xf285b075...` | 442,904 |

Three things this run settles that the tests alone cannot.

**The refusal and the record are separate powers.** Step 2 reverts and step 3
records, from the same source log, and step 3 leaves the incumbent untouched.

**Reporting a collision does not spend the proof.** Step 6 registers the very
lien that was refused in step 2 and reported in step 3, because the nullifier is
domained per operation. A lien that lost a race is still a real lien once the
asset is free.

**The certificate follows the lien, not the lender.** It was issued to Harbor in
step 1, burned in step 5, and issued to Meridian in step 6.

Gas sits between 424k and 445k per proof, the bulk of it the precompile
verifying continuity. The spread across operations is under five percent, so the
lifecycle costs what the pledge costs.

---

## Deployment, forge on Creditcoin

`forge script` cannot run against CC3. Its fork backend fetches the current block
to build the simulation environment, Creditcoin's RPC returns blocks with no
`mixHash` field, and the run dies with `header validation error: prevrandao not
set` before broadcasting anything.

`forge create` logs the same fetch failure and proceeds, so deployment goes
through it and configuration through `cast`. That is what `script/deploy-cc3.sh`
does. `script/DeployRegistry.s.sol` is kept for chains whose RPC returns the
field.

**Live on CC3 testnet.** Current registry
`0x24089da935030bDB09Fb7a47adF68c51661cbeF0`, decoder linked to
`0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f`, `minConfirmations[1] = 64`, admin
`0x59De8802122068A3fc2950812d4621E8Aa0F8516`.

Two earlier deployments are left on chain rather than hidden:
`0x6A44dE8E02b2617A569FDc147c45F8a15D0087De` carries the W1 run below, and
`0x63198729827F0eb9ED1A5eBC8FCDe58CBE7Fc2F2` was superseded within the hour by a
refactor. Their transactions remain valid evidence of what the code did at the
time.

---

## Prior work carried in

A hardened base contract was written and deployed before this repository existed,
after 15 Foundry tests showed the official `USCBase` never binds the source
chain: `chainKey` is a caller-supplied argument that nothing validates, and no
derived contract in the official examples checks it either.

For a lien registry that binding is load-bearing. A pledge proven on Sepolia must
never freeze an asset on mainnet.

Deployed and demonstrated at `0xee79491615882b5421dACEb765564f4c4a09dd64`:

- accepted a real six year old Ethereum transaction, transaction
  `0x97d0b791f93e45ce3b7aba0912601f8c84b68848f2f0800a2076fa9da00a1bf8`
- rejected a genuine Sepolia proof with `PayloadChainMismatch`, transaction
  `0xef09d844188e6cf160668f6afb60fdeddabef6bba793e83d64c52de3c137f9f9`
