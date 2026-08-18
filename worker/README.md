# Off-chain relay

Four scripts. None of them is trusted with anything: the relay carries bytes, and
every claim in those bytes is re-checked by the BlockProver precompile inside the
registry's own transaction.

```bash
cd worker && npm install
export DEPLOYER_KEY_FILE=/path/to/key      # or PRIVATE_KEY=0x..
```

Addresses come from `worker/deployed.json`, overridable by environment
(`REGISTRY`, `DEED`, `HARBOR`, `MERIDIAN`, `TOKEN_ID`).

| Script | What it does |
|---|---|
| `chainkey.mjs [chainId]` | Resolves a chain id to this Creditcoin network's chain key and prints the attested tip. Pin the id, never the key. |
| `probe-source.mjs [txHash]` | Proves the whole read path for a source chain through `eth_call` only: prover service, `verify`, `calculateTxIndex`, decoder. Costs nothing on either chain. |
| `pledge.mjs <harbor\|meridian> [amount]` | Emits a real pledge on Sepolia from one of the two lenders. Prints the transaction hash to relay. |
| `lifecycle.mjs <harbor\|meridian> <settle\|release>` | Moves that lien forward on Sepolia: repayment, then discharge. Each call emits one real log and so becomes one more proof. |
| `relay.mjs <sourceTxHash> [pledge\|collision\|settle\|release]` | Waits for the finality window, fetches the inclusion proof, submits the matching entry point on Creditcoin, prints the record. A refused pledge stops at the static call and names the incumbent; `collision` then records the attempt without touching it. |
| `allow.mjs <emitter> [on\|off]` | Registry admin: allowlist an emitter, or `--min-conf <blocks>`. |
| `status.mjs [token] [tokenId]` | What a lender calls before lending: state, incumbent, certificate and every refused pledge on file. Read only, no key needed. |
| `demo.mjs [--list]` | Replays the whole life of the demo asset from `demo.json` into whichever registry is configured. The source transactions already exist and are already final, so the sequence runs in minutes rather than hours. |

`relay-core.mjs` holds the logic; `relay.mjs` and `demo.mjs` are two front ends
onto it.

`FORCE_SUBMIT=1` sends a refused pledge anyway, producing a failed transaction on
Creditcoin on purpose: a revert in the explorer is checkable by anybody, a
console line is not.

The wait in `relay.mjs` is the same condition the registry enforces,
`height + minConfirmations <= attestedTip`. Sepolia attestation runs about forty
blocks behind its head, so with the configured depth of 64 a pledge becomes
registrable roughly twenty minutes after it is mined.
