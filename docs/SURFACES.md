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
| AttestorStash | `0x0FD4` | Reads the attestor set and its bonding. Named below as the strongest thing not built, rather than dismissed. |
| CTC staking, nomination pools | | Not reachable from Solidity at all. There is no staking precompile; this is a property of the chain, not a choice. |
| The legacy Creditcoin loan pallets | | Not in the CC3 runtime. They run on a separate Substrate chain with no EVM and no attestation registration, so no contract can reach them. |
| Attestcoin writability, the outbound direction | | Not shipped. The docs say it is in third party testing. A register only needs to read. |
| Ecosystem tooling: the DEX, the bridge, the wallet | | This hackathon has no sponsor bounties. Touching any of them would be decoration, and a register that swapped tokens would be a worse register. |
| `QueryBuilder` byte offsets | | An alternative to structural decoding, cheaper in gas. The deployed decoder already does the job, and using both would be two ways of reading the same bytes. |
| `PrecompileBlockProver`, `PrecompileChainInfoProvider` | | Typed off-chain wrappers. Verification happens inside the contract here, which is the stronger position; verifying off chain and trusting the result is the thing this project exists to avoid. |

## Not built, and worth naming

Two surfaces have a real argument and are absent. Saying so is cheaper than
being asked.

**`is_height_attested` and `get_attestation_bounds`.** The finality guard infers
from the tip. These two would let the registry state precisely which attested
interval a witnessed pledge falls inside, and record it with the lien.

**`is_height_attested` and `get_attestation_bounds`.** The finality guard infers
from the tip. These two would let the registry state precisely which attested
interval a witnessed pledge falls inside, and record it with the lien.

**AttestorStash.** `getAttestorsCount` and `getMinBondRequirement` would let the
registry read, at witness time, how much economic security stood behind the
attestation it just believed, and refuse below a floor. For a register whose
whole claim is that its record is only as good as the quorum behind it, that is
the most substantive unused surface on the chain.

Called on CC3 testnet while writing this: `getAttestorsCount(1)` is 7,
`getAttestorsCount(3)` is 4, and `getMinBondRequirement` is 100 CTC on both. So
the twelve proofs this submission rests on were attested by four and seven
bonded attestors respectively, and the registry currently records none of that.

`is_height_attested(1, 11510076)` returns true for the block the first pledge
came from, which is the one call that would replace an inference with an answer.
