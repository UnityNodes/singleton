# The register, as a page

Live at **https://singleton.unitynodes.com**

One file, no build, no dependencies, no wallet, no backend. Open `index.html` in
a browser, or serve the directory:

```bash
python3 -m http.server 8899
```

It is a tool, not a brochure, so it is built like one: a fixed shell that fills
the window, a register on the left, the selected record on the right, and no
page that scrolls away under the reader. Everything on screen is an
`eth_call` against one Creditcoin node, which anybody can repeat.

- the top bar carries the live attestation heights, because a pledge younger
  than the confirmation depth is not registrable yet and that is worth seeing
- the rail lists every asset the register has touched recently, with its current
  state and whether anybody was refused against it
- the record answers the lender's question first: who holds the lien, for how
  much, and against which asset
- "how this is known" is the actual chain of custody for that record: the
  protocol's own log, the inclusion proof the precompile re-checked, the
  transaction that wrote it
- the history is read from the registry's own logs, so a released asset still
  shows what it went through

Point it at another deployment without editing anything:

```
index.html?registry=0xYourRegistry
index.html?rpc=https://your-node
```

ABI encoding is done by hand, in about forty lines, because a register should be
readable from a single file and a page that pulls in a library to read four
static words is not.

## Publishing

```bash
./script/publish-ui.sh
```

It copies the file to `/var/www/singleton`, which Caddy serves for
`singleton.unitynodes.com` behind a Cloudflare origin certificate. The content
policy there allows no external scripts, styles or fonts, and exactly one
connection target: the Creditcoin RPC.
