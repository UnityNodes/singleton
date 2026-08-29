# The questions, and the honest answers

Four simulated panels, the hostile half only. The simulator also emits a
predicted score per axis; that number is discarded on purpose. Predicting a
grader's number without having seen a single competing entry is a guess about an
unobserved distribution, and it is the failure mode this preparation exists to
avoid. The questions are useful. The score is not.

Answers here are the real ones. Where the honest answer is a limit, it is
written as a limit rather than argued away.

---

## The protocol engineer

**"You use three precompiles and attest two chains. What else does the platform
expose, and why did you not touch it?"**

The hardest question on the sheet, because the usual reading of depth is
breadth. BlockProver, ChainInfo and AttestorStash are the three surfaces a
witness needs: one proves a log was included, one says how far the attestation
has reached, and the third says how much bonded stake is behind it. Every other surface is listed with a stated reason in
[SURFACES.md](SURFACES.md), because an unused surface with no reason next to it
is an oversight rather than a decision.

**"`calculateTxIndex` recovering position from merkle path laterality is the
entire thesis of another entry here. What is yours?"**

Theirs, and we say so before anybody points it out. Here it is plumbing: the
nullifier needs a position and the proof payload does not carry one. The claim
is the registry, not the index recovery.

**"Why the view form of `verify` rather than `verifyAndEmit`?"**

The registry writes its own state and does not need the precompile to emit on
its behalf. Taking the non-view form would spend gas producing a log nobody
reads.

**"Your finality guard is `height + depth <= tip`. Why not `tip - depth`?"**

Because subtraction underflows and reverts opaquely on a chain whose attested
tip is lower than the configured depth, which is a real state for a freshly
added chain. Written as an addition it fails with `NotFinal` and the three
numbers that produced it.

**"What happens if nobody configured a depth for a chain?"**

It is unreadable. Zero is refused on write and on read rather than stored,
because a depth of zero accepts a pledge one block deep, which is exactly the
reorg window the setting exists to close. An independent review found that
default on 2026-08-19 and it is now `ConfirmationsNotSet`.

---

## The credit markets judge

**"UCC-9 is filed by the secured party against the debtor and searched by debtor
name. Yours is keyed by the asset. That is a different index. Does the analogy
survive?"**

Partly, and the part that does not survive is worth saying. UCC-9 indexes by
debtor because a floating lien over "all inventory" has no other handle. An
on-chain RWA token has a handle that costs nothing:
`keccak256(chainKey, tokenAddress, tokenId)` names one asset with no agreement
between protocols. So this is the asset-indexed case, which UCC-9 also has for
titled goods like vehicles. The debtor-indexed case, and the fuzzy matching it
needs, is caveat 8 and it is roadmap.

**"Who pays to file, and who pays to file a refusal?"**

The lender pays to file, because filing is what buys priority; that is the same
incentive that makes UCC-9 work without anybody being compelled. The refusal is
paid by whoever wants it on file, and that is usually the incumbent lender, who
gains evidence that somebody tried. Both are permissionless: the proof carries
the authority, not the sender.

**"A lender who does not want their book seen simply does not file. What forces
adoption?"**

Nothing forces it, and the UCC-9 answer only half transfers, so here is the
whole of it.

Off chain, an unfiled lien loses to a filed one because a court says so. On
chain there is no court: the asset moves according to whoever can call
`transferFrom`, and a register entry does not change that. So "filing buys
priority" is weaker here than the analogy suggests, and pretending otherwise
would be the kind of claim this document exists to avoid.

What filing actually buys is narrower and real. It buys evidence, dated and
witnessed by somebody with no stake, which is what a lender needs when the
dispute is not about who can move the token but about who is owed. And the
register's stronger product is not the filing at all, it is the reading: a
lender's risk desk wants to be told the moment somebody else files against
collateral it already holds. That flips who pays, from the filer, who gains
least, to the reader, who gains most, and it needs no court and no mandate to be
worth money.

The version pitched here is the primitive. The version with a payer is the
alarm on top of it, and it is named as a direction rather than claimed as
built.

**"What stops a lender watching the mempool and filing first against somebody
else's borrower?"**

Nothing, and that is caveat 5, written down before anybody asked. The key
deliberately excludes the emitter, which is what makes a collision detectable at
all, and the cost is that a griefer with a real pledge log can occupy a key. The
stronger mode for custodial protocols binds the pledge to a `Transfer` of the
token in the same receipt, which a griefer cannot forge.

---

## The security judge

**"The adapter is a contract you trust to translate a foreign log. A malicious
adapter can name any token it likes. How is that different from trusting an
indexer?"**

The sharpest objection here, and the honest answer concedes more than it used
to. This page previously said an adapter cannot fabricate a pledge that never
happened. That was wrong, and a review proved it: an adapter that ignores the
log it is handed can file a lien against an asset whose owner was never
involved, and removing the adapter afterwards does not undo what it wrote.
`test_theAdminCanFabricateThroughAnAdapter` performs that attack rather than asserting it cannot
happen.

So the boundary is narrower than the sentence it replaced. What no adapter can
do is make the precompile accept a transaction that was never mined; existence
is decided by consensus and is not for sale. Everything downstream of that,
meaning what a real log is taken to mean, is the adapter's, and therefore the
administrator's who installed it.

The difference from an indexer is the size of what is trusted, and it survives:
an indexer is trusted for existence itself, which is unbounded, while an adapter
is trusted for the interpretation of something already proven to exist, in about
fifty to a hundred and thirty lines of pure code anybody can read. That is a
smaller claim than the one
this document used to make, and it is the one that is true.

**"The allowlist is admin-controlled. Worst case if that key is compromised?"**

Worse than the allowlist alone suggests, because `setAdapter` is the same key.
An attacker can censor honest protocols, and through an adapter they can also
write lien records that describe nothing real. What they cannot do is forge an
inclusion proof or make the precompile accept a log that was not mined, so every
record still points at a transaction that happened even when the meaning
attached to it is a lie. They cannot take an asset either: the registry holds no
funds and the certificate is soulbound.

The mitigation is not built and is named rather than implied: a timelock on
`setAdapter`, or adapters frozen per emitter after first use.

**"Two High severity bugs were found on 2026-08-19. What else is unfound?"**

Unknown, which is the only honest answer, and the shape of the two that were
found is the useful part.

The first: logs were counted across the whole receipt rather than the chosen
emitter's, so a borrower could attach a decoy carrying the registry's own event
signature and make their genuine pledge unregisterable. The second review found
that fix incomplete, because the emitter itself was still inferred from a
receipt the borrower orders, so one log from any other allowlisted protocol
suppressed the pledge again.

Both were the same mistake: the registry inferred something from data the
attacker controls. It now infers nothing. The relayer names the emitter and the
log index and the registry only checks, which closed the class rather than the
two instances, made batch pledges work, and dropped mainnet gas from 716k to
634k. `test_aDecoyWithTheSameSignatureChangesNothing` and
`test_anUnrelatedAllowlistedLogDoesNotSuppressAPledge` keep both attacks as regressions.

**"You verified the contracts after the fact. Was the demo recorded against the
fixed code?"**

Yes. The live registry `0xcccE8847...` was deployed after both fixes and all
fifteen proofs were replayed onto it. Every previous instance is left on chain
and named in the verification log with the reason it was superseded, rather than
quietly removed. There are several, because each measurement that changed the
contract got its own deployment rather than a claim.

---

## The business judge

**"MonetaGo already does this and is profitable. Why has a permissioned registry
not simply won?"**

It has won, inside the perimeter it can reach. MonetaGo works because banks
agreed to a common operator over Swift, and it stops at the edge of that
agreement. The reason to rebuild it here is that on-chain lenders will not agree
on an operator and do not need to: the witness is a precompile checking a proof,
so two protocols that refuse to speak to each other still share a register.

**"Non-custodial RWA lending on chain is small today. What is the market
actually?"**

Smaller than small, and the honest answer concedes it before being pushed.

Both protocols read here take custody, which was checked on chain rather than
assumed: a live Blend `borrow` moves the token to Blend, and NFTfi's loan terms
name an escrow. Custody makes the fraud impossible, so those six proofs
demonstrate the reader and not the problem. On chain, possession costs one
transfer, so escrow is the default and non-custodial lending against tokenised
collateral is mostly a market that has not been built.

For unique collateral the market is not thin, it is empty, and two independent
searches agreed on why. The one protocol that ever shipped in-wallet
encumbrance financed a single loan on mainnet, in June 2023, and its frontend no
longer resolves. The lockable token standards have two live implementations
between them and no lender using either, because the lock has to be written into
the collateral contract at deploy time, so none of them can ever apply to a
token that already exists. Everything marketed as non-custodial moves the asset
into a smart wallet the protocol co-signs.

That is the interesting part rather than the embarrassing one. **Lenders take
possession because there is no register to check.** A lender who cannot see
whether somebody already lent against this collateral has exactly one safe move,
which is to hold it. So the empty market is what a missing register produces,
and a register is the piece that has to exist before the market can. That is an
argument rather than a proof, and it is offered as one.

The measurable size is in off-chain invoices, where possession is impossible and
duplicate financing is a live loss category, and where the canonical key is the
hard problem. That is caveat 8, roadmap rather than projection. A submission
claiming a trillion dollars was arriving would be easier to present and worse to
trust.

Where the shape does exist today is fungible collateral, and the honest version
is narrower than the one this file gave until 2026-08-21. Aave does **not** leave
the collateral in the borrower's wallet: supplying moves the underlying out and
mints a receipt token back, which is on chain in
`0x7cd6a3537c4d302bb3013ef631f9068dfb600058e1ad7890aaedad583e7950cf`. What is
true is that the **borrow** moves nothing, in
`0x1dcf21883efc829c745f29d6081b189c448737feaef086dfbb4f09917f53a68b`, and the
lien is a registry entry rather than a per asset escrow. Their key is
`(reserve, account)` and this registry is built on `(chainKey, token, tokenId)`
for one unique asset, so reading them would need a different registry or a
dishonest key. Named rather than bolted on. Caveat 6 carries the correction and
how it was found.

**"Who runs it, and who pays for it?"**

Nobody runs it in the sense that matters: it holds no funds, has no operator
revenue, and its only privileged action is the allowlist. Gas is paid by
whoever wants a fact on file. A production version would fund itself the way
registries do, by charging for filing rather than for reading, and reading is
what has to stay free for the priority rule to work.

---

## The objections, ranked by how likely they are to land

| Objection | Likely | How it is answered |
|---|---|---|
| The adapter and allowlist reintroduce a trusted party | High | Bounded: proof decides existence, adapter decides meaning. Caveat 9, written first. |
| Both demo lenders are yours, so the collision is staged | High | True, and conceded first. Six of the fifteen proofs read NFTfi and Blur Blend on mainnet, which shows the reader works on protocols that never heard of us. Both of those escrow, so they cannot show the collision. The collision is ours because the non-custodial market is thin, and caveat 6 says so. |
| A positive record prevents nothing | High | Said first, on the landing page and in the demo. UCC-9 has governed on exactly that basis for fifty years. |
| An indexer could do this off chain | Medium | It could, and then the register is a company. The point is the witness being a precompile. |
| Adoption requires lenders to publish their book | Medium | Filing buys priority. That is the whole incentive UCC-9 runs on. |
| Two precompiles is not deep platform use | Medium | Three now, and answered by [SURFACES.md](SURFACES.md) rather than by argument. The fourth was tested and refused with the measurement that refused it. |
| The attestor floor is a halt switch in the administrator's hand | Medium | True, and it is caveat 10 rather than a footnote. Bounded two ways: the floor gates entry and never exit, tested, so no attestor rotation strands what is already on file; and zero is refused, so a chain with no floor stated records nothing rather than everything. The confirmation depth is the dial that does reach the exits, which is caveat 9 rather than this row. |
| You are one deregistration from breaking your own mainnet demo | Low but fair | Two, not one: the guard refuses below the floor and not at it, so four bonded against a floor of three survives the first departure and stops on the second. That correction went the wrong way for a while, overstating our own exposure, which is worth saying because the usual drift runs the other direction. The floor was not lowered to two to make any of it go away, because three is the smallest set in which no single attestor is a majority, and `provision.mjs --check` prints how many departures it would take. |
| Your headline gas number was explained wrongly | Low | It was, and we found it and said so before anyone asked. The 37.5 percent is real; the reason was the per call code size charge, not the shared continuity proof. The correction is in the README, the deck and [VERIFICATION.md](VERIFICATION.md). |
| Testnet only | Low | Six proofs read Ethereum mainnet. The registry is on testnet because that is where the faucet is. |

## The quorum questions, asked the hostile way

**"Which number is `Security.attestors`, and why is it the one that was never
involved?"** The sharpest question anyone has asked about this project, from a
Creditcoin engineer on the 2026-08-29 panel, and it lands. The stored number is
the set bonded when the record was **filed**, not the set that stood behind the
attestation of the source block. For the NFTfi loan this submission headlines,
those are 4 and 3 respectively, and the difference is reproducible with two
archive calls. `AttestorStash` exposes nothing that takes a height, so the
attesting-time count cannot be read from inside a transaction at all; it is
reachable only from outside, which is how the history table in
[VERIFICATION.md](VERIFICATION.md) was built. The floor half of the reading is
sound and stays, because admission control should be gated on today's set. The
wording was wrong in four places and is now caveat 11, with the worked case.


**"Recording a number nobody checks is theatre."** It is checked. The same read
that stores the count enforces a floor against it, and the floor has refused a
real proof on the live chain: `QuorumTooThin(1, 7, 8)` in `0xe19625fe...`,
status 0, on a verified contract so the error decodes. The register also exposes
the count publicly, so a lending protocol reading it can apply a stricter
standard than ours without asking us to change anything.

**"The attestor set never changes, so this solves nothing."** It changes. The
precompile answers at historical heights and the whole readable history is in
[VERIFICATION.md](VERIFICATION.md): Sepolia went 0 to 1 to 6 to 7 between
2026-05-01 and 2026-07-09, Ethereum 0 to 1 to 3 to 4 in the same window. This
was checked because the premise was load bearing, not because anyone asked.

**"Creditcoin already tells you which chains are attested."** It tells you which
are supported, which is not the same thing. On block 4,858,940
`get_supported_chains` reported Ethereum and `getAttestorsCount(3)` reported
zero. Every other part of this project uses that list to decide what is
readable, so this is the gap the floor closes.

**"A high count does not mean the attestors are honest."** No, and caveat 10
says exactly that in its last paragraph. The floor measures how much security is
standing, never whether it is truthful. If the set is compromised rather than
merely small, the count reads high and the proofs are worthless, and nothing a
contract on this chain can read would say otherwise.

## What a second hostile panel asked, 2026-08-29

Five personas, thirty-nine questions, every answer then checked by an agent told
to refute it. The finding that mattered has its own caveat. These four had no
answer written anywhere, and the honest ones are short.

**"What happens to an attestor who signs a false header?"** Nothing this project
can point at. `AttestorStash` exposes a minimum bond requirement, and the word
"slash" does not appear anywhere in this repository or in anything found on the
chain about that pallet. So the bond is a cost of entry and a sybil price, not a
stake at risk, and the floor in this registry counts how many are standing rather
than how much any of them would lose by lying. Caveat 10 already said the floor
measures security standing and never honesty; this is the same limit stated at
the level of one attestor. A registry that wanted a real economic guarantee here
would have to name the slashing condition it depends on, and there is none to
name.

**"The admin is one EOA and there is no way to rotate it."** True, and stronger
than a grep: the deployed runtime at `0xcccE8847a63f6fD460FA86CDaE8a05bAe102e0F7`
contains no `setAdmin`, `transferAdmin`, `acceptAdmin`, `transferOwnership` or
`renounceOwnership` selector, so rotation is impossible on this instance rather
than merely unwritten. What that does and does not mean is worth being precise
about, because the tempting concession is wrong. Every write path is
permissionless: pledges, batches, collisions, settlements and releases carry no
`onlyAdmin`. Both live chains are already configured. So a lost key freezes
configuration, not the register: no new emitter, no new chain, no change of depth
or floor, while filings and reads carry on. A **compromised** key is the serious
case, and caveat 9 is where it lives, because the adapter is the reach that
matters, not the setters.

**"Who consumes this on-chain?"** Nobody, today, and the design says so out loud:
the two demo lenders agree only on the shape of the log they emit, and neither
imports the registry. `getStatus` is called by tests, by the relay in Node and by
the web page in the browser, and by no contract in `src/`. That is the honest
state of a first-to-file register whose first job is to be readable. The demo is
built around the gap rather than around hiding it: Meridian's second draw
completes on the source chain and is refused here, which is exactly what "nobody
checks before lending" looks like.

**"Where do junior liens go?"** Nowhere. `_recordPledge` refuses anything that is
not `FREE`, on one shared write path, so the model is one asset one lien and a
second claim is a collision by construction. The words senior, junior,
subordinated and intercreditor appear nowhere in this repository, which is
accurate rather than an oversight: ranked claims need a priority ordering and a
consent rule, and this register has neither. Filing order is recorded, so the
data a ranking would need is there, but nothing reads it that way and no document
should suggest otherwise.

## What this changed in the pitch

- The unused-surface question needed a document, not a sentence. It got one.
- The adapter objection is the one to raise unprompted, because answering it
  after it is asked reads as damage control and answering it first reads as
  having thought about it.
- The market answer had to stop reaching for the trillion dollar number and
  name the small measurable one instead.
