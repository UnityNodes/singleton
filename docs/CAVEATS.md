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

## 7. One pledge event per transaction, from the emitter

The registry requires exactly one matching pledge log per proof, counted among
the logs the chosen emitter wrote. A legitimate batch pledge, several assets in
one transaction, cannot be registered as things stand. Nothing prevents
supporting it later; it is simply not in scope now.

The scoping to the emitter is not cosmetic. Topic zero is owned by nobody: any
contract can declare the same event, and the party who sends a pledge
transaction is the borrower. Counting logs from every contract in the receipt
would let a borrower attach a second matching log to their own genuine pledge,
make that pledge permanently unregisterable, and then pledge the same asset at a
second protocol with the register still reporting it free. That is first to file
defeated by the one party with a motive, and it is why the emitter filter sits
inside the count rather than after it. An independent review found this; the
fix, its proof of concept and the regression tests are in
`test/Poisoning.t.sol`.

A receipt carrying pledges from two allowlisted protocols is the same case: the
first emitter in the receipt is read and the second's pledge goes unwitnessed,
rather than both being refused.

## 8. Canonicalisation is solved here and not in general

For on-chain RWA the key is free: `keccak256(chainKey, tokenAddress, tokenId)`
names an asset with zero ambiguity and no agreement between protocols.

For off-chain invoices, the trillion dollar case, it is not free. Two protocols
will hash the same invoice differently, and reconciling that is make or break. We
prove the primitive where the key costs nothing and name the canonical standard
as the bridge to the larger market. That is a roadmap, not a claim.

## 9. The allowlist is a semi-trusted layer, and the adapter more so

The allowlist governs which logs are read. The BlockProver governs whether they
are true. Those are different powers and the difference matters: an administrator
can exclude, but cannot fabricate.

The ABI adapter is weaker than that. It maps a protocol's native event onto
`(token, tokenId, instanceId)`, so it touches derived truth, not just selection.
It stays thin, it is pure, and it is named for what it is.

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
