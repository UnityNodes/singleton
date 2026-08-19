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

Nothing forces it, and nothing forces a UCC-9 filing either. What makes lenders
file there is that an unfiled lien loses to a filed one. The register is the
same trade: publish the fact of the lien and get priority over anybody who did
not. A lender who values secrecy over priority is free to keep both risks.

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

The sharpest objection here, and the answer is a boundary rather than a denial.
The BlockProver decides whether a log is real; the adapter decides what a real
log means. So an adapter cannot fabricate a pledge that never happened, and it
can misread one that did. That is caveat 9 and it is named as a semi-trusted
layer in the repository, not discovered in the demo. The difference from an
indexer is the size of what is trusted: an indexer is trusted for existence,
which is unbounded, and an adapter is trusted for interpretation of something
already proven to exist, which is auditable in about eighty lines.

**"The allowlist is admin-controlled. Worst case if that key is compromised?"**

An attacker can exclude honest protocols and admit their own contract as an
emitter, so they can occupy keys and censor. They cannot forge an inclusion
proof, cannot make the precompile accept a log that was not mined, and cannot
take an asset. The registry holds no funds. The certificate is soulbound and
worth nothing to a thief.

**"A High severity bug was found on 2026-08-19. What else is unfound?"**

Unknown, which is the only honest answer. What can be said is what changed: the
bug was that logs were counted across the whole receipt rather than the chosen
emitter's, so a borrower could poison their own pledge and make it
unregisterable. It is fixed, it has seven regression tests, and the fix was
verified by removing it again and watching the tests fail. The review that
found it, and the mutation testing that exposed an untested guard, are in the
repository rather than summarised.

**"You verified the contracts after the fact. Was the demo recorded against the
fixed code?"**

Yes. The live registry `0x020a11bC...` was deployed after the fix and all twelve
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

Small today and named as such. The measurable part is NFT-collateralised lending,
where NFTfi and Blend are read live in this submission. The claim being made is
about the primitive, not about a trillion dollars arriving next quarter: the
canonical key is free for on-chain RWA and expensive for off-chain invoices, and
the invoice market is where the size is. That is caveat 8 and it is written as
roadmap, not as a projection.

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
| Both demo lenders are yours, so the collision is staged | High | Six of the twelve proofs read NFTfi and Blur Blend on Ethereum mainnet, unmodified, unaware, nothing deployed there. |
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
