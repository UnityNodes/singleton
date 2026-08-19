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

## 6. Custody and collision are in tension

Worth stating plainly, because it shapes what the product is for.

If a protocol takes custody of the token, the borrower cannot then pledge it
elsewhere. There is nothing to collide. Double pledging is only possible when at
least the second leg is non-custodial, meaning the borrower keeps the asset and
the protocol records a lien against it.

So the registry's market is non-custodial liens and mixed cases. That is not a
narrowing, it is a location: custody prevents the fraud mechanically, and
everywhere custody is absent the fraud is live and unaddressed.

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
by transaction. `test/Suppression.t.sol` carries both attacks as regression
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
attempted fabrication. `test/AdminPower.t.sol` attempts it, and it succeeds.

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
