# Platform surfaces, used and refused

Depth of Attestcoin Protocol use is the one scoring criterion the organisers
have published. So this is the full surface, with a reason next to every line
that is not in use. An unused surface without a reason is an oversight, not a
decision.

Everything below was confirmed by calling CC3 testnet directly, or by reading a
contract's own ABI off Blockscout. That is deliberate rather than fussy: the
docs page that lists precompiles omits BlockProver and ChainInfo entirely, and
research into this that leaned on repository paths turned out to be citing files
nobody had opened. Where a figure below has no call behind it, it is not here.

The six Creditcoin specific precompiles all carry code; `0x0FD5` and `0x13BB`
are empty, so the set does not simply continue. Whether anything else is
registered at an address not probed here is not claimed either way.

## In use

| Surface | Address | How it is used |
|---|---|---|
| BlockProver | `0x0FD2` | Both forms of `verify` in view: one transaction for a single pledge, an array against one shared continuity proof for a batch. Plus `calculateTxIndex` for the replay nullifier |
| ChainInfo | `0x0fD3` | `get_latest_attestation_height_and_hash` on chain for the finality guard, `get_supported_chains` off chain to resolve a chain key from a chain id |
| AttestorStash | `0x0FD4` | `getAttestorsCount` and `getMinBondRequirement` read inside the transaction that accepts a proof. Both numbers are stored with the lien and with every refusal, and a chain whose set has fallen below a stated floor stops producing records |
| EvmV1Decoder | `0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f` | Receipt and log decoding, as a linked library rather than a copy |
| `@gluwa/usc-sdk` 0.18.0 | | `ProofBuilder.getProof` in the relay |
| Attested source chains | keys 1 and 3 | Sepolia and Ethereum mainnet, which `get_supported_chains` reports as the whole list |

The last row is worth stating precisely, because it sounds smaller than it is.
Creditcoin attests exactly two chains on CC3 testnet and one on mainnet. Both of
the two are read here, six proofs against each. This is not a subset.

One thing about the batch form that is in no document, because it was found by
calling the precompile rather than by reading. The shared continuity proof is
anchored at the lowest header the prover built it from, so a batch that does not
contain a transaction at that header is refused outright with a continuity
mismatch. And the batch does check every member: a corrupted transaction, a
forged merkle root or a misstated height inside an otherwise honest batch each
revert it. Both were established by deliberately breaking a real batch against
CC3, which is the only way to know that a verification verifies.

Two requirements the documentation puts in a danger block, both met:

- **BlockProver does not check whether the source transaction succeeded.** The
  registry checks `receiptStatus == 1` itself, and `test_reverted...` in
  `test/SingletonRegistry.t.sol` fails the build if that check is removed.
- **Replay protection.** A nullifier per operation domain, keyed by chain,
  height, transaction index and log index, so the same proof cannot be spent
  twice and reporting a collision does not consume the proof that would register
  the same lien legitimately later.

## Refused, with the reason

| Surface | Address | Why not |
|---|---|---|
| SubstrateTransfer | `0x0FD1` | Moves CTC from the EVM ledger to a Substrate account, one way. A register holds no funds and moves none. |
| Sr25519Verifier | `0x13B9` | Substrate-keyed signatures. Nothing here is signed by a borrower; the evidence is an inclusion proof. |
| Ed25519Verifier | `0x13BA` | Same. |
| CTC staking, nomination pools | | Not reachable from Solidity at all. There is no staking precompile; this is a property of the chain, not a choice. |
| The legacy Creditcoin loan pallets | | Not in the CC3 runtime. They run on a separate Substrate chain with no EVM and no attestation registration, so no contract can reach them. |
| Attestcoin writability, the outbound direction | | Not shipped. The docs say it is in third party testing. A register only needs to read. |
| Ecosystem tooling: the DEX, the bridge, the wallet | | This hackathon has no sponsor bounties. Touching any of them would be decoration, and a register that swapped tokens would be a worse register. |
| `QueryBuilder` byte offsets | | An alternative to structural decoding, cheaper in gas. The deployed decoder already does the job, and using both would be two ways of reading the same bytes. |
| `PrecompileBlockProver`, `PrecompileChainInfoProvider` | | Typed off-chain wrappers. Verification happens inside the contract here, which is the stronger position; verifying off chain and trusting the result is the thing this project exists to avoid. |

## What the attestor set is for

A cross chain record inherits the security of the set that attested the block it
was read from. That set is not a constant. Creditcoin bonds seven attestors for
Sepolia and four for Ethereum as this is written, a hundred CTC each, and those
numbers are readable by any contract on the chain.

Nothing that consumes an attestation writes them down. A record made while seven
attestors stood behind it and a record made while two did are stored identically
by every bridge, oracle and message layer, so the question "how much was standing
behind this when it was written" has no answer after the fact. The registry
answers it: `Record.security` and `Collision.security` carry the count, the bond
and the attested tip that were true at the moment the proof was accepted, and
`AttestationWitnessed` puts the same three numbers in the log, which survives the
lien being released and its record deleted.

The floor is the enforcing half. `setMinAttestors` states the smallest set a
chain may have before this registry will create a record from anything read out
of it, and zero is refused for the same reason a confirmation depth of zero is.
Three is used on both live chains: below three, a single attestor is a majority
of the set. The floor gates entry only. A settlement or a release still goes
through under a collapsed set, because trapping a borrower's asset over an
attestor rotation they had no part in would be a worse failure than the one the
floor exists to prevent.

An unattested chain key answers zero attestors rather than reverting, verified
live, so the floor doubles as the refusal to read a chain Creditcoin does not
attest at all.

## Refused after measuring, not before

**`is_height_attested`.** It exists and it works. It is also, on both live
chains, exactly the comparison the finality guard already makes. Measured at CC3
block 5343128 against chain key 1, attested tip 11529470: true at 11529469 and
at 11529470, false at 11529471 and above, and true at every height sampled below
it down to zero, with no gaps. `get_attestation_genesis_height` returns 0 for
both chains, so there is no lower bound to fall outside of either. Calling it
would spend a staticcall to be told what `height <= tip` already says. It is
listed here rather than in the table above because the reason it is unused is a
measurement, not an assumption.

There is no `get_attestation_bounds`. An earlier draft of this document named
one; the selector returns "Unknown selector" on CC3 testnet, and the claim has
been removed rather than softened.

**`get_latest_checkpoint_height_and_hash`.** A separate marker that trails the
attested tip: at CC3 block 5343190, chain key 1 reported an attestation at
11529540 and a checkpoint at 11529400, chain key 3 an attestation at 25796830
and a checkpoint at 25796700. Both checkpoint results carry `isAttestation`
false. The registry gates on the attested tip because a height it accepts has to
be one the attestor set stood behind, and that is the flag the checkpoint result
clears.
