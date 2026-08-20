#!/usr/bin/env python3
"""Writes deck/pitch.html with the brand fonts and one screenshot inlined.

Inlined rather than linked because the renderer loads this over a throwaway
local server and a missing font would silently fall back to a system face, which
is the one thing the wordmark cannot survive.
"""
import io, sys
sys.path.insert(0, "/tmp/rec")
from assets import ASSETS

SLIDES = []

def slide(inner):
    SLIDES.append(f'<section class="slide slide-accent"><div class="slide-inner">{inner}</div></section>')

slide('''
<div class="title-block">
  <h1 class="display xl">one asset,<br>one lien.</h1>
  <p class="lede">A neutral first to file lien registry on Creditcoin. It witnesses pledges
  from lending protocols that never integrated with it, and refuses the second claim on the
  same collateral.</p>
  <div class="chips">
    <span>BUIDL CTC 2026 &middot; RWA</span>
    <span>singleton.unitynodes.com</span>
    <span>0x25b0963E &middot; CC3 testnet, verified</span>
  </div>
</div>''')

slide('''
<h2 class="display">A borrower pledges one deed twice, and nobody notices.</h2>
<div class="cols3">
  <div><div class="num">01</div><b>Harbor lends</b><p>1,000 against a tokenised deed. Non custodial, so the borrower keeps the token.</p></div>
  <div><div class="num">02</div><b>Meridian lends</b><p>750 against the same deed, an hour later. A different contract, no shared code or storage.</p></div>
  <div class="hot"><div class="num">03</div><b>Both are live</b><p>Neither protocol can see the other's record. The collateral is now promised twice.</p></div>
</div>
<p class="foot-note">Custody prevents this mechanically. Everywhere custody is absent, it is live and unaddressed.</p>''')

slide('''
<h2 class="display">A contract cannot read a log. Not even its own.</h2>
<div class="two">
  <div>
    <p class="body"><code>LOG0</code> through <code>LOG4</code> are write only. Receipts live in a trie
    execution never touches. <code>BLOCKHASH</code> reaches back 256 blocks.</p>
    <p class="body">So a neutral witness of somebody else's lending is either an off chain indexer,
    which is a trusted party and therefore not neutral, or a contract that consumes an inclusion
    proof of that log.</p>
  </div>
  <div class="claim">
    <b>The second exists on Creditcoin and nowhere else.</b>
    <p>BlockProver <code>0x0FD2</code> re-checks a merkle and continuity proof synchronously, inside
    the transaction that accepts the pledge.</p>
    <p class="muted">This is a property of the machine, not a positioning claim.</p>
  </div>
</div>''')

slide('''
<h2 class="display">Three steps, nobody trusted for any of them.</h2>
<ol class="steps">
  <li><b>The protocol's own log</b><p>A lender emits its native event. NFTfi and Blur Blend are read
  on Ethereum mainnet, unmodified and unaware. Nothing is deployed there and nothing is asked of them.</p></li>
  <li><b>BlockProver <code>0x0FD2</code></b><p>The precompile verifies the inclusion proof inside the
  accepting transaction, past a stated confirmation depth read from ChainInfo <code>0x0fD3</code>.
  The registry checks the source receipt status itself, because the precompile does not.</p></li>
  <li><b>The register</b><p>First to file is recorded and given a soulbound certificate.
  Anything second reverts. A nullifier per operation makes each proof spendable once.</p></li>
</ol>''')

slide(f'''
<h2 class="display">The refusal is a failed transaction anybody can open.</h2>
<img class="shot" src="data:image/png;base64,{ASSETS["SHOT"]}" alt="Blockscout showing a failed registerPledge call decoding to AssetNotFree">
<p class="foot-note">Blockscout, CC3 testnet. The registry is verified there, so the custom error decodes
into the asset key and the address of the lender who filed first.</p>''')

slide('''
<h2 class="display">Half the proofs read protocols that never heard of us.</h2>
<div class="two">
  <div class="claim">
    <b>NFTfi v3, loan 16928</b>
    <p>Taken at mainnet block 25,506,517, repaid at 25,717,460. Real borrower, real NFT, 0.07 WETH.</p>
    <b>Blur Blend, two liens</b>
    <p>One closed by repayment, one seized after a failed auction. A lien ends in more than one way and
    an adapter that knew only repayment would leave seized liens on file forever.</p>
  </div>
  <div>
    <p class="body">Creditcoin attests Ethereum, so an existing loan can simply be read. No mainnet
    deployment, no funds there, no cooperation from either protocol.</p>
    <p class="body"><b>And the part that does not flatter us.</b> Both of these escrow the collateral,
    which we checked on chain rather than assumed. So they prove the reader works and they cannot
    prove the fraud, because custody makes it impossible. The collision is on Sepolia, between two
    non-custodial lenders we wrote.</p>
  </div>
</div>''')

slide('''
<h2 class="display">Depth, stated as calls rather than as adjectives.</h2>
<div class="two">
  <div class="claim">
    <b>In use</b>
    <p>BlockProver <code>0x0FD2</code>, <b>both forms of verify</b>: one transaction for a single
    pledge, and an array against one shared continuity proof for a batch. ChainInfo <code>0x0fD3</code>
    for the attested tip and the chain key. The deployed <code>EvmV1Decoder</code>.</p>
    <p><b>Both</b> attested source chains: <code>get_supported_chains</code> reports two on CC3 testnet
    and both are read.</p>
    <p>The batch constraint is in no document. We found it by calling the precompile: the shared proof
    is anchored at its lowest header, and every member is still checked individually.</p>
  </div>
  <div>
    <b>Refused, with reasons</b>
    <p class="body">SubstrateTransfer moves CTC and a register holds none. The signature verifiers want
    Substrate keys and the evidence here is an inclusion proof. Staking and the legacy loan pallets are
    not reachable from Solidity at all. Writability is not shipped.</p>
    <b>Not built, and named</b>
    <p class="body">Batch verification, the ChainInfo bounds queries, and AttestorStash. The full list
    with reasons is in <code>docs/SURFACES.md</code>.</p>
  </div>
</div>''')

slide('''
<h2 class="display">Two independent reviews in one day. Both found real bugs.</h2>
<ol class="steps tight">
  <li><b>Receipt poisoning</b><p>A borrower could attach a decoy log carrying the registry's own event
  signature and make their genuine pledge permanently unregisterable.</p></li>
  <li><b>The same mistake, one door along</b><p>The fix scoped log counting to the chosen emitter, but the
  emitter was still inferred from the receipt, which the borrower orders. One log from any other allowlisted
  protocol suppressed the pledge again.</p></li>
  <li class="hot"><b>What changed</b><p>The relayer now names the emitter and the log index. The registry
  searches for nothing. A batch pledge became supported rather than refused, and mainnet gas fell from
  716k to 634k.</p></li>
</ol>
<p class="foot-note">Also corrected: a caveat claiming an administrator cannot fabricate, which was false,
and the vacuous test that backed it. 61 tests, every attack kept as a regression.</p>''')

slide('''
<h2 class="display">Said before anybody has to ask.</h2>
<div class="cols3">
  <div><b>A positive record</b><p>An asset the register calls free is one nobody registered here, not one
  nobody pledged. Attestcoin proves a transaction happened, never that one did not.</p></div>
  <div><b>The adapter is trusted</b><p>The proof decides whether a log exists; the adapter decides what it
  means. Bounded interpretation of a proven fact, in eighty lines of pure code, not unbounded trust in
  existence.</p></div>
  <div><b>The key is free here only</b><p><code>keccak(chainKey, token, tokenId)</code> names an on chain
  asset with no agreement between protocols. Off chain invoices are the larger market and the harder key.</p></div>
</div>
<p class="foot-note">And the one we would rather say than have found. For unique collateral the
non-custodial market is empty: the one protocol that shipped in-wallet encumbrance financed a single
loan, and no lender uses any lockable token standard. We think that is a consequence rather than an
objection. <b>Lenders take possession because there is no register to check</b>, so possession is the
fallback a missing register forces, which makes this the piece that has to exist first. That is an
argument and not a proof, which is why it sits on this slide.</p>''')

slide('''
<h2 class="display">Running, and checkable without asking us for anything.</h2>
<div class="stats">
  <div><span class="big">12</span><p>inclusion proofs on CC3 testnet, every hash published</p></div>
  <div><span class="big">2 / 2</span><p>attested source chains read, Sepolia and Ethereum mainnet</p></div>
  <div><span class="big">61</span><p>tests, including both reviews kept as regressions</p></div>
  <div><span class="big">0</span><p>wallets, backends and indexers between the page and the chain</p></div>
</div>
<div class="chips wide">
  <span>singleton.unitynodes.com</span>
  <span>/demo, 1:25, captioned</span>
  <span>github.com/UnityNodes/singleton</span>
  <span>0x25b0963E40536dF9519Da839cd7c36bc1A47bd8D</span>
</div>''')

CSS = f'''
@font-face {{ font-family: "Archivo W"; src: url(data:font/woff2;base64,{ASSETS["ARCHIVO_WDTH"]}) format("woff2-variations"); font-weight: 100 900; font-stretch: 62% 125%; }}
@font-face {{ font-family: "Archivo"; src: url(data:font/woff2;base64,{ASSETS["ARCHIVO_WGHT"]}) format("woff2-variations"); font-weight: 100 900; }}
@font-face {{ font-family: "JB Mono"; src: url(data:font/woff2;base64,{ASSETS["MONO"]}) format("woff2-variations"); font-weight: 100 800; }}

:root {{
  --ink: #151517; --surface: #1e1e21; --raised: #38383a; --line: #454548; --line2: #56565a;
  --paper: #fafafa; --paper2: #adadb2; --paper3: #85858b;
  --live: #e5b45e; --open: #58cf9b; --refused: #ef6a5c;
  --font-mono: "JB Mono", ui-monospace, monospace;
}}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: var(--ink); color: var(--paper); font-family: Archivo, system-ui, sans-serif; }}
.deck {{ }}
.slide {{ min-height: 1080px; display: flex; align-items: center; background: var(--ink); position: relative; overflow: hidden; }}
.slide::before {{ content: ""; position: absolute; inset: -20%; pointer-events: none;
  background: radial-gradient(34% 40% at 78% 6%, rgba(229,180,94,.10), transparent 70%),
              radial-gradient(38% 42% at 6% 88%, rgba(88,207,155,.08), transparent 70%); }}
.slide-inner {{ position: relative; width: 100%; }}
.display {{ font-family: "Archivo W", Archivo, sans-serif; font-variation-settings: "wdth" 112; font-weight: 700; letter-spacing: -.028em; line-height: .98; margin: 0; }}
h1.xl {{ font-size: 104px; }}
h2.display {{ font-size: 52px; max-width: 20ch; margin-bottom: 40px; }}
.title-block .lede {{ font-size: 22px; line-height: 1.5; color: var(--paper2); max-width: 62ch; margin: 34px 0 0; }}
.chips {{ display: flex; gap: 10px; flex-wrap: wrap; margin-top: 46px; }}
.chips span {{ border: 1px solid var(--line); padding: 9px 14px; font-family: var(--font-mono); font-size: 15px; color: var(--paper2); }}
.chips.wide {{ margin-top: 44px; }}
.cols3 {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 34px; }}
.cols3 > div {{ border-top: 1px solid var(--line); padding-top: 20px; }}
.cols3 .num {{ font-family: "Archivo W", sans-serif; font-variation-settings: "wdth" 112; font-weight: 700; font-size: 46px; color: var(--paper3); line-height: 1; margin-bottom: 14px; }}
.cols3 .hot .num {{ color: var(--refused); }}
.cols3 .hot b {{ color: var(--refused); }}
b {{ font-size: 22px; letter-spacing: -.015em; display: block; margin-bottom: 8px; }}
p {{ font-size: 18px; line-height: 1.5; color: var(--paper2); margin: 0 0 14px; }}
.two {{ display: grid; grid-template-columns: 1fr 1fr; gap: 52px; }}
.claim {{ border-left: 1px solid var(--line2); padding-left: 26px; }}
.body {{ font-size: 19px; }}
.muted {{ color: var(--paper3); font-size: 16px; }}
code {{ font-family: var(--font-mono); font-size: .88em; color: var(--paper); }}
.steps {{ list-style: none; margin: 0; padding: 0; counter-reset: s; }}
.steps li {{ counter-increment: s; border-top: 1px solid var(--line); padding: 22px 0 22px 78px; position: relative; }}
.steps.tight li {{ padding-top: 18px; padding-bottom: 18px; }}
.steps li:last-child {{ border-bottom: 1px solid var(--line); }}
.steps li::before {{ content: "0" counter(s); position: absolute; left: 0; top: 22px; font-family: var(--font-mono); font-size: 17px; color: var(--paper3); }}
.steps li.hot b {{ color: var(--open); }}
.shot {{ width: 100%; border: 1px solid var(--line); display: block; }}
.foot-note {{ margin-top: 26px; font-size: 16px; color: var(--paper3); max-width: 92ch; }}
.stats {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 30px; }}
.stats > div {{ border-top: 1px solid var(--line); padding-top: 20px; }}
.big {{ font-family: "Archivo W", sans-serif; font-variation-settings: "wdth" 112; font-weight: 700; font-size: 72px; line-height: 1; display: block; margin-bottom: 14px; }}
.stats p {{ font-size: 17px; }}
'''

html = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Singleton</title><style>{CSS}</style></head>
<body><div class="deck">{"".join(SLIDES)}</div></body></html>'''

io.open("deck/pitch.html", "w", encoding="utf-8").write(html)
print(f"wrote deck/pitch.html, {len(SLIDES)} slides, {len(html)//1024} KB")
