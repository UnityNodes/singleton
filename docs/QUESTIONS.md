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

**"You use two precompiles and attest two chains. What else does the platform
expose, and why did you not touch it?"**

The hardest question on the sheet, because the usual reading of depth is
breadth. BlockProver and ChainInfo are the two surfaces a witness needs:
one proves a log was included, the other says how far the attestation has
reached. Every other surface is listed with a stated reason in
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
`test/AdminPower.t.sol` performs that attack rather than asserting it cannot
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
634k. `test/Suppression.t.sol` keeps both attacks as regressions.

**"You verified the contracts after the fact. Was the demo recorded against the
fixed code?"**

Yes. The live registry `0x7F4A466E...` was deployed after both fixes and all twelve
proofs were replayed onto it. The previous instance is left on chain and named
in the verification log as predating the fix, rather than quietly removed.

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

Where the shape does exist today is fungible collateral: Aave and Euler both
leave it in the borrower's wallet and record the lien in a registry. Checked
rather than assumed, in Aave's Sepolia borrow `0x7c82d123...` every transfer is
inbound to the borrower. Their key is `(reserve, account)` and this registry is
built on `(chainKey, token, tokenId)` for one unique asset, so reading them would
need a different registry or a dishonest key. Named rather than bolted on.

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
| Two precompiles is not deep platform use | Medium | Answered by [SURFACES.md](SURFACES.md), not by argument. |
| Testnet only | Low | Six proofs read Ethereum mainnet. The registry is on testnet because that is where the faucet is. |

## What this changed in the pitch

- The unused-surface question needed a document, not a sentence. It got one.
- The adapter objection is the one to raise unprompted, because answering it
  after it is asked reads as damage control and answering it first reads as
  having thought about it.
- The market answer had to stop reaching for the trillion dollar number and
  name the small measurable one instead.
