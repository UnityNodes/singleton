# Demo, a hundred and five seconds

One asset, two lenders, a refusal anybody can open. Then the same registry
pointed at two protocols on Ethereum mainnet that never heard of it.

Everything below is read only. There is no wallet, no connect button and no
backend, so a judge who arrives with nothing can follow every step. That is not
a demo mode: it is the product, because a register that had to be trusted with
keys would not be neutral.

**Live**: <https://singleton.unitynodes.com>
**Registry**: `0xB537A4A267D5DB4AdA30722aeC04b3D4898A95e1` on CC3 testnet, verified
**Evidence**: fifteen inclusion proofs, every hash in [VERIFICATION.md](VERIFICATION.md)

---

## The arc

A borrower pledges one tokenised deed to Harbor Credit and gets a loan. Nothing
stops them pledging the same deed to Meridian Credit an hour later, because the
two contracts share no code, no storage and no knowledge of each other, and an
EVM contract cannot read another contract's logs. Singleton witnesses both
pledges from the outside, through an inclusion proof re-checked by Creditcoin's
BlockProver precompile, and refuses the second. Then the same registry, with the
same code, reads real loans from NFTfi and Blur Blend on Ethereum mainnet, with
nothing deployed there and nothing asked of either protocol.

## The flow

Timecodes below are read off frames of the recording, not off this plan. Change
`script/record-demo.mjs` and every number here and in the chapter list on
`/demo` has to be checked again.

| # | Time | On screen | Spoken |
|---|---|---|---|
| 1 | 0:05 to 0:11 | Landing hero, the coil turning | "A borrower pledges one tokenised deed and takes a loan." |
| 2 | 0:11 to 0:19 | Scroll to the collision band, hold on 01 and 02 | "An hour later they pledge the same deed to a second lender." |
| 3 | 0:19 to 0:28 | Hold on 02, cursor still | "Neither contract can read the other's logs. So both lend." |
| 4 | 0:28 to 0:38 | Open the register, Demo deed 43, claimed, refusal on file | "Singleton watched from outside. First to file is on record." |
| 5 | 0:38 to 0:55 | The red panel, then the failed transaction on Blockscout | "The second pledge was refused on chain. Open the failure yourself." |
| 6 | 0:55 to 1:12 | The chain of custody, the attestor line inside the inclusion proof | "Each record keeps the attestor set that stood behind it. Seven, bonded." then "Raise the floor above the live set and it refuses: QuorumTooThin, 0xaecd340d." |
| 7 | 1:12 to 1:25 | The other deed opened, five entries from pledge to re-pledge | "Settled, released, then the loser re-files legitimately. Four proofs." |
| 8 | 1:25 to 1:36 | Rail, NFTfi collateral 7819 and two Pudgy Penguins | "Real NFTfi and Blur Blend loans on Ethereum mainnet, read unmodified." |
| 9 | 1:36 to 1:45 | The green free panel, hold on the last sentence | "A positive record and a priority rule. Never proof of absence." |

Total 1:45. Step 5 is the moment; it lands at 36 percent of the runtime.

Step 6 is the only one whose second caption is not on the screen it plays over.
The attestor line is, and the refusal it names is a transaction anybody can
open, which is why the hash is in the caption rather than a claim without one.

The chapter marks on `/demo` are not the same numbers. A chapter begins where its
narration does, but seeking there can land on a register that is still reading
the chain, and a viewer who clicks a chapter wants the answer rather than the
wait. So each mark sits a few seconds inside its step, on settled content, and
every one of them was checked against a frame.

The recording is reproducible: `node script/record-demo.mjs` drives the live
site, burns the narration in as captions and writes a webm, and the encode line
in that file turns it into the mp4 served from `/demo`. Captions rather than a
voice track, because a judge reviewing dozens of entries watches muted, and a
caption can be paused on a hash.

## Staging the refusal

**Setup.** Say nothing for the second it takes the register to answer. The state
chip turning amber does the work.

**Action.** Click the refusal hash in the red panel. Blockscout opens a
transaction that failed to call `registerPledge` on `SingletonRegistry`, and
`Show revert reason` decodes it into `AssetNotFree(bytes32 assetKey, address
incumbent)`, carrying the asset key and the address of the lender who filed
first. The registry and both adapters are verified there, which is what turns
that click into an answer rather than a blob of hex.

**Pause.** Three seconds on the failed transaction, cursor still.

**What the audience sees.** A real transaction that failed on purpose, on a
public explorer, with the asset key and the incumbent lender in the revert data.

**Spoken reveal.** "That is not a screenshot. It is a refusal in a block."

The reason to click through rather than describe it: every entry in this
category shows a green checkmark. A deliberate on-chain failure that anybody can
open is the one screen a judge cannot mistake for a mock.

## Transitions

| From | To | Cue |
|---|---|---|
| 1 | 2 | "Now the same deed, an hour later." |
| 3 | 4 | "Nobody integrated anything. Watch who noticed." |
| 5 | 6 | "A lien ends more than one way, so the register carries all of them." |
| 6 | 7 | "Those two lenders are ours, which is a fair objection." |
| 7 | 8 | "Before anybody asks what this does not do." |

## What to say first, unprompted

Four pre-emptions, in this order, before questions:

**MonetaGo proves the market.** It is a permissioned registry of banks over
Swift. Same job, without a trusted operator: the witness here is a precompile
proof, not a company.

**This is a positive record.** An asset the register calls free is one nobody
registered here, which is not one nobody pledged. Attestcoin proves a
transaction happened, never that one did not. UCC-9 has governed a trillion
dollar lien market on exactly that basis for fifty years.

**Custody and collision are in tension.** A protocol that escrows the collateral
prevents this fraud mechanically. The market is non-custodial liens, and that is
a location, not a narrowing.

**The allowlist is semi-trusted.** It governs which logs are read, never whether
they are true. An administrator can exclude a protocol; no administrator can
fabricate a pledge.

## Rehearsal checklist

- Browser notifications off, at the operating system and in the browser
- One window, no tabs but the site and the explorer, no bookmarks bar
- Zoom at 100 percent, viewport at least 1440 wide, dark ambient light
- `node worker/provision.mjs --check` says the configuration matches the plan
- The register answers in under two seconds on the demo network, tested twice
- The explorer tab preloaded on the refusal transaction, so the click is instant
- Run the whole path twice end to end before recording or presenting
- Fallback recording on disk, in case the CC3 public RPC is slow on the day

## If the network is slow

Say what is happening rather than waiting silently: every number on the page is
an `eth_call` against one Creditcoin node, and saying so out loud is the point
being made. If the node does not answer, the page says so honestly and that is
the designed failure for a tool with no backend. Switch to the fallback
recording and keep the narration identical.
