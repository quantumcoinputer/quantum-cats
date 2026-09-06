#!/usr/bin/env bash
# Quantum Cats — TESTNET rehearsal on Robinhood Chain testnet (chain 46630).
# Uses the .env EOA as deployer + oracle + minter, a MockERC20 as the mint
# token, and REAL IBM Quantum jobs. Everything the mainnet flow does, on testnet.
# Prereq: fund DEPLOYER_ADDRESS with testnet ETH (faucet.testnet.chain.robinhood.com).
set -euo pipefail
cd "$(dirname "$0")/.."
export $(grep -E '^(TESTNET_RPC_URL|DEPLOYER_PRIVATE_KEY|DEPLOYER_ADDRESS|ORACLE_PRIVATE_KEY|IBM_QUANTUM_TOKEN)=' .env | xargs)
RPC=${TESTNET_RPC_URL}
N=${1:-2}

CHAIN=$(cast chain-id --rpc-url $RPC)
[ "$CHAIN" = "46630" ] || { echo "unexpected chain id $CHAIN"; exit 1; }
BAL=$(cast balance $DEPLOYER_ADDRESS --rpc-url $RPC)
if [ "$BAL" = "0" ]; then
  echo "EOA $DEPLOYER_ADDRESS has no testnet ETH."
  echo "Fund it: https://faucet.testnet.chain.robinhood.com (or Alchemy/QuickNode faucets), then rerun."
  exit 1
fi
echo "chain 46630 OK, balance $(cast from-wei $BAL) ETH"

echo "── deploying MockERC20 + renderer + collection ──"
MOCK=$(forge create test/QuantumCats.t.sol:MockERC20 --rpc-url $RPC --private-key $DEPLOYER_PRIVATE_KEY --broadcast 2>/dev/null | grep "Deployed to" | awk '{print $3}')
rm -rf broadcast
DEPLOYER_PRIVATE_KEY=$DEPLOYER_PRIVATE_KEY ORACLE_ADDRESS=$DEPLOYER_ADDRESS MAX_SUPPLY=10000 MINT_TOKEN_CA=$MOCK \
  forge script script/Deploy.s.sol --rpc-url $RPC --broadcast > /dev/null 2>&1
CATS=$(python3 -c "
import json, glob
d = json.load(open(glob.glob('broadcast/Deploy.s.sol/*/run-latest.json')[0]))
print(next(tx['contractAddress'] for tx in d['transactions']
      if tx['transactionType'] == 'CREATE' and tx.get('contractName') == 'QuantumCats'))")
echo "MockERC20:   $MOCK"
echo "QuantumCats: $CATS"
echo "explorer:    https://explorer.testnet.chain.robinhood.com/address/$CATS"

cast send $MOCK "mint(address,uint256)" $DEPLOYER_ADDRESS 1000000000000000000000000000 --rpc-url $RPC --private-key $DEPLOYER_PRIVATE_KEY > /dev/null
cast send $MOCK "approve(address,uint256)" $CATS 1000000000000000000000000000 --rpc-url $RPC --private-key $DEPLOYER_PRIVATE_KEY > /dev/null
for i in $(seq 1 $N); do cast send $CATS "mint()" --rpc-url $RPC --private-key $DEPLOYER_PRIVATE_KEY > /dev/null; done
echo "minted $N boxes (100k mock tokens each -> 0xdEaD); starting daemon"

rm -f oracle/state.json
RPC_URL=$RPC CONTRACT_ADDRESS=$CATS BATCH_INTERVAL_MS=1000 POLL_MS=20000 SHOTS=1024 \
  node oracle/daemon.mjs > /tmp/qc_testnet_daemon.log 2>&1 & DAEMON=$!
trap 'kill $DAEMON 2>/dev/null || true' EXIT
until grep -q "REVEALED\|FATAL\|PARKED" /tmp/qc_testnet_daemon.log 2>/dev/null; do sleep 5; done
grep -E "seal|bound|resolved|REVEALED|FATAL|PARKED" /tmp/qc_testnet_daemon.log

echo; echo "── verifier, token 1 (public testnet chain) ──"
RPC_URL=$RPC CONTRACT_ADDRESS=$CATS node verify.mjs 1
echo
echo "rehearsal contract: $CATS  (record it; mainnet deploy is the same flow with RPC_URL + real keys + real ERC20 CA)"
