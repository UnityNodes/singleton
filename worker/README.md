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
| `relay.mjs <sourceTxHash>` | Waits for the finality window, fetches the inclusion proof, submits `registerPledge` on Creditcoin, prints the record. A second pledge of the same asset stops at the static call and reports the incumbent. |
| `allow.mjs <emitter> [on\|off]` | Registry admin: allowlist an emitter, or `--min-conf <blocks>`. |

The wait in `relay.mjs` is the same condition the registry enforces,
`height + minConfirmations <= attestedTip`. Sepolia attestation runs about forty
blocks behind its head, so with the configured depth of 64 a pledge becomes
registrable roughly twenty minutes after it is mined.
