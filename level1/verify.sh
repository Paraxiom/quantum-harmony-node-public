#!/usr/bin/env bash
# Verify a level 1 node against the public read gateway, without trusting either.
#
# The check: take this node's finalized block (hash H at height N) and ask the public
# gateway for the hash it has at height N. Equal means this copy agrees with the
# network on everything up to N. Different means a divergence, which is exactly what a
# copy holder exists to notice.
#
#   ./verify.sh              compares and exits 0 if equal, 1 otherwise
#   ./verify.sh --status     also prints sync state and peers
#
# Exit codes: 0 agrees, 1 divergence at a height, 2 not even the same chain.

set -euo pipefail
LOCAL="${QH_LOCAL_RPC:-http://127.0.0.1:9944}"
REMOTE="${QH_PUBLIC_RPC:-https://validateurs.paraxiom.org/rpc}"

rpc() { # rpc <url> <method> [params-json]
  curl -s -m 20 -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$2\",\"params\":${3:-[]}}" "$1"
}
field() { python3 -c 'import json,sys;d=json.load(sys.stdin);r=d.get("result");print(r if not isinstance(r,dict) else json.dumps(r))'; }

# Genesis first. Comparing block hashes at a height is meaningless if the two
# nodes are not even on the same chain, and "DIVERGENCE at #N" would be a
# misleading way to report that. On 2026-09-26 the chainspec published at
# paraxiom.org built genesis 0x842a1ed2… while the network's is 0x67a63ee1…, so
# this is the failure a host is most likely to hit.
EXPECTED_GENESIS="${QH_EXPECTED_GENESIS:-0x67a63ee15ecd67f1bcf8437b31800ddd76274db3f06fe6b0c3cf0a9235604008}"
local_genesis=$(rpc "$LOCAL" chain_getBlockHash "[0]" | field) || { echo "local node not answering on $LOCAL"; exit 1; }
remote_genesis=$(rpc "$REMOTE" chain_getBlockHash "[0]" | field)

if [ "$local_genesis" != "$EXPECTED_GENESIS" ] || [ "$local_genesis" != "$remote_genesis" ]; then
  echo "WRONG CHAIN"
  printf '  this node genesis : %s\n' "$local_genesis"
  printf '  network genesis   : %s\n' "$remote_genesis"
  printf '  expected          : %s\n' "$EXPECTED_GENESIS"
  echo "  This node is not on the QuantumHarmony network and will never peer with it."
  echo "  The usual cause is a stale chainspec. Re-run ./join.sh, and if it still"
  echo "  fails, write to sylvain@paraxiom.org with this output."
  exit 2
fi
printf 'genesis           %s (matches the network)\n' "$local_genesis"

local_head=$(rpc "$LOCAL" chain_getFinalizedHead | field) || { echo "local node not answering on $LOCAL"; exit 1; }
local_num_hex=$(rpc "$LOCAL" chain_getHeader "[\"$local_head\"]" | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"]["number"])')
local_num=$((local_num_hex))
remote_hash=$(rpc "$REMOTE" chain_getBlockHash "[$local_num]" | field)
remote_head=$(rpc "$REMOTE" chain_getFinalizedHead | field)
remote_num=$(( $(rpc "$REMOTE" chain_getHeader "[\"$remote_head\"]" | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"]["number"])') ))

printf 'local  finalized  #%-9s %s\n' "$local_num" "$local_head"
printf 'public finalized  #%-9s %s\n' "$remote_num" "$remote_head"
printf 'public hash at #%s: %s\n' "$local_num" "$remote_hash"

if [ "${1:-}" = "--status" ]; then
  echo "sync:   $(rpc "$LOCAL" system_syncState | field)"
  echo "health: $(rpc "$LOCAL" system_health | field)"
  echo "peers:  $(rpc "$LOCAL" system_peers | python3 -c 'import json,sys;print(", ".join(p["peerId"][:16]+"… "+p["roles"] for p in json.load(sys.stdin)["result"]))')"
fi

if [ "$local_head" = "$remote_hash" ]; then
  lag=$((remote_num - local_num))
  echo "MATCH: this copy agrees with the network up to #$local_num (behind by $lag blocks)"
  exit 0
else
  echo "DIVERGENCE at #$local_num: this copy has $local_head, the public node has $remote_hash"
  echo "Keep the data, do not restart, write to sylvain@paraxiom.org with this output."
  exit 1
fi
