# The site

Live at **https://singleton.unitynodes.com**, with the register itself at
`/register`.

Two surfaces, one brand, deliberately different jobs.

The **landing** is where the argument is made: what the problem is, why it can
only be solved on Creditcoin, and the three real transactions that make the
collision. It is dark, it uses motion, and the animated beam is not decoration:
it draws the actual path a fact takes from a protocol's log to this register.

The **register** is a tool somebody uses at work. It is light, dense, fixed to
the window with no page scroll, and it has no motion beyond what conveys state.
Flourish inside a tool is a defect, not a feature.

```bash
cd web
npm install
npm run dev      # http://localhost:5173
npm run build
```

Everything on both surfaces is an `eth_call` against one Creditcoin node. There
is no backend, no indexer and no wallet: `src/lib/registry.ts` is the whole data
layer, with ABI encoding written by hand because every call is four static words
wide.

Point it at another deployment without touching the code:

```
/register?registry=0xYourRegistry
/register?rpc=https://your-node
```

Components under `src/components/magicui` come from Magic UI and are vendored
rather than installed, so the bundle carries no registry dependency.

## Publishing

```bash
./script/publish-ui.sh
```

Builds and copies `web/dist` to `/var/www/singleton`, which Caddy serves behind
a Cloudflare origin certificate. The content policy there allows no inline
scripts, no external scripts, styles or fonts, and exactly one connection
target: the Creditcoin RPC.
