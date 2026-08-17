#!/usr/bin/env bash
#
# Deploys SingletonRegistry on Creditcoin and configures one source chain.
#
# Why this is a shell script and not a forge script: Creditcoin's RPC returns
# blocks without a `mixHash` field, and forge's fork backend refuses to build a
# simulation environment from them ("header validation error: prevrandao not
# set"). `forge create` only warns and proceeds, so deployment goes through it
# and configuration goes through `cast`. script/DeployRegistry.s.sol is kept for
# EVM chains that do return the field.
#
# The chain key is resolved from the chain id against live ChainInfo, never
# hardcoded: key 1 is Sepolia on CC3 testnet and Ethereum on CC3 mainnet.
#
#   PRIVATE_KEY=0x.. ./script/deploy-cc3.sh
#   PRIVATE_KEY=0x.. HARBOR=0x.. MERIDIAN=0x.. ./script/deploy-cc3.sh

set -euo pipefail

CC3_RPC="${CC3_RPC:-https://rpc.cc3-testnet.creditcoin.network}"
SOURCE_CHAIN_ID="${SOURCE_CHAIN_ID:-11155111}"
MIN_CONFIRMATIONS="${MIN_CONFIRMATIONS:-64}"
CHAIN_INFO=0x0000000000000000000000000000000000000fD3

: "${PRIVATE_KEY:?set PRIVATE_KEY}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

chain_key=$(node worker/chainkey.mjs "$SOURCE_CHAIN_ID" | head -1 | awk '{print $NF}')
echo "chain id $SOURCE_CHAIN_ID resolves to chain key $chain_key on $CC3_RPC"

registry=$(FOUNDRY_PROFILE=cc3 forge create src/SingletonRegistry.sol:SingletonRegistry \
  --rpc-url "$CC3_RPC" --private-key "$PRIVATE_KEY" --legacy --broadcast 2>/dev/null \
  | awk '/Deployed to:/ {print $3}')
echo "registry $registry"

cast send "$registry" "setMinConfirmations(uint64,uint64)" "$chain_key" "$MIN_CONFIRMATIONS" \
  --private-key "$PRIVATE_KEY" --rpc-url "$CC3_RPC" --legacy >/dev/null
echo "minConfirmations[$chain_key] = $MIN_CONFIRMATIONS"

for emitter in "${HARBOR:-}" "${MERIDIAN:-}"; do
  [ -z "$emitter" ] && continue
  cast send "$registry" "setEmitter(uint64,address,bool)" "$chain_key" "$emitter" true \
    --private-key "$PRIVATE_KEY" --rpc-url "$CC3_RPC" --legacy >/dev/null
  echo "allowed $emitter"
done

echo "explorer https://creditcoin-testnet.blockscout.com/address/$registry"
