#!/usr/bin/env bash
# Quantum Cats — controlled rehearsal: local chain + REAL IBM job, end to end.
# Requires: foundry, node deps installed, IBM_QUANTUM_TOKEN in .env.
# Usage: bash script/rehearsal.sh [num_mints]
set -euo pipefail
cd "$(dirname "$0")/.."
N=${1:-2}
PORT=8560
# PUBLIC well-known anvil development keys (accounts 0 and 1). These are the
# standard local-chain defaults shipped with foundry. They hold no real funds
# and must never be used on a live network.
PK0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # anvil[0] deployer/minter
PK1=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d   # anvil[1] oracle
ORACLE_ADDR=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
MINTER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
RPC=http://127.0.0.1:$PORT

anvil --silent --port $PORT & ANVIL=$!
trap 'kill $ANVIL 2>/dev/null || true' EXIT
sleep 2

MOCK=$(forge create test/QuantumCats.t.sol:MockERC20 --rpc-url $RPC --private-key $PK0 --broadcast 2>/dev/null | grep "Deployed to" | awk '{print $3}')
rm -rf broadcast
DEPLOYER_PRIVATE_KEY=$PK0 ORACLE_ADDRESS=$ORACLE_ADDR MAX_SUPPLY=10000 MINT_TOKEN_CA=$MOCK \
  forge script script/Deploy.s.sol --rpc-url $RPC --broadcast > /dev/null 2>&1
CATS=$(python3 -c "
import json, glob
d = json.load(open(glob.glob('broadcast/Deploy.s.sol/*/run-latest.json')[0]))
print(next(tx['contractAddress'] for tx in d['transactions']
      if tx['transactionType'] == 'CREATE' and tx.get('contractName') == 'QuantumCats'))")
echo \"rehearsal: QuantumCats at $CATS on $RPC\"

cast send $MOCK "mint(address,uint256)" $MINTER 1000000000000000000000000000 --rpc-url $RPC --private-key $PK0 > /dev/null
cast send $MOCK "approve(address,uint256)" $CATS 1000000000000000000000000000 --rpc-url $RPC --private-key $PK0 > /dev/null
for i in $(seq 1 $N); do cast send $CATS "mint()" --rpc-url $RPC --private-key $PK0 > /dev/null; done
echo "minted $N boxes; starting daemon (seal -> submit -> bind -> resolve -> reveal)"

rm -f oracle/state.json
RPC_URL=$RPC CONTRACT_ADDRESS=$CATS ORACLE_PRIVATE_KEY=$PK1 \
  BATCH_INTERVAL_MS=1000 POLL_MS=15000 \
  node oracle/daemon.mjs > /tmp/qc_rehearsal_daemon.log 2>&1 & DAEMON=$!
until grep -q "REVEALED\|FATAL\|PARKED" /tmp/qc_rehearsal_daemon.log 2>/dev/null; do sleep 5; done
kill $DAEMON 2>/dev/null || true
grep -E "seal|bound|resolved|REVEALED|FATAL|PARKED" /tmp/qc_rehearsal_daemon.log

echo; echo "── verifier, token 1 ──"
RPC_URL=$RPC CONTRACT_ADDRESS=$CATS node verify.mjs 1
