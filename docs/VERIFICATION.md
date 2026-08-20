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
| 1. Harbor lends against deed 42 | `Pledged`, block 11,510,076 | PLEDGED, certificate to Harbor, `0x2e43d060...` | 405,286 |
| 2. Meridian lends against the same deed | `Pledged`, block 11,510,077 | refused live with `AssetNotFree`, failed transaction `0x68505d90...` | reverted |
| 3. The refusal is kept | same log, `reportCollision` | recorded against the asset, `0x57bcddfa...` | 406,462 |
| 4. Harbor is repaid | `Settled`, block 11,513,436 | SETTLED, `0x982f67a7...` | 409,598 |
| 5. Harbor discharges the lien | `Released`, block 11,513,437 | FREE, certificate burned, `0xf4839908...` | 432,670 |
| 6. Meridian re-files the same lien | the step 2 log again | PLEDGED by Meridian, `0xf079c988...` | 404,838 |

Deed 42 ends held by Meridian with no refusals on file, which is the point of
the fix rather than a gap: the refusal belonged to Harbor's lien and went with
it. A second asset carries the standing case.

| Step | Source event | Result on CC3 | Gas |
|---|---|---|---|
| 7. Harbor lends 1,200 against deed 43 | `Pledged`, block 11,528,165 | PLEDGED, `0x14a445f8...` | 409,318 |
| 8. Meridian lends against deed 43 | `Pledged`, block 11,528,166 | refused live, failed transaction `0xe6b94874...` | reverted |
| 9. The refusal is kept | same log, `reportCollision` | on file and staying there, `0x5a1dacba...` | 411,390 |

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
| 10. NFTfi loan 16928 taken | `LoanStarted`, block 25,506,517 | PLEDGED, `0xd6f376dd...` | 602,518 |
| 11. The same loan repaid | `LoanRepaid`, block 25,717,460 | FREE, `0x6c7f48ec...` | 466,774 |
| 12. Blend lien 435829 taken | `LoanOfferTaken`, block 25,711,377 | PLEDGED, `0x1101d9aa...` | 454,216 |
| 13. The same lien repaid | `Repay`, block 25,721,378 | FREE, `0x9dec6792...` | 442,120 |
| 14. Blend lien 438956 taken | `LoanOfferTaken`, block 25,550,390 | PLEDGED, `0x0d6d8c0a...` | 443,464 |
| 15. That lien seized after a failed auction | `Seize`, block 25,651,509 | FREE, `0x2201a81d...` | 468,552 |

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
| The same four as one batch, `0x94f2484e...` | **989,237** |
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
| Registry before the quorum, `0x4E75FA6b...` | 12,772 | 189,996 |
| Registry with the quorum, second shape, `0x65F561a7...` | 14,287 | 210,827 |
| Registry with the quorum, first shape, `0xF7C08bAE...` | 14,747 | 217,442 |

Subtract the no-code baseline and divide by size: 13.13, 13.19 and 13.23 gas per
byte. The three agree to within one percent, and `minConfirmations(uint64)`
gives the same three numbers plus a constant 416, so the slope is a property of
the code and not of the function called.

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
`0x731c345d...` reads back its 9,598 bytes at 4,728,443, which is how the
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
attestors against a floor of three. One deregistration halts Ethereum reads on
this registry, which would stop the mainnet half of the demo. That is the guard
working, not a fault, and the floor was not lowered to two to make the number
comfortable: three is the smallest set in which no single attestor is a
majority, and picking the threshold to fit the outcome is the thing this file
exists to prevent. `provision.mjs --check` prints the margin so nobody has to
notice it the hard way.

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
| Taken | `LoanStarted`, mainnet block 25,506,517, tx `0xa089fd28...` |
| Repaid | `LoanRepaid`, mainnet block 25,717,460, tx `0x34632ee5...` |
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
8189, for 3.29 ether. Taken in mainnet block 25,711,377, tx `0xb1de5da8...`,
repaid in block 25,721,378, tx `0x568aae92...`. Recorded on CC3 as
`0x1101d9aa...` and released as `0x9dec6792...`, the release carrying no token id
whatsoever.

Seizure is proven too. A Blend lien also ends when an auction fails and the
lender takes the token, through `Seize`, which is identical in shape to `Repay`
and just as final. A transition may therefore name several events: lien 438956,
Pudgy Penguin 4271 for 3.868 ether, taken in block 25,550,390 and seized in
block 25,651,509, is recorded as `0x0d6d8c0a...` and closed as `0x2201a81d...`.

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
the `QuorumTooThin` refusal in `0x733962b7...`, and was superseded within the
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
