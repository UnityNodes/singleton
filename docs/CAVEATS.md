# Caveats

Read this first. Every limitation below is real, none is hidden, and each one is
stated before anybody has to find it.

---

## 1. This is detection and priority, not prevention

The registry catches a second pledge only if the first one was registered.
Attestcoin proves that a transaction happened. It cannot prove that one did not,
so proof of absence is out of reach by construction.

This is exactly how UCC-9 works, and UCC-9 governs a trillion dollar lien market.
Prevention comes from priority plus the habit of checking before lending, not
from omniscience.

**And the answer is about a key, not about an asset.** Found by using the
register rather than by reading it: type an address that is not a contract and a
token id that was never minted, and it answers `free to lend against`, because
nothing is on file against that key and nothing is what there is to report. The
register cannot tell an unencumbered asset from one that does not exist.

That is a limit rather than a bug, and closing it would cost the property the
page is built on. Whether a token exists is one call to its own contract on its
own chain, and every number on `/register` is an `eth_call` against a single
Creditcoin node, which is what makes it repeatable by anybody with no
infrastructure. A lender integrating this already holds the collateral contract
in hand and can ask it directly. The page now says so where it answers.

## 2. The novelty is the mechanism, not the concept

MonetaGo already runs a secure financing registry that solves this problem. It is
permissioned, bank-facing, and routed through Swift. That validates the pain
rather than diminishing it.

The wedge is that the same job is done here with no trusted operator: the witness
is a precompile proof, not a company. We do not claim to beat MonetaGo on network
effect or on legal standing, because we would lose both arguments.

## 3. Adoption and cold start

A registry is worth exactly as much as its coverage. Nobody is compelled to
consult it before lending.

Unilateral witnessing softens this, because a pledge can be recorded without the
pledging protocol cooperating or even knowing. It does not remove it.

## 4. EVM only, on-chain logs only

The source chain must be EVM and attested by Creditcoin, which today means
Ethereum and Sepolia. The fact must live in a log. Anything off-chain, or on a
non-attested chain, is outside the system.

## 5. Global freeze griefing

`assetKey` deliberately excludes the emitter, so that the same asset pledged in
two protocols produces one key and collides. That is the product. The cost is
that `state[assetKey]` is global across every allowlisted emitter.

A compromised or malicious allowlisted protocol can therefore freeze an asset it
does not hold, by registering a pledge against it.

For custodial pledges this closes: require a `Transfer` of the token to the
emitter in the same receipt, and a griefer cannot forge it, because a real
transfer needs the owner's key.

For non-custodial liens there is no transfer to require, so this stays a genuine
limit. What softens it:

- the allowlist is kept minimal, append-mostly, and visible on-chain, so the
  worst case is a detectable and reversible freeze by a named party rather than
  a silent fabrication by an indexer nobody audits
- roadmap: an owner-signed consent, EIP-712, carried inside the pledge event.
  That converts the mitigation into cryptographic prevention, at the cost of
  requiring the protocol to opt in

**A related question, asked and measured rather than left open.** Refusals are
unbounded: anybody may keep filing them against a live lien, and releasing that
lien deletes them all in one transaction. If clearing them cost more than filing
them, a griefer could bury an asset under refusals nobody could afford to lift.

It does not. Clearing one costs 752 gas on release, flat and linear to two
hundred filed with no bend, while filing one costs a source chain transaction
and a transaction here. The arithmetic runs against the griefer. That number is
now a test rather than a paragraph, in
`test_refusalsPileUpWithoutMakingTheReleaseUnaffordable`, with a bound close
enough to the measurement to notice a change: a first attempt at it used a limit
several times larger and waved through a deliberate regression that made each
refusal half again as dear.

## 6. Custody and collision are in tension

Worth stating plainly, because it shapes what the product is for.

If a protocol takes custody of the token, the borrower cannot then pledge it
elsewhere. There is nothing to collide. Double pledging is only possible when at
least the second leg is non-custodial, meaning the borrower keeps the asset and
the protocol records a lien against it.

So the registry's market is non-custodial liens and mixed cases. That is not a
narrowing, it is a location: custody prevents the fraud mechanically, and
everywhere custody is absent the fraud is live and unaddressed.

The uncomfortable consequence, checked on chain rather than assumed. Both real
protocols this submission reads take custody. A live Blend `borrow` transfers
the token from the borrower to Blend, and NFTfi's own `LoanTerms` carries an
`escrow` field naming the contract that holds it. So the six mainnet proofs
demonstrate that the reader works against protocols that never heard of us, and
they do not demonstrate that the fraud is possible in those protocols, because
it is not. The collision is shown on Sepolia, between two non-custodial lenders
written for this submission.

That gap is the honest state of the beachhead, and the reason for it is more
interesting than the gap.

On chain, possession costs one transfer, so escrow is the default. We went
looking for a live non-custodial lender to read, and what came back is worth
writing down.

For **fungible** collateral the shape exists and is busy, though not in the
shape this file claimed until 2026-08-21.

It used to say that Aave v3 and Euler v2 leave the collateral in the borrower's
own wallet. That is false, and the transaction cited as proof of it could not be
opened: eight hex characters is not a transaction anybody can look up. Both
faults were found by `script/audit-claims.mjs` and the sentence was checked
properly rather than repaired.

What the chain says. In Aave v3 on Sepolia, supplying **moves the underlying
out**. In `0x7cd6a3537c4d302bb3013ef631f9068dfb600058e1ad7890aaedad583e7950cf`,
block 11,534,505, WETH leaves the supplier for the aToken contract
`0x5b071b590a59395fe4025a0ccc1fcc931aac1830` and `aEthWETH` is minted back. The
borrower ends up holding a receipt, not the asset. Euler v2 was not checked and
no claim is made about it here.

What is true is narrower and still the point. The **borrow** moves nothing: in
`0x1dcf21883efc829c745f29d6081b189c448737feaef086dfbb4f09917f53a68b`, block
11,534,036, both transfers are inbound to the borrower, a variable debt token
minted from the zero address and the borrowed USDC paid out. The lien is a
registry entry rather than a per asset escrow, and the borrower's claim stays
fungible and composable. That is the property worth having, and it is not the
same as the collateral staying put.

Either way the key does not fit. Their lien is keyed by `(reserve, account)`,
because a share of a pool has no token id, and this registry is built on
`(chainKey, token, tokenId)` for a single unique asset. Reading Aave here would
mean either a different registry or a dishonest key, so it is named rather than
bolted on.

For **unique** collateral, the market is not thin, it is empty, and it could not
have been otherwise. Every mechanism for encumbering a token in place needs the
token contract to have opted in: a lockable ERC has to be implemented by the
collection itself. So none of them can ever apply to collateral that is already
deployed, which is all the collateral that exists. That is why every attempt at
non-custodial NFT lending has reached for a proxy wallet instead, and a proxy
wallet is possession wearing a different hat. A scan of roughly a month of
Ethereum blocks for lockable-token lien events returned nothing from any lender.

Two independent searches were run and agreed, which is worth saying because the
numbers are small enough to look like a search that gave up. The one protocol
that ever shipped in-wallet encumbrance for NFTs, PWN's Asset Transfer Rights,
minted twelve tokens in its life and financed one loan; its registry holds zero
today. Of the three lockable token standards, one has a live implementation
whose lock is dormant, one has a live implementation with no lender, and one has
no implementation found at all. Every product that markets itself as
non-custodial NFT lending moves the asset into a smart wallet it co-signs, which
is possession with a longer name.

So the honest sentence is not "we serve this market". It is closer to the
opposite, and it is the strongest thing in this file:

**Non-custodial lending does not exist because there is no priority register.**
Without one, a lender cannot see whether somebody already lent against the
collateral, so the only safe move is to take it. Possession is not a preference
here, it is the fallback that a missing register forces. That makes the empty
market a consequence rather than an objection, and it makes this the piece that
has to exist first rather than the piece that arrives after the demand.

That is an argument, not a proof, and it is placed in the caveats rather than on
the front page for exactly that reason. What is proven here is the primitive.

It also means the dual-log transfer binding in caveat 5 and the collision demo
cannot both apply to the same pledge. The binding is an optional stronger mode
for custodial emitters; the demonstration is non-custodial.

## 7. The relayer names the log, and that is load bearing

A proof carries the emitter and the log index it is about. The registry does not
search the receipt for a matching log, and does not count how many there are.

This is the correction to two findings that were the same mistake twice. The
party who sends a transaction on a source chain is usually the borrower, so
anything the registry infers by scanning that receipt is chosen by the borrower.
An external review on 2026-08-19 found that a decoy log with a borrowed topic
zero made a genuine pledge unregisterable. A second review the same day found
that the fix was not enough: a real log from any other allowlisted protocol,
ordered first, decided who the emitter was, and the genuine pledge became
unregisterable again at the cost of one throwaway lien. An unregisterable pledge
is first to file inverted, because the borrower then chooses which lender gets
priority.

Naming the log removes the inference and the whole class with it. A receipt full
of decoys changes nothing about what a relayer can file, and a batch pledge of
several assets in one transaction is now supported rather than refused, because
each log is filed on its own and the replay nullifier is keyed by log as well as
by transaction. `test_aDecoyWithTheSameSignatureChangesNothing` and
`test_anUnrelatedAllowlistedLogDoesNotSuppressAPledge` carry both attacks as regression
tests.

## 8. Canonicalisation is solved here and not in general

For on-chain RWA the key is free: `keccak256(chainKey, tokenAddress, tokenId)`
names an asset with zero ambiguity and no agreement between protocols.

For off-chain invoices, the trillion dollar case, it is not free. Two protocols
will hash the same invoice differently, and reconciling that is make or break. We
prove the primitive where the key costs nothing and name the canonical standard
as the bridge to the larger market. That is a roadmap, not a claim.

## 9. The allowlist is a semi-trusted layer, and the adapter more so

The allowlist governs which logs are read. The BlockProver governs whether they
are true. Those are different powers, and the boundary between them is the one
real limit on an administrator: no admin action makes the precompile accept a
transaction that was never mined.

Everything on this side of that line, an administrator can do. This used to read
"an administrator can exclude, but cannot fabricate", and that sentence was
false. The ABI adapter maps a protocol's native event onto
`(token, tokenId, instanceId)`, so an administrator who installs an adapter
decides what a real log means, and an adapter that ignores its argument can file
a lien against an asset whose owner was never involved. Removing the adapter
afterwards does not undo what it wrote. The test that used to back the old claim
only proved that de-allowlisting a lender blocks that lender's pledge; it never
attempted fabrication. `test_theAdminCanFabricateThroughAnAdapter` attempts it, and it succeeds.

So the honest statement is narrower. The adapter is trusted for interpretation
of something already proven to exist, which is auditable in the fifty to a
hundred and thirty lines
of pure code. An indexer would be trusted for existence itself, which is not
bounded by anything. That is the difference worth defending, and it is smaller
than the sentence it replaces.

Exclusion is bounded in the other direction: the allowlist gates entry, not
exit. A lender that has been excluded can still release what it already holds,
so excluding a protocol cannot strand the assets of borrowers who were not party
to that decision.

Two limits are worth naming with it.

An adapter can only carry what the protocol actually emits, and protocols emit
less than one would like. Blur's Blend publishes the token id when a loan is
taken and omits it when the loan is repaid; NFTfi has no settlement step at all.

Three answers, depending on what is missing.

Where a transition does not exist at all, the adapter declares it unsupported
and the registry refuses it with `TransitionUnsupported` rather than mapping
some other event onto it.

Where the transition exists but does not name the collateral, the adapter
returns a zero token and the registry resolves the lien through the instance id
it recorded when the loan was opened, keyed by that emitter and no other. An
opening pledge never gets that fallback: a lien has to name what it claims.

Where a protocol ends a lien in more than one way, the adapter names every event
that ends it. Blend closes a lien with `Repay` when the borrower pays and with
`Seize` when an auction fails, and both are proven. Missing one of them would
leave liens on file that the source chain has already closed, which is the
failure mode a registry has to care about most: a stale claim looks exactly like
a live one.

An adapter is also a per protocol integration written by us, not by the
protocol. It is the one place where being wrong looks like being right, which is
why each one stays short enough to read in a sitting and is tested against real
logs captured from the chain it claims to read.

## 10. The attestor floor is a liveness dial, and it points both ways

The registry reads how many attestors are bonded for a source chain and refuses
to create records once that set falls below a stated floor. This is a real
guard, and it has a real cost: a chain whose attestor set thins stops being
readable, so a lender that would have filed first loses the race for reasons
that have nothing to do with the borrower or the asset.

This is not hypothetical in either direction, which was established by reading
the precompile at every block the public node still keeps. Sepolia went 0 to 1
to 6 to 7 between 2026-05-01 and 2026-07-09; Ethereum went 0 to 1 to 3 to 4
between 2026-05-01 and 2026-07-16, and spent part of that window on the
supported chain list with no attestors behind it at all. The floor would have
refused Ethereum proofs for most of May. It also sits one attestor below the
current Ethereum set. The guard refuses below the floor and not at it, so the
first departure leaves three and changes nothing; the second halts the mainnet
half of this project's own demo. The full table is in
[VERIFICATION.md](VERIFICATION.md).

That is the intended trade. A first to file register whose records are only as
good as the quorum behind them should stop writing rather than write records
nobody can weigh. But it is a trade, not a free improvement, and it means the
floor is a number an administrator sets and can move. Setting it high is a way
to halt a chain, which belongs on the same page as everything else in caveat 9.

Two things bound it.

The floor gates entry and never exit, tested in
`test_aThinnedAttestorSetDoesNotTrapAnAssetAlreadyOnFile`. A settlement or a
release goes through whatever the attestor set is doing, so no attestor rotation
can strand an asset already on file.

That used to read "no administrator and no attestor rotation", which was false,
and it is corrected here rather than quietly. The confirmation depth is a second
dial and it does not behave like the floor: `_requireFinal` sits inside
`_readSourceEvent`, which every proof consuming call shares, so raising the depth
refuses settlements and releases as readily as it refuses new pledges. An
administrator who sets it high enough holds an asset pledged until the same
administrator lowers it, which is what `test_theAdminStrandsAnAssetByRaisingTheConfirmationDepth`
now pins. Nothing recovers from it without that key. It belongs in caveat 9 with
the rest of the administrator's reach.

Zero is refused. `setMinAttestors(chainKey, 0)` reverts `QuorumNotSet`, and a
chain with no floor stated records nothing at all rather than recording
everything. The registry has already had one review find a guard whose default
disabled it, and this one was written after that lesson rather than before.

What the floor cannot do is make a thin set safe. If Creditcoin's attestors for
a chain are compromised rather than merely few, the count reads high and the
proofs are worthless, and no number this contract can read would say so. The
floor is a check on how much security is standing, not on whether it is honest.

## 11. The recorded quorum is the one bonded at filing, not at attestation

A hostile review on 2026-08-29 asked which number `Security.attestors` holds, and
the answer is narrower than the way this project had been describing it.

The registry reads `getAttestorsCount(chainKey)` inside the transaction that
accepts a proof. That is the set bonded **at the moment the record is filed**. It
is not the set that stood behind Creditcoin's original attestation of the source
block, and the two are measurably different.

The worked case is the headline mainnet proof in this submission. NFTfi loan
16928 was taken at Ethereum block 25,506,517. Creditcoin's attested tip for chain
key 3 first covered that height at CC3 block 5,110,417, and
`getAttestorsCount(3)` at that block returns **3**. The confirmation depth does
not rescue it either: the earliest tip satisfying `height + 64` is reached around
CC3 5,110,478, where the count is still 3. The record was filed months later and
stored **4**, which the `AttestationWitnessed` log in
`0x0b54c68f65649096bb124eed889f728f68ae6affcb70e101de9d7807253145a1` preserves.

**Why the contract stores the filing number.** `AttestorStash` exposes
`getAttestorsCount(uint64)` and `getMinBondRequirement(uint64)` and nothing that
takes a height, checked by calling five plausible historical selectors and having
all five rejected. The attesting-time count is not reachable from inside a
transaction. It is reachable from outside, with an archive `eth_call` at the CC3
block where the attested tip first covered the source height, which is exactly
how the history table in [VERIFICATION.md](VERIFICATION.md) was built.

**One half of the reading is right and stays.** As the floor, the filing-time
number is the correct input: admission control decides whether to write today, so
today's set is what should gate it. The live refusal `QuorumTooThin(1, 7, 8)` in
`0xe19625fe701992994240bc6db4695669172558da26fddde694e27b25642be6ef` is that
half working.

**And the record carries the evidence of its own staleness**, which nothing said
before. `Security.attestedTip` for that lien is 25,798,240 against a source
height of 25,506,517: the proof was 291,723 Ethereum blocks old, about six weeks,
when it was filed. A reader who wants the attesting-time quorum has the two
numbers needed to go and fetch it.

The wording was wrong in four places and is corrected: the register page, the
landing page, the README and [SURFACES.md](SURFACES.md). It is left alone in
`src/SingletonRegistry.sol`, whose defining sentence for the struct already says
"at the moment it was made", and for a reason worth stating: editing a comment in
that file changes the metadata hash embedded in the bytecode, so the deployed
registry would no longer match the source in this repository. Tested rather than
assumed. Correcting a comment there costs a redeploy, a fifteen proof replay and
a re-recorded video, which buys no truth that this caveat does not already carry.

## 12. Repaying a debt does not free the asset, and the borrower cannot free it

A settled lien still blocks the asset. `_recordPledge` refuses anything that is
not `FREE`, so `SETTLED` is as much of a block as `PLEDGED`, and only a proven
release clears it. That much is deliberate: the source chain decides when a lien
is over, not this registry, and
`test_aSettledLienBlocksTheAssetWithoutAccusingTheNextBorrower` pins it.

What is easy to miss is who holds the key to that release. Both demo lenders here
separate repayment from discharge, and in both the discharge belongs to the
lender: Harbor's `dischargeLien` is desk only, Meridian's `closePosition` is
underwriter only. So a borrower who has repaid in full cannot produce the log
that frees their own collateral, and neither can this registry, and neither can
anybody else. A lender who stops operating leaves every asset it settled blocked
for as long as the registry runs. `test_theBorrowerCannotFreeTheirOwnAssetAfterRepaying`
is that case.

Three things bound it, and none of them removes it.

The two shipped mainnet adapters do not have this shape. `NftfiV3Adapter` maps
`LOAN_REPAID` straight to a release and returns an empty signature list for the
settlement step; `BlendAdapter` maps both `Repay` and `Seize` to a release. In a
protocol where repayment is itself the closing event there is no second log to
wait for, which is why those two are the ones read on mainnet.

The block is on the asset, not on the borrower, and it is visible. A lender
looking at a `SETTLED` record can see the debt was repaid and who owes the
discharge, which is a different negotiation from a lien nobody can account for.

And this is an argument for the roadmap item already named in caveat 5: an
owner-signed consent carried in the pledge would let the same signature schema
carry a release. It is named as a direction, not claimed as built.

## 13. A batch can be griefed by spending one of its members first

`registerPledges` is all or nothing, and the reason is in the contract: partial
success would leave a relayer unable to answer "did my pledge land" from the
transaction alone. The cost of that choice is a denial of service that needs no
capital.

Nullifiers key on the source event, `keccak256(domain, chainKey, height, txIndex,
logIndex)`, and carry no `msg.sender`. `registerPledge` is permissionless. So
anybody watching the mempool, which on the default RPC for this project answers
`txpool_content` in the clear, can take one member out of a pending batch,
file it alone, and the batch then reverts `ProofAlreadyConsumed` for every member.
`test_aProofCannotBeSpentAloneAndThenInABatch` is that sequence.

The victim pays more than gas for a refused transaction. The quorum read and the
whole batch `verify` are paid before the loop that discovers the collision, which
on a four item batch is most of the 989,237 gas measured in
[VERIFICATION.md](VERIFICATION.md).

The griefer's own filing is real and it lands, which is what makes this cheap:
the pledge is recorded to the emitter named in the source event, not to
`msg.sender`, so a griefer spends one CC3 transaction and files somebody else's
pledge for them. Nothing is stolen. The registry's state ends up correct for that
one member and wrong for the relayer's expectations about the other three, which
is precisely the ambiguity the all-or-nothing rule was argued to prevent: a
revert now means either nothing landed, or one thing landed inside a stranger's
transaction.

What bounds it: the loss is bounded by gas, is repairable by refiling the
remaining members, and cannot produce a false record, because the griefer can
only replay a proof that was already valid. What would remove it is binding the
nullifier or the batch to a submitter, which costs a redeploy and is not built.
