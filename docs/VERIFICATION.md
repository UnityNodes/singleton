# Verification log

Everything here was measured against live CC3 testnet on 2026-08-17 and
2026-08-18, not read from documentation. Where a documented claim and a measurement disagree, the
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

**Input.** A real Ethereum mainnet transaction carrying a real non-`Transfer`
event. The probe hunts for one rather than pinning a hash, so the run below is
from 2026-08-29 and a rerun today will name a different transaction. Its
`GATE: PASS` line is the assertion; the identifiers are what that run happened to
land on.

Transaction `0x5b9d22c64b2b918d9674cb0272409065985902ffdbad2f20d24b911701cc8bad`,
block 25,862,369: a Uniswap v3 `Swap`, topic0
`0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67`, emitter
`0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640`, three topics (two indexed
arguments) and 160 bytes of data (five non-indexed words).

**Result.**

```
BlockProver verified        true
receiptStatus               1        (live RPC: 1)
total logs in receipt       3        (live RPC: 3)
getLogsByEventSignature     1 match by signature
emitter                     matched live RPC exactly
topic[0..2]                 all three matched byte for byte
data                        160 bytes, identical to live RPC
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
after it is mined. Re-measured on 2026-08-29 the lag was 34 blocks on Sepolia and
35 on Ethereum, so the twenty minutes holds.

That used to end "which is the wait the relay polls out, not a failure mode",
which was too comfortable. It is a wait for the relay and a window for the
register, and caveat 14 now carries what happens inside it: the tip advances in
jumps of ten source blocks, so two pledges in the same ten block band become
registrable at the same instant and priority falls to whoever reaches Creditcoin
first.

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

**Finding, settled in W2.** `registerPledge` emitted `DoublePledge` and then
reverted in the same branch, so the event never survived: a revert discards its
own logs. The refusal was visible only as a failed transaction and an error
selector.

Resolved by splitting the two powers. `registerPledge` still reverts, because an
integrating protocol needs the transaction to fail. The evidence is kept by
`reportCollision`, which proves the same losing pledge, records it against the
asset, and leaves the incumbent alone. Different consumers, two entry points,
rather than one compromise.

---

## W2 live run: fifteen proofs on one registry

Registry `0x25b0963E40536dF9519Da839cd7c36bc1A47bd8D`, CC3 testnet, 2026-08-19.
Nine proofs against our own lenders on Sepolia across two assets, six against two
real protocols on Ethereum mainnet. Replayable with `node worker/demo.mjs` against a freshly
deployed registry, because a proof is spendable once per operation.

### Sepolia, the collision and the lifecycle

| Step | Source event | Result on CC3 | Gas |
|---|---|---|---|
| 1. Harbor lends against deed 42 | `Pledged`, block 11,510,076 | PLEDGED, certificate to Harbor, `0x2e43d060033bd4ae6919a4c14a7a15d7a05fe1c229530941fb7d2d597a45c56b` | 405,286 |
| 2. Meridian lends against the same deed | `Pledged`, block 11,510,077 | refused live with `AssetNotFree`, failed transaction `0x68505d902d3e807a344cbed340d6deaa14e1f4bf2ece9270997000a98bb0de76` | reverted |
| 3. The refusal is kept | same log, `reportCollision` | recorded against the asset, `0x57bcddfa786e0adc19bfcb15d198932e557e917e5d1c9c58159916435f80aba8` | 406,462 |
| 4. Harbor is repaid | `Settled`, block 11,513,436 | SETTLED, `0x982f67a7920d68e6b2ccfd1b94cc763899f514b190afc9a25b20753ced6a9f4a` | 409,598 |
| 5. Harbor discharges the lien | `Released`, block 11,513,437 | FREE, certificate burned, `0xf483990830adfbcaa310d1168a15dc6733776a4208be7a2e9068e0b61b05b67e` | 432,670 |
| 6. Meridian re-files the same lien | the step 2 log again | PLEDGED by Meridian, `0xf079c988446d0f1a230b44c53a6887484ec1c9bdb41fab371e01a11c648819ba` | 404,838 |

Deed 42 ends held by Meridian with no refusals on file, which is the point of
the fix rather than a gap: the refusal belonged to Harbor's lien and went with
it. A second asset carries the standing case.

| Step | Source event | Result on CC3 | Gas |
|---|---|---|---|
| 7. Harbor lends 1,200 against deed 43 | `Pledged`, block 11,528,165 | PLEDGED, `0x14a445f857bbb368923d7777b41f503aeeefe3480bbc402cf9143407ed55e6a1` | 409,318 |
| 8. Meridian lends against deed 43 | `Pledged`, block 11,528,166 | refused live, failed transaction `0xe6b94874151481ab7f52c0d73662028104358de9434a5c21eee4115803cb3eda` | reverted |
| 9. The refusal is kept | same log, `reportCollision` | on file and staying there, `0x5a1dacbabe03c8aa98e20e367c8e2516853909c62b4604ed8238e1154e70ec94` | 411,390 |

This lien is never released, so the refusal against it never expires. That is
the state the register opens on, and the one a judge can click into.

Three things this settles that the tests alone cannot.

**The refusal and the record are separate powers.** Step 2 reverts and step 3
records, from the same source log, and step 3 leaves the incumbent untouched.

**Reporting a collision does not spend the proof.** Step 6 registers the very
lien that was refused in step 2 and reported in step 3, because the nullifier is
domained per operation. A lien that lost a race is still a real lien once the
asset is free.

**The certificate follows the lien, not the lender.** Issued to Harbor in step 1,
burned in step 5, issued to Meridian in step 6.

### Ethereum mainnet, two protocols that never heard of us

| Step | Source event | Result on CC3 | Gas |
|---|---|---|---|
| 10. NFTfi loan 16928 taken | `LoanStarted`, block 25,506,517 | PLEDGED, `0xd6f376dd4e71206cbf50c3abcf966f54204d0497f5dd3707ba784c0f172f4e95` | 602,518 |
| 11. The same loan repaid | `LoanRepaid`, block 25,717,460 | FREE, `0x6c7f48ec6b14e922b66ad280f890040df103ace8220abfdd8de8d199de039f8f` | 466,774 |
| 12. Blend lien 435829 taken | `LoanOfferTaken`, block 25,711,377 | PLEDGED, `0x1101d9aa983c1bfce1429d0e19714c14b76a726a59c2d2461208dd07dd15809b` | 454,216 |
| 13. The same lien repaid | `Repay`, block 25,721,378 | FREE, `0x9dec679284568aa04b8114678bd6b2dc8e517d11a3c547392747e7a1b229550d` | 442,120 |
| 14. Blend lien 438956 taken | `LoanOfferTaken`, block 25,550,390 | PLEDGED, `0x0d6d8c0a3dcdf9af8ff72c4db605095d7189afe50898b6826aafee68fa338e67` | 443,464 |
| 15. That lien seized after a failed auction | `Seize`, block 25,651,509 | FREE, `0x2201a81dba74b3593140eb07f5524e662de411ce745d8863a4438953ce5c91b0` | 468,552 |

Steps 14 and 15 exist because a lien ends in more than one way. Blend closes one
with `Repay` when the borrower pays and with `Seize` when the auction fails and
the lender takes the token. An adapter that knew only about repayment would leave
seized liens on file forever, and a stale claim looks exactly like a live one.

### The batch, measured rather than argued

Eight fresh liens were opened on Sepolia for this, four filed one at a time and
four filed together, against the same registry with the same adapters.

| | Gas |
|---|---|
| Four pledges, one transaction each | 397,222 + 395,878 + 394,982 + 394,534 = **1,582,616** |
| The same four as one batch, `0x94f2484ead075b54521aed92a88c6f4d802518fa700ef53ea5dc6e6185bdc321` | **989,237** |
| Saved | **593,379, or 37.5 percent** |

Per pledge that is 395,654 alone against 247,309 batched.

The total is right and the explanation given for it here was wrong, which was
found on 2026-08-20 while measuring something else. It said the batch amortises
the continuity proof. It mostly amortises something bigger, and the next section
is how that turned up.

**Corrected split.** On the registry that carried this test, 12,772 bytes of
code, a bare call costs 189,996 gas before a single opcode of the pledge runs.
Four separate transactions pay that four times; the batch pays it once. Three
fewer entries into the contract, at 21,000 intrinsic plus 167,678 of code
charge each, is 566,034 of the 593,379 saved, or 95 percent. The continuity
proof accounts for the remaining 27,345.

So the saving is real, large, and mostly a per transaction cost rather than a
per proof one. Two consequences follow, and they point in opposite directions
from the original claim. It does **not** grow much with the distance a relayer
is catching up over, because the dominant term does not depend on that distance.
It does grow with the number of pledges in the batch, linearly, which the
original claim understated.

Mainnet proofs cost more than Sepolia ones, 442k to 603k against roughly 408k,
because those payloads are larger and carry more continuity roots. The spread
across operations on one chain stays under five percent, so the lifecycle costs
what the pledge costs.

### Contract size is charged on every call, not only at deployment

This was not looked for. The attestor quorum was measured against a control
deployment of the previous code, and a settlement, which the change does not
touch at all, came back 27,650 gas more expensive. The calldata was byte
identical, checked rather than assumed. Chasing that number is what found this.

`eth_estimateGas` for the same trivial view call, `admin()`, against an account
with no code and against three deployments of this registry that differ only in
how much code they carry:

| Target | Code size | Gas |
|---|---|---|
| An account with no code | 0 | 22,318 |
| Registry before the quorum, `0x4e75fa6b0e83885a789938ad5b3512b08ad62b33` | 12,772 | 189,996 |
| Registry with the quorum, second shape, `0x65f561a73451e878327cf3775dc21ca9cbef72e8` | 14,287 | 210,827 |
| Registry with the quorum, first shape, `0xF7C08bAE1dAb1A3f96144114345ABbFd4079e3B4` | 14,747 | 217,442 |

Subtract the no-code baseline and divide by size: 13.13, 13.19 and 13.23 gas per
byte. The three agree to within one percent, and `minConfirmations(uint64)`
gives the same three numbers plus a constant 416, so the slope is a property of
the code and not of the function called.

**A fourth point, from the 2026-08-30 redeploy that added the adapter freeze and
the batch duplicate check.** `0xcD9017e3C541cAF973987E23e02694111C25032C`, 14,859
bytes, `admin()` costs 218,907 gas: 13.23 gas per byte against the same no-code
baseline, on the fourth deployment in a row. The two features added that day
cost about 570 bytes and roughly 7,500 gas on every call to this contract, not
only the calls that touch either fix, for the same reason threading the quorum
read out of `_readSourceEvent` mattered in the first place: Creditcoin does not
charge a function for what it does, it charges every call for how large the
contract is.

Stated narrowly on purpose. Two much smaller contracts on the same chain, the
NFTfi and Blend adapters at 1,156 and 1,445 bytes, do **not** sit on that line,
so this is a measured relationship across three sizes of one contract rather
than a chain wide constant this project can prove. The mechanism is not claimed
either. A Substrate chain has to carry the code it executes in the block's proof
of validity, and that is the obvious candidate, but no document consulted here
says so.

What it means in practice is not small. A 12.8 KB contract on CC3 spends about
190,000 gas answering anything, and every byte added to it is roughly 13 gas on
every call to it for as long as it is deployed. Three things followed
immediately.

The 27,650 that started this was not the quorum doing work. It was 1,975 bytes
of extra code being charged on every call including the two that never look at
an attestor set. Threading the attestor read out of the shared proof reader as a
second return value was what inflated the code; moving it into the two entry
points that actually need it gave back 460 bytes, and 6,440 gas on every single
operation the registry performs. That shape is in the source with the number
next to it, so nobody removes it later thinking it is a stylistic choice.

`optimizer_runs` was retested against this, since the setting trades size for
runtime gas and on this chain size **is** runtime gas. It does not help here:
1 run gives 14,201 bytes against 14,287 at 200, which is 86 bytes, and the
slower code paths would cost more than the 1,100 gas that saves. Left at 200.

And the batch measurement above needed its explanation corrected, which is the
paragraph that now sits under it.

**Where the bytes are, now that they are a running cost.** Each area was removed
in turn and the contract rebuilt, against a live size of 14,287:

| Removed | Size | Delta |
|---|---|---|
| The batch entry point and its nullifier helper | 14,583 | **+296** |
| The soulbound ERC-721 surface | 13,896 | -391 |
| `getStatus`, `collisionAt`, `assetOfInstance`, `assetKeyOf` | 13,197 | -1,090 |
| `reportCollision` | 13,143 | -1,144 |

The first row is not a typo. Taking the batch entry point out makes the contract
**larger**, because with one caller left the optimiser inlines the shared pledge
path into `registerPledge` and duplicates it. The batch form pays for its own
code and then some, which is a better argument for it than the gas figure was.

Nothing else here is fat. The views are the product, a register nobody can read
is not one; the refusal path is the point of the project; and the soulbound
stubs revert by name rather than falling through to a nameless revert, which is
worth 391 bytes. `via_ir` was retested too and turning it off costs 397 bytes.
So this section ends with no change made, which is the honest outcome of looking.

**One robustness fix came out of this run.** The SDK's proof builder defaults to
a ten second timeout. A twelve kilobyte mainnet payload with eighty-four
continuity roots takes the prover longer than that, and the timeout surfaces as
`Failed to fetch proof`, which reads like a refusal and is not one. The relay now
waits two minutes and retries.

---

## W3 live run: the quorum on the record, and the floor refusing

Registry `0xcccE8847a63f6fD460FA86CDaE8a05bAe102e0F7`, CC3 testnet, 2026-08-20,
verified on Blockscout. The same fifteen proofs as the run above, replayed with
`node worker/demo.mjs` against a registry that now reads the attestor set inside
the transaction that accepts each of them.

What a lender sees afterwards, from `node worker/status.mjs`:

```
lien held by 0xfA72380654232c5538d1F17e2D8d6c261bd263AD
  proven at   source height 11510077
  attested by 7 bonded attestors, 100.0 CTC each, against an attested tip of 11530870
```

Those three numbers were true when the proof was accepted, not when the question
was asked. They are in storage on the record and in the `AttestationWitnessed`
log, which is the copy that survives the record being deleted on release.

**The floor, shown refusing rather than described.** Creditcoin bonds seven
attestors for Sepolia. The floor was raised to eight on purpose, a proof that is
otherwise fine was submitted, and the chain refused it:

| | |
|---|---|
| Floor raised to 8 | `0x45b7239c76d5631f3bccd7e52d4dce1e2b02ee6967803041e70029cf1c54e066` |
| The refusal, status 0 | `0xe19625fe701992994240bc6db4695669172558da26fddde694e27b25642be6ef`, `QuorumTooThin(1, 7, 8)` |
| Floor restored to 3 | `0xa5a3b1958f38c2871472efa80281f4992f27d0fbacd5952a2d21bf2abf9d6547` |

The same proof, resubmitted with the floor back at three, is refused for a
different reason: `StaleCollision(11510076, 11510077)`. Same registry, same
bytes, only the floor moved, so the guard is what decided and not something
incidental to that proof.

`node worker/provision.mjs --check` reads the registry back against the plan and
reports the floor next to the set that has to satisfy it, because a check that
only says the guard is configured does not say it is being met:

```
chain id 11155111 -> chain key 1
  minConfirmations 64
  minAttestors 3  (7 bonded right now)
```

## The attestor set, read at every block the node still keeps

The quorum feature rests on one premise: that the set behind a chain changes.
That premise was asserted before it was checked. It is checkable, because the
precompile answers at historical heights, so this is the whole readable history
rather than an argument for it.

The public node prunes state below CC3 block **4,704,777**, dated
2026-05-01. Below that, calls return empty; the decoder library at
`0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f` reads back its 9,598 bytes at 4,728,443, which is how the
horizon was told apart from a precompile that was not there yet.

| Chain key | Block | Date | `getAttestorsCount` |
|---|---|---|---|
| 1, Sepolia | 4,704,777 | 2026-05-01 | 0 |
| 1 | 4,722,160 | 2026-05-04 | 1 |
| 1 | 4,728,443 | | 6 |
| 1 | **5,101,929** | 2026-07-09 | **7**, and still 7 |
| 3, Ethereum | 4,704,777 | 2026-05-01 | 0, and not a supported chain |
| 3 | 4,858,940 | 2026-05-28 | 0, now a supported chain |
| 3 | 4,858,941 | 2026-05-28 | 1 |
| 3 | 4,900,000 | | 3 |
| 3 | **5,143,082** | 2026-07-16 | **4**, and still 4 |

Both sets moved twice inside the window. The premise holds, and it is now a
measurement rather than a claim.

**The row that matters most is Ethereum at 4,858,940.** On that block
`get_supported_chains` reported two chains and `getAttestorsCount(3)` reported
zero. Being on the supported list is not the same as being backed by anybody,
and every other part of this project uses that list to decide what is readable.
A registry that trusted it alone would have accepted Ethereum proofs during a
window when one bonded attestor, and for a moment none, stood behind them. The
floor of three would have refused those proofs until roughly block 4,900,000.

**And the exposure runs the other way too, today.** Ethereum carries four
attestors against a floor of three. The guard refuses below the floor and not at
it, so one departure leaves three and still records; the second halts Ethereum
reads on this registry, which would stop the mainnet half of the demo. That is the guard
working, not a fault, and the floor was not lowered to two to make the number
comfortable: three is the smallest set in which no single attestor is a
majority, and picking the threshold to fit the outcome is the thing this file
exists to prevent. `provision.mjs --check` prints the margin so nobody has to
notice it the hard way.

## What a hostile panel found that we had not

Five judge personas were run against the current submission on 2026-08-29, each
reading the code and calling the live chain, and every question they raised was
then checked by a separate agent told to refute the answer rather than confirm
it. Thirty-nine questions, and the count of answers that "did not hold" was 31,
which is not the number it looks like: the verifiers were instructed to default
to failure when they could not confirm something themselves, so that figure mixes
"this is false" with "I could not check it". Triaging it by hand was the work.

One finding was worth the whole exercise, and it is reproduced here rather than
taken on trust.

**Which number is `Security.attestors`.** The register stores the attestor set
bonded when the record is filed. Every document described it as the set that
attested the source block. Those are different, and on the mainnet proof this
submission leads with they differ:

| | |
|---|---|
| NFTfi loan 16928, source | Ethereum block 25,506,517 |
| First CC3 block whose attested tip covers it | 5,110,417, where `getAttestorsCount(3)` is **3** |
| Earliest block satisfying the 64 confirmation rule | about 5,110,478, still **3** |
| What the record stored | **4**, in the log of `0x0b54c68f65649096bb124eed889f728f68ae6affcb70e101de9d7807253145a1` |
| The tip it recorded | 25,798,240, which is 291,723 Ethereum blocks above the source |

Five plausible height-taking selectors on `AttestorStash` were tried and all five
rejected, so the attesting-time count is not reachable from inside a transaction.
The contract could not store it. What was wrong was the label, in four places,
and caveat 11 now carries the case.

Two things were checked before touching anything. The floor half of the reading
is sound and stays: admission control should be gated on today's set, which is
what the live `QuorumTooThin` refusal shows. And editing the comment in
`src/SingletonRegistry.sol` was tested rather than assumed: changing one word in
it moves the metadata hash in the bytecode, so the deployed registry would stop
matching the source. The struct's own defining sentence already says "at the
moment it was made", which is the correct half, so it is left alone and the
reason is written down.

The rest of the triage produced three more corrections and one live defect,
listed here because each one was a statement this repository made and could not
support.

**The register showed a judge an empty history, and had for three days.** The
page swept logs eight windows of 4,000 blocks back from the head, a fixed 32,000
block lookback. That was the whole life of the register when it was written. By
2026-08-26 the demo's records had fallen out of the bottom of it, and from then
until 2026-08-29 every asset on the page rendered a trail of nothing while the
state above it read correctly. Nothing caught it: `before-judging.sh` checked
that `/register` served markup, and `audit-claims.mjs` reads the chain and never
the page. The floor is now the block the register was created in, 5,344,289,
which the audit holds to the chain by asserting the address has code there and
none in the block before. Windows went from 4,000 to 16,000 because the node
scans linearly and serves these queries one at a time, so width pays and
concurrency does not: 13 slices of 4,000 across 4 lanes took 20 seconds, 4 slices
of 16,000 took 6, and 8 lanes lost 3 slices to timeouts while going slower than
4. A slice that fails is now retried once split in half, and a slice that still
fails is counted on the page instead of being swallowed. `script/history-still-visible.mjs`
reads the bundle the site is serving, pulls the floor and the width out of it,
and repeats the sweep against the chain; it fails on zero entries and it is in
`before-judging.sh`.

**`eth_getCode` was the wrong probe for a precompile.** `docs/SURFACES.md` said
the six Creditcoin precompiles all carry code, eight lines under a promise that
everything on the page was confirmed by calling the chain. `eth_getCode` returns
`0x` for all of them, including the three this project calls in production, and
for `0x0FD5` and `0x13BB` too. These are Substrate precompiles with no EVM
bytecode. The conclusion was right and the evidence was not: the six answer an
unknown selector with `revert Unknown selector`, and the two empty addresses
return empty for any input at all. The page now says that.

**An administrator can strand an asset already on file.** `docs/CAVEATS.md` said
"no administrator and no attestor rotation can strand an asset already on file".
The attestor half is true, because the floor is read only on entry. The
confirmation depth is not: `setMinConfirmations` has no upper bound and
`_requireFinal` sits inside `_readSourceEvent`, which settlement and release both
go through. Raising the depth refuses the exits as readily as the entrances, and
only the same key can lower it again. `test_theAdminStrandsAnAssetByRaisingTheConfirmationDepth`
now pins it, and the caveat says so.

**The content policy names two hosts, not one.** `web/README.md` said the policy
allowed "exactly one connection target". The served header allows the testnet RPC
and the mainnet RPC, so that `?rpc=` has somewhere legitimate to point. Nothing
else is reachable, which was the part that mattered, but the count was wrong.

Three more came out of the same triage, and all three are the same shape: a
thing this repository offered a judge that a judge could not actually do.

**The gate probes had never run from a clone.** `gates/` is presented in the
README as the probes that cleared the technical unknowns, with `run/` described
as scripts that execute them against live CC3. `GateProbe.sol` imported
`./VerifierInterface.sol`, a file that was never committed to this repository at
all, so it had not compiled since the first commit. Both runners read their
Foundry artifact as a bare filename out of the current working directory. Neither
had a `package.json`, so `ethers` could not resolve. Nothing here ever ran them,
which is why none of it showed. The probe now imports the interfaces the registry
itself uses, the artifacts resolve from the script's own location, `gates/` has
its dependencies, and `from-a-clone.sh` builds both probes and runs both against
the live chain. The custom event gate still passes: an NFTfi log decoded through
`EvmV1Decoder` on CC3 matches what the Ethereum RPC returns, all four topics and
all 480 data bytes.

**The demo recording was not reproducible in the way it was described.**
`docs/DEMO.md` said the script writes a webm and "the encode line in that file"
produces the mp4. There was no encode line, no `ffmpeg` anywhere in the
repository and none in its history: the shipped mp4 had been made by hand. The
encode is now the last thing `script/record-demo.mjs` does, and it exits non-zero
rather than leaving a webm behind.

**The history shot filmed a race it could now lose.** Once the log sweep covered
the register's whole life it took about ten seconds, and step 7 of the recorder
waited on the state chip and then held a timer, so the shot would have caught the
word "reading" rather than the trail. It now waits on the swept line, which only
renders when the sweep has returned. The video was re-recorded against the
current site: 1:46, nine chapters, each mark checked against its frame.

## Before judging

`./script/before-judging.sh` runs what can go stale while nobody is looking: the
tests, the audit, the configuration on chain, the six links a judge opens, and
the attestor margin behind both source chains. Read only, no key.

It exists because none of the things it checks live in this repository. A public
RPC that starts pruning, an attestor that deregisters, a web server that restarts
into a bad state, a certificate that lapses: every one of those decides whether a
judge sees the product or a spinner, and not one of them shows up in a diff.

Its first version checked status codes and was worthless. The site is a single
page app, so a path nobody defined answers 200 with `index.html`, and pointing
the whole script at a nonsense prefix passed every line. It reads content now:
the routes for markup only the app serves, the two PDFs for `%PDF`, the video for
its `ftyp` box. The same nonsense prefix reports three failures, which is the
test that the check is a check.

## Six days later, the check said something we had written down wrongly

Run on 2026-08-29 after a week of not touching it. Everything held: the attestor
sets are still 7 and 4, the configuration still matches the plan, all six URLs
answer, 89 tests pass, the audit is clean, and the two demo deeds are still on
record as claimed with the borrower still holding them.

The check itself was the thing that was wrong. `provision.mjs --check` printed
"one deregistration from halting this chain" for Ethereum, and four other places
repeated it. The guard is `attestors < floor`: it refuses **below** the floor and
not at it. Four bonded against a floor of three survives the first departure with
three still standing, and stops on the second.

The error ran against us rather than for us, overstating our own exposure, which
is the rarer direction and no better. The number is computed now,
`bonded - floor + 1`, and `test_aSetExactlyAtTheFloorStillRecords` pins the
boundary: a set exactly at the floor records and carries the thin number with it,
one below is refused. Change the comparison to `<=` and the test fails naming
`QuorumTooThin(1, 3, 3)`.

## Reading the submission the way it is received

Done twice on 2026-08-21, and the second pass was the one that mattered: the
first read the site, the second read the deck, the one pager and the video
frame by frame against the product they describe. Six things were wrong. No
audit stage could have found any of them, because every stage read a file it had
been pointed at, and none had ever been pointed at these.

**The site promised ninety seconds** for a video that had grown past it.

**The one pager and the closing slide of the deck carried the same three stale
numbers**, 12 inclusion proofs, 61 tests and a running time of 1:25, against 15,
88 and the real length. The 61 predates the batch work entirely. Both survived
because they state numbers as markup, `<span class="big">61</span><p>tests`, so
a pattern expecting the number beside the noun sees nothing, and because no check
had opened either file.

**Both claimed the adapter is eighty lines.** It is 106, 57 and 130 in the three
that exist, so the figure understated the largest by fifty and did so in the
project's own favour. `docs/CAVEATS.md` had the honest range the whole time.

**And the video's own arithmetic disagreed with its own screen.** The lifecycle
caption said "Four proofs" while the register behind it read "5 entries", each
one a separate inclusion proof. A judge who counts the rows finds it in the one
place where the lifecycle claim lands. The caption now says five, which is both
correct and the stronger number.

All six are corrected. The counts stage strips tags before matching and now reads
the one pager, the deck source and both site routes; the site says its running
time in words, so "ninety seconds" and "under two minutes" are parsed too. Put
the shipped numbers back and every one is reported.

The lesson is narrower than "check everything". Every stage was written after a
specific failure and pointed at the files that had failed. A file that had never
failed was never added, and stayed unread while it went stale. The artefacts a
judge actually receives had the worst drift in the repository, and looking at
them is the only thing that finds that.

## What a clone can do

Two faults of the same shape had already been found by accident: `deck/build.py`
imported its fonts from a module in `/tmp`, and `script/record-demo.mjs`
imported a browser from a different project's `node_modules`. Both ran perfectly
here and nowhere else, and nothing in the repository could tell, because
everything that ran ran in a directory that already had what was missing.

`./script/from-a-clone.sh` clones the repository into a temporary directory and
runs the whole thing there. On 2026-08-21, from a clean clone with the submodule
fetched: 87 tests pass, the deck builds, the audit passes all of its stages, the
web app installs and builds from its lockfile, and `provision.mjs --check` reads
the live chain and reports the configuration matching the plan. Nothing borrowed.

**And the check had a hole, found by trying to fool it.** An absolute path was
put back into `deck/build.py` on purpose, and every step still passed: a clone on
the same machine as the original resolves a path into the original perfectly
well. Cloning cannot see this class at all, which is exactly why the class
survived twice.

So the script reads the source before it clones. No tracked file may name a
directory under `/root`, `/home`, `/Users` or `/tmp`, and the same mutation is
now caught before the clone starts. One honest consequence: the recorder's output
directory used to default to `/tmp/rec/out`, which was harmless and would have
forced an exception into the rule. It derives the directory from `os.tmpdir()`
now, so the rule needs no exceptions and nobody has to remember which ones were
fine.

## Using the product rather than reading it

Every stage of the audit reads. On 2026-08-21 the register was **used** instead,
with assets it had never seen: an unrelated Ethereum NFT, a Sepolia token id
nobody minted, and an address that is not a contract. All three answer, none
errors, and the third is the interesting one. It reports `free to lend against`,
because nothing is on file against that key and nothing is what there is to
report. The register cannot tell an unencumbered asset from one that does not
exist, which is now caveat 1 and is now said on the page where it answers.

Closing it would cost the property the page is built on. Whether a token exists
is one call to its own contract on its own chain, and every number on `/register`
is an `eth_call` against a single Creditcoin node, which is what makes it
repeatable by anybody with no infrastructure.

The same pass nearly produced a false finding, which is worth more than the
finding. On a 390px viewport the lookup form measures 0 by 0, present in the
document and impossible to touch, which reads exactly like a broken layout. It is
a two pane switcher: the form is behind the `register` tab and the record is
shown first. Tapping the tab and running the whole lookup on a phone works, with
no overflow and no errors. The checks that had been run until then measured
horizontal overflow and console errors, and neither says anything about whether
the primary control can be reached.

Looking for absolute paths afterwards, on the theory that a fault found once has
siblings, turned up one more: `script/record-demo.mjs` imported playwright from
`/root/cips/node_modules`, a different project on one machine. The recorder could
not run on a clone. It resolves the module now, and says how to point at one if
it is missing.

## Auditing our own claims, mechanically

Three redeploys in one day produced the same class of error three times: a
reference that was true last week, still resolves, still decodes, and still
looks right in a browser, because it belongs to a registry the project no longer
runs. Reading the page cannot catch that. Only something that knows which
registry is current can.

`node script/audit-claims.mjs` runs four stages, each written after the previous
one let something through. This file is exempt from all of them, because naming
superseded deployments is its job.

**One, full length hashes.** Every 32 byte value the repository states, resolved
against Creditcoin, Sepolia and Ethereum. A Creditcoin transaction cited outside
this file has to belong to the live registry.

**Two, addresses that behave like a registry.** Not matched against a list of
past deployments, which would need maintaining, but asked: any cited address
that answers `admin()` and `minAttestors(uint64)` is a SingletonRegistry, and
only one of those is live.

**Three, the abbreviations.** Stages one and two match full length values, and
the reference that survived longest was neither. It was an address shortened to
eight characters on a slide, which no search for forty two characters finds. The
values already resolved become a dictionary and every shortened reference is
looked up in it. What resolves to nothing is listed rather than passed over,
because an abbreviation nothing accounts for is exactly where the last one hid.

**Four, the hand written selectors.** `web/src/lib/registry.ts` encodes calls as
four bytes of hex by hand. A typo there does not fail to compile: it asks the
chain a question no contract answers, and the page renders the empty answer as
though the chain had given it. Each one is checked against `methodIdentifiers`
in the compiled artifacts, which is where the compiler already wrote the right
answer down.

**Five, the counts that drift.** A test count, a proof count, a slide count and
a running time are each stated in several files and computed in none of them, so
every release updates some of the places and misses others. Three of them have
already been wrong in public. All four are computable from the repository, so
they are computed and the prose is checked against them.

The first shape of this check passed a mutation it should have caught. It took
the largest running time in a file, so changing `Total 1:45` while a table row
still said 1:47 looked fine, and one place updated with another left behind is
the exact failure the stage is for. It now names the statements it checks rather
than taking a maximum, and each of the three is proven by its own mutation.

**Six, the tests the prose names.** Several documents defend a claim by naming
the test that would fail if the claim stopped being true. That is the strongest
citation this project has and the easiest to break, because renaming a test is a
refactor nothing warns you about while the sentence keeps its confident shape.
Every `test_` name in the documents has to exist in `test/`.

**Seven, links between documents.** External links are deliberately left alone:
the hackathon's own host answers 405 to anything that is not a browser, and the
Creditcoin RPC answers 405 to a GET because it is a JSON-RPC endpoint. A checker
that followed them would report two failures that are not failures, and a tool
with false alarms in it is one people learn to ignore. Links to files in this
repository have no such excuse and are resolved.

**Nine, the word offsets the web app decodes by.** The file that writes
selectors by hand also reads return values by word index, and a wrong index is
quieter than a wrong selector: the call succeeds, a word comes back, and the page
renders a real number from the wrong field. Adding one member to a struct is all
it takes, and `Record` and `Collision` both gained one on 2026-08-20 with nothing
but a person looking at a screen to say the offsets still lined up. Sixteen of
them are now checked against the compiled struct layout, and a mutation that
moves one field reports which field is really there.

**Eight, the claim itself.** Every stage above checks what the repository says.
This one checks what it is for. The whole argument is that a lien can be on
record while the asset stays in the borrower's own wallet, and that is two calls
to settle: the registry says claimed, and the collateral contract on Sepolia
says the borrower still owns it. Both demo deeds pass. If that ever stopped
being true the demo would have become quietly custodial and every document here
would still read exactly the same, which is the reason this is a check and not a
sentence.

Stage six paid for itself before it was finished. `docs/SURFACES.md` cited a
test by an abbreviated name ending in an ellipsis, in a project that had just
written a section about references nobody can resolve. The name was truthful and
the test existed; a reader still had to guess which one. It is written out in
full now, and the abbreviation is not repeated here, because this stage would
flag it and be right to. Four claims that named only a file were upgraded to
name the test, which turns a citation a reader has to trust into one this script
checks.

It was written after the audit, not before, and the first thing it did was fail:

```
3 stale references:
  0x68505d902d3e807a344cbed340d6deaa14e1f4bf2ece9270997000a98bb0de76  cited in: web/src/routes/Demo.tsx
  0x14a445f857bbb368923d7777b41f503aeeefe3480bbc402cf9143407ed55e6a1  cited in: web/src/routes/Landing.tsx
  0xe6b94874151481ab7f52c0d73662028104358de9434a5c21eee4115803cb3eda  cited in: web/src/routes/Landing.tsx
```

The first is worse than the other two. `web/src/routes/Demo.tsx` offered it under
the words "the failed transaction **from the video**", and it was a refusal on a
registry three deployments old while the video showed a different one. All three
now point at the current run, and the check runs before publishing rather than
after somebody notices.

Stage three then found the one stage one could not: `0xaecd340dd30de64f82b63d56d834e67eebb1aafe4cd0d378d2fdc3012033c6b3` in
`docs/QUESTIONS.md`, the `QuorumTooThin` refusal, still pointing at the registry
replaced hours earlier. Eight characters, in a file the deck update did not
touch.

**And it found a sentence that was wrong rather than stale.** In the same pass,
`0x7c82d123` in `docs/CAVEATS.md` resolved to nothing: eight characters is
not a transaction anybody can open, under a sentence that began "Checked rather
than assumed". Checking it properly showed the claim it supported was also
false. Aave v3 does **not** leave the collateral in the borrower's wallet;
supplying moves the underlying out and mints a receipt token back, which is
`0x7cd6a3537c4d302bb3013ef631f9068dfb600058e1ad7890aaedad583e7950cf` at Sepolia
block 11,534,505. What is true is that the borrow moves nothing, which is
`0x1dcf21883efc829c745f29d6081b189c448737feaef086dfbb4f09917f53a68b`. Caveat 6
carries the corrected version and says which half was wrong.

That is the finding worth generalising. An unopenable citation is not only a
broken link, it is where an unchecked claim goes to look checked.

Two things the audit reported that were **not** faults, and both are worth
keeping. Two Sepolia transactions this project cites return null from
`ethereum-sepolia-rpc.publicnode.com` and resolve normally from
`sepolia.gateway.tenderly.co`; a single endpoint audit would have called them
missing, and `worker/config.mjs` already tries several in order for that reason.
And four of the hand written selectors are named locally for what they do rather
than for what they are called on chain, because ChainInfo is snake_case and
AttestorStash is camelCase; the audit prints the mapping instead of failing on
it.

## A real protocol, unmodified and unaware

The demo lenders are ours, which is a fair objection. So the same registry was
pointed at two real protocols on Ethereum mainnet: NFTfi v3 at
`0xB6adEc2ACc851d30d5fB64f3137234BCDCBBad0D` and Blur's Blend at
`0x29469395eAf6f95920E59F858042f0e28D98a20B`. Nothing was deployed on mainnet,
nothing was asked of either of them, and no funds were needed there: Creditcoin
attests Ethereum, so an existing loan can simply be read.

Loan 16928, a real borrower against a real NFT:

| | |
|---|---|
| Taken | `LoanStarted`, mainnet block 25,506,517, tx `0xa089fd2817f18f845ce04b550edab846badc6ecacfa7db8808b09f4be89b6c36` |
| Repaid | `LoanRepaid`, mainnet block 25,717,460, tx `0x34632ee55588a9968385a0c8646700ed31cfc6d7e40430752db29b77e0ab4960` |
| Collateral | `0xd774557b647330C91Bf44cfEAB205095f7E6c367` token 7819 |
| Principal | 0.07 WETH |
| Registered on CC3 | `0xd6f376dd4e71206cbf50c3abcf966f54204d0497f5dd3707ba784c0f172f4e95`, 602,518 gas |
| Released on CC3 | `0x6c7f48ec6b14e922b66ad280f890040df103ace8220abfdd8de8d199de039f8f`, 466,774 gas |

The adapter reads `LoanTerms` out of the log data, where NFTfi keeps the
collateral contract, the token id, the borrower and the principal, and takes the
loan id from the leading topic so both events resolve to one lien. Field names
and layout come from the verified ABI; the two signatures were checked against
live logs, not derived from prose.

Three things worth stating plainly about this integration.

**NFTfi is custodial.** `LoanTerms.escrow` names the contract that holds the
token for the duration, `0x2ae3e46290AdE43593eabd15642eBD67157f5351`. A borrower
who deposited the NFT cannot pledge it elsewhere, so no collision can originate
here. That is caveat 6, and it is why the collision demonstration runs against
non-custodial lenders instead.

**NFTfi has no settlement step.** Repayment returns the token in the same
transaction, so `LoanRepaid` maps to release and the settlement signature is
zero. A settlement proof against this emitter is refused with
`TransitionUnsupported` rather than approximated.

**The obligation changed hands mid-loan.** The address in `LoanRepaid` is not the
borrower who took the loan out. The registry binds a release to the emitter and
the loan id, never to the borrower, so the lien closes correctly anyway. There is
a test on exactly this, against these bytes.

### Blend, the opposite shape

Blend indexes nothing: every field of `LoanOfferTaken` arrives in the data. Worse
for a registry, `Repay(lienId, collection)` names no token id at all, so a
release cannot derive the asset key by itself.

That is why the registry keeps an instance index. On a pledge it records which
asset an emitter opened under which instance id; on a later event whose adapter
returns a zero collateral token, it resolves the lien through that index, keyed
by the emitter as well as the instance. A pledge never gets that fallback,
because an opening lien has to name what it claims.

Lien 435829, a Pudgy Penguin, `0xBd3531dA5CF5857e7CfAA92426877b022e612cf8` token
8189, for 3.29 ether. Taken in mainnet block 25,711,377, tx `0xb1de5da8a64d1f0791799712c2fd9378a483e68a5c83ccaa71801692cb7acb14`,
repaid in block 25,721,378, tx `0x568aae92f2a4052fc516d0e2260cc0d157f35fcf22646a7e1de3c2906dfe21e4`. Recorded on CC3 as
`0x1101d9aa983c1bfce1429d0e19714c14b76a726a59c2d2461208dd07dd15809b` and released as `0x9dec679284568aa04b8114678bd6b2dc8e517d11a3c547392747e7a1b229550d`, the release carrying no token id
whatsoever.

Seizure is proven too. A Blend lien also ends when an auction fails and the
lender takes the token, through `Seize`, which is identical in shape to `Repay`
and just as final. A transition may therefore name several events: lien 438956,
Pudgy Penguin 4271 for 3.868 ether, taken in block 25,550,390 and seized in
block 25,651,509, is recorded as `0x0d6d8c0a3dcdf9af8ff72c4db605095d7189afe50898b6826aafee68fa338e67` and closed as `0x2201a81dba74b3593140eb07f5524e662de411ce745d8863a4438953ce5c91b0`.

An adapter that knew only about repayment would have left every seized lien on
file, and a stale claim is indistinguishable from a live one.

Gas is higher than a Sepolia proof, 712k for the NFTfi pledge against roughly
450k, because those payloads are larger and carry more continuity roots.

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
`0xcccE8847a63f6fD460FA86CDaE8a05bAe102e0F7`, decoder linked to
`0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f`, `minConfirmations[1] = 64`,
`minAttestors[1] = 3`, admin `0x59De8802122068A3fc2950812d4621E8Aa0F8516`.

A chain needs both numbers before the registry will read it. `provision.mjs`
states them before allowlisting any emitter on that chain, because an emitter
allowlisted first sits there looking configured while every proof against it
reverts.

Adapters: NFTfi `0xE51eD7b5e8Fda55053C91726B0739813510FE913`, Blend
`0xB1bf092e8e16F0892b95E1550DbF3c49d4644c67`, both pure and stateless. They hold
no state, so a redeploy of the registry reuses them.

Configuring a fresh registry is one command, `node worker/provision.mjs`, and
`node worker/provision.mjs --check` reads any registry back against the same
plan rather than trusting that the commands were run.

Earlier deployments are left on chain rather than hidden:
`0x6A44dE8E02b2617A569FDc147c45F8a15D0087De` carries the W1 run below,
`0x63198729827F0eb9ED1A5eBC8FCDe58CBE7Fc2F2` and
`0x24089da935030bDB09Fb7a47adF68c51661cbeF0` were superseded the same day by the
collision record and then by the instance index,
`0xf6229779f67E9935c969f835Ca3DA1f67eA7ECCd` carries the first Blend release,
`0x943BD86a4E3ec9F3e24aDBcd3049Fb8C571e9c36` predates seizure being provable.

Three from 2026-08-20 exist only because this change was measured rather than
assumed. `0x4E75FA6b0e83885A789938aD5B3512b08ad62b33` is the previous code
redeployed the same day as a control, and it reproduced the earlier gas figures
to the gas, which is what proved the environment had not moved.
`0xF7C08bAE1dAb1A3f96144114345ABbFd4079e3B4` carries a full fifteen proof run and
the `QuorumTooThin` refusal in `0x733962b700b704463249dcd6b1720376e3f8165adf895c557e472cd214415577`, and was superseded within the
hour by the smaller shape of the same feature.
`0x65F561a73451E878327Cf3775dc21Ca9CBEF72e8` is that smaller shape, deployed to
measure it before it went live.

`0xB537A4A267D5DB4AdA30722aeC04b3D4898A95e1` carried its own fifteen proof run
and its own `QuorumTooThin` refusal, and was replaced the same day because the
batch entry point verified the proof before it checked the quorum. That order
never changed an outcome, only what a refused batch paid for on the way to being
refused, and it disagreed with the single entry point. A registry whose source
did not match its deployed bytecode would have been the larger problem.

`0x25b0963E40536dF9519Da839cd7c36bc1A47bd8D` carries the fifteen proof W2 run and
the batch measurement, and was superseded on 2026-08-20 by the attestor quorum:
it recorded nothing about how much security stood behind the proofs it accepted.

Two more were superseded on 2026-08-19 by the two reviews caveat 7 describes.
`0x90f03329aF069BbC4AB4d34c03c9c6DF1Fcc32d4` predates the receipt poisoning fix.
`0x020a11bCF77eDF881ca7FFE865390E8192CeC187` carried a full twelve proof run and
still inferred which emitter a proof was about, which the second review broke.

Their transactions remain valid evidence of what the code did at the time, which
is the reason they are listed rather than quietly dropped.

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
