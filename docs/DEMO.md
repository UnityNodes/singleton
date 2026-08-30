# Demo, a hundred and thirteen seconds

One asset, two lenders, a refusal anybody can open. Then the same registry
pointed at two protocols on Ethereum mainnet that never heard of it.

Everything below is read only. There is no wallet, no connect button and no
backend, so a judge who arrives with nothing can follow every step. That is not
a demo mode: it is the product, because a register that had to be trusted with
keys would not be neutral.

**Live**: <https://singleton.unitynodes.com>
**Registry**: `0xcD9017e3C541cAF973987E23e02694111C25032C` on CC3 testnet, verified
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

`script/record-demo.mjs` needs a browser, which is not a dependency of this
repository and should not become one: it is needed to re-record the video, not to
build, test or verify anything.

```bash
PLAYWRIGHT=/path/to/node_modules/playwright-core node script/record-demo.mjs
ELEVENLABS_API_KEY=... node script/build-narration.mjs
```

Without the `PLAYWRIGHT` variable the recorder resolves `playwright-core`
normally and says so plainly if it is missing. It used to import an absolute
path into a different project on one machine, so the recorder could not run on
a clone at all. The narration step needs only the ElevenLabs key; everything it
places is timed off the recording the first command just made.

Timecodes below are read off frames of the recording, not off this plan. Change
`script/record-demo.mjs` and every number here and in the chapter list on
`/demo` has to be checked again.

| # | Time | On screen | Spoken |
|---|---|---|---|
| 1 | 0:00 to 0:12 | Landing hero, the coil turning | "A borrower pledges one tokenised deed and takes a loan." |
| 2 | 0:12 to 0:20 | Scroll to the collision band, hold on 01 and 02 | "An hour later they pledge the same deed to a second lender." |
| 3 | 0:20 to 0:28 | Hold on 02, cursor still | "Neither contract can read the other's logs. So both lend." |
| 4 | 0:28 to 0:37 | Open the register, Demo deed 43, claimed, refusal on file | "Singleton watched from outside. First to file is on record." |
| 5 | 0:37 to 0:54 | The red panel, then the failed transaction on Blockscout | "The second pledge was refused on chain. Open the failure yourself." |
| 6 | 0:54 to 1:09 | The chain of custody, the attestor line inside the inclusion proof | "Each record keeps the attestor set that stood behind it. Seven, bonded." then "Raise the floor above the live set and it refuses: QuorumTooThin, 0x9ecf965f." |
| 7 | 1:09 to 1:33 | The other deed opened, five entries from pledge to re-pledge | "Settled, released, then the loser re-files legitimately. Five proofs, one asset." |
| 8 | 1:33 to 1:44 | Rail, NFTfi collateral 7819 and two Pudgy Penguins | "Real NFTfi and Blur Blend loans on Ethereum mainnet, read unmodified." |
| 9 | 1:44 to 1:53 | The green free panel, hold on the last sentence | "A positive record and a priority rule. Never proof of absence." |

Total 1:53. Step 5 is the moment; it lands at 33 percent of the runtime.

Step 6 is the only one whose second caption is not on the screen it plays over.
The attestor line is, and the refusal it names is a transaction anybody can
open, which is why the hash is in the caption rather than a claim without one.

The chapter marks on `/demo` are not the same numbers. A chapter begins where its
narration does, but seeking there can land on a register that is still reading
the chain, and a viewer who clicks a chapter wants the answer rather than the
wait. So each mark sits a few seconds inside its step, on settled content, and
every one of them was checked against a frame.

The recording is reproducible: `node script/record-demo.mjs` drives the live
site, burns the narration in as captions, and writes the raw webm, the silent
mp4 served from `/demo`, and a timeline of when each caption appeared. That was
not true until 2026-08-29. The script stopped at the webm and the mp4 was
encoded by hand, so "reproducible" was a claim about a step nobody had written
down. The ffmpeg call is now the last thing the script does, and it fails loudly
rather than leaving a webm somebody has to guess at.

A second script, `script/build-narration.mjs`, reads that timeline and speaks
each caption with ElevenLabs, placed at the second it appeared rather than read
straight through, then muxes the result onto the video without re-encoding the
picture. The captions stay: a viewer who scrubs muted, or pauses on a hash,
reads the same line the voice says. Splitting the two scripts means a caption
wording change re-records video and voice together, correctly, while a voice-only
change (a different voice, different phrasing of a spoken line) never touches the
picture.

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
