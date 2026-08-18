# The register, as a page

Live at **https://singleton.unitynodes.com**

One file, no build, no dependencies, no wallet. Open `index.html` in a browser,
or serve the directory if you prefer:

```bash
python3 -m http.server 8899
```

It reads Creditcoin over JSON-RPC and nothing else. There is no backend, no
indexer and no key: everything on screen is a call anybody can repeat, which is
the same claim the registry itself makes.

- the chain strip resolves each chain id to the key this Creditcoin network uses
  and shows how far attestation has reached, because a pledge younger than the
  confirmation depth is not registrable yet
- the record is one asset: who holds the lien, for how much, and which source
  block proved it, with the block linked in the source chain's explorer
- refused pledges are listed under the record, since a lender wants to know that
  somebody already tried
- the history of the asset is read from the registry's own logs, so a free asset
  can still show what it has been through
- the register at the foot is every entry in the recent window

Point it at another deployment without editing anything:

```
index.html?registry=0xYourRegistry
index.html?rpc=https://your-node
```

ABI encoding is done by hand, in about forty lines. That is deliberate: a public
register should be readable from a single file, and a page that pulls in a
library to read four static words is not.

## Publishing

```bash
./script/publish-ui.sh
```

It copies the file to `/var/www/singleton`, which Caddy serves for
`singleton.unitynodes.com` behind a Cloudflare origin certificate. The content
policy there allows no external scripts, no external styles and exactly one
connection target, the Creditcoin RPC. Everything else on the page leaves in a
new tab rather than over a connection the page opens.
