# The site

Live at **https://singleton.unitynodes.com**: the argument at `/`, the register
itself at `/register`, and the ninety second recording at `/demo`.

Three surfaces, one brand, deliberately different jobs.

The **landing** is where the argument is made: what the problem is, why it can
only be solved on Creditcoin, and the three real transactions that make the
collision. Order is the content there, because the product is a priority rule,
so the sequence is set in the display face rather than whispered in a caption.

The **register** is a tool somebody uses at work. Dense, fixed to the window
with no page scroll, and the only thing allowed to light up is state: amber for
a claimed asset, green for a free one, red for a refusal. Flourish inside a tool
is a defect, not a feature.

The **demo page** exists because most people who judge a thing never open it.
The recording is hosted here rather than on a video site, so the link lasts as
long as the site and seeking works over range requests.

```bash
cd web
npm install
npm run dev      # http://localhost:5173
npm run build
```

Everything on all three surfaces is an `eth_call` against one Creditcoin node.
There is no backend, no indexer and no wallet: `src/lib/registry.ts` is the
whole data layer, with ABI encoding written by hand because every call is four
static words wide.

Point it at another deployment without touching the code:

```
/register?registry=0xYourRegistry
/register?rpc=https://your-node
```

## The recording

```bash
node ../script/record-demo.mjs
```

Drives the live site through the eight steps in
[docs/DEMO.md](../docs/DEMO.md), draws a cursor, burns the narration in as
captions and writes a webm; the encode line in that file turns it into the mp4
under `public/demo`. Captions rather than a voice track, because a judge
reviewing dozens of entries watches muted and a caption can be paused on a hash.

Timecodes in the chapter list are read off frames of the recording. Re-record
and they have to be checked again.

## Publishing

```bash
./script/publish-ui.sh
```

Builds and copies `web/dist` to `/var/www/singleton`, which Caddy serves behind
a Cloudflare origin certificate. The content policy there allows no inline
scripts, no external scripts, styles or fonts, and two connection targets, both
of them a Creditcoin RPC: `rpc.cc3-testnet.creditcoin.network`, which the page
reads by default, and `rpc.cc3.creditcoin.network`, so that `?rpc=` can be
pointed at mainnet without editing the policy. Nothing else is reachable, which
is the part that matters, but "exactly one" was the wrong count and is corrected
here. Fonts are never inlined as `data:` URIs, because
that policy names `font-src 'self'` and an inlined subset would silently fail.
