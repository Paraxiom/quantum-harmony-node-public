#!/usr/bin/env bash
# QuantumHarmony level 1 node: fetch the chainspec and the signed snapshot, then start.
#
#   ./join.sh            first start (downloads about 110 GB, verifies, starts)
#   ./join.sh --start    start without touching the data (after a reboot or an update)
#
# What this script trusts, and how it checks it:
#   chainspec  : sha256 pinned below, fetched from paraxiom.org
#   snapshot   : detached GPG signature by the Paraxiom signing key (fingerprint pinned
#                below, public key fetched from paraxiom.github.io/apt) plus sha256
#   image      : the tag pinned in docker-compose.yml
# It never generates or stores signing keys. The node's own libp2p identity is created
# in the data volume on first start and is not a signing key.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

CHAINSPEC_URL="https://paraxiom.org/chainspec.json"

# sha256 of the CORRECT chainspec: the one whose genesis is the live network's.
#
# 2026-09-26: the file served at CHAINSPEC_URL was NOT this one. It was an older
# spec named "QuantumHarmony PQBFT Network v37", sha a7e699e6…, which builds
# genesis 0x842a1ed2… — a different chain from the live 0x67a63ee1…. A node
# started from it can never peer with the fleet, no matter how good the snapshot
# is. The pin below is deliberately the right file, so this script FAILS LOUDLY
# until the correct chainspec is actually published. Do not "fix" it by putting
# the served file's hash back.
CHAINSPEC_SHA256="4f468f152ff4a0e33fa8322ac7cfc6b69a7d527c438d69faa0d440f65630e271"

# The genesis this chainspec must produce, and the chain id it must declare.
# Checked again after the node starts, because a matching file hash only proves
# the bytes are the expected bytes, not that they build the expected chain.
EXPECTED_GENESIS="0x67a63ee15ecd67f1bcf8437b31800ddd76274db3f06fe6b0c3cf0a9235604008"
EXPECTED_CHAIN_ID="dev3"

# RELEASE-CHECKLIST.md items 2 and 3: these three files must exist before the kit is
# handed to a host. Until then this script stops with a clear message.
SNAPSHOT_URL="https://paraxiom.org/snapshots/level1-latest.tar.gz"
SNAPSHOT_SHA_URL="${SNAPSHOT_URL}.sha256"
SNAPSHOT_SIG_URL="${SNAPSHOT_URL}.asc"

KEY_URL="https://paraxiom.github.io/apt/paraxiom.gpg"
KEY_FPR="F138C1E15C0C364B0F94155A3191BE373AA98E2F"   # Paraxiom APT Signing Key <apt@paraxiom.org>

VOLUME="level1_qh-level1-data"
COMPOSE=(docker compose -f docker-compose.yml)

say()  { printf '%s\n' "$*"; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

need docker; need curl; need gpg; need python3
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (docker compose version)"
if ! command -v sha256sum >/dev/null 2>&1; then sha256sum() { shasum -a 256 "$@"; }; fi

start_only() {
  "${COMPOSE[@]}" pull --quiet || true
  "${COMPOSE[@]}" up -d
  say "Node started. Logs: docker compose -f level1/docker-compose.yml logs -f"
  say "Check:        ./verify.sh"
}

[ "${1:-}" = "--start" ] && { start_only; exit 0; }

say "1/5  Chainspec"
curl -sfL -o chainspec.json.new "$CHAINSPEC_URL" || die "cannot fetch $CHAINSPEC_URL"
got=$(sha256sum chainspec.json.new | awk '{print $1}')
[ "$got" = "$CHAINSPEC_SHA256" ] || die "chainspec sha256 mismatch: expected $CHAINSPEC_SHA256, got $got"
mv chainspec.json.new chainspec.json
CHAIN_ID=$(python3 -c 'import json;print(json.load(open("chainspec.json"))["id"])')
[ "$CHAIN_ID" = "$EXPECTED_CHAIN_ID" ] \
  || die "chainspec declares chain id '$CHAIN_ID', expected '$EXPECTED_CHAIN_ID'"
say "     ok, chain id: $CHAIN_ID"

say "2/5  Signing key"
curl -sfL -o paraxiom.gpg "$KEY_URL" || die "cannot fetch $KEY_URL"
fpr=$(gpg --with-colons --show-keys paraxiom.gpg 2>/dev/null | awk -F: '/^fpr/{print $10; exit}')
[ "$fpr" = "$KEY_FPR" ] || die "signing key fingerprint mismatch: expected $KEY_FPR, got $fpr"
export GNUPGHOME="$(mktemp -d)"; trap 'rm -rf "$GNUPGHOME"' EXIT
gpg --quiet --import paraxiom.gpg
say "     ok, $KEY_FPR"

say "3/5  Snapshot"
curl -sfI "$SNAPSHOT_URL" >/dev/null || die "no snapshot published yet at $SNAPSHOT_URL (Paraxiom has not released it; ask sylvain@paraxiom.org)"
curl -sfL -o snapshot.sha256 "$SNAPSHOT_SHA_URL" || die "cannot fetch $SNAPSHOT_SHA_URL"
curl -sfL -o snapshot.asc    "$SNAPSHOT_SIG_URL" || die "cannot fetch $SNAPSHOT_SIG_URL"
curl -fL --progress-bar -o snapshot.tar.gz "$SNAPSHOT_URL" || die "snapshot download failed"
gpg --quiet --verify snapshot.asc snapshot.tar.gz || die "snapshot signature does not verify"
exp=$(awk '{print $1}' snapshot.sha256); got=$(sha256sum snapshot.tar.gz | awk '{print $1}')
[ "$exp" = "$got" ] || die "snapshot sha256 mismatch"
say "     ok, signature and sha256 verified"

say "4/5  Data volume"
"${COMPOSE[@]}" down 2>/dev/null || true
docker volume rm "$VOLUME" 2>/dev/null || true
docker volume create "$VOLUME" >/dev/null
docker run --rm -i -v "$VOLUME":/data alpine sh -c "mkdir -p /data/chains/$CHAIN_ID && cd /data/chains/$CHAIN_ID && tar xzf -" < snapshot.tar.gz \
  || die "extracting the snapshot failed"
rm -f snapshot.tar.gz
say "     ok, snapshot in place under /data/chains/$CHAIN_ID"

say "5/5  Start"
start_only

say "     checking the genesis this node actually built"
LOCAL_RPC="${QH_LOCAL_RPC:-http://127.0.0.1:9944}"
for _ in $(seq 1 60); do
  g=$(curl -s -m 3 -H 'Content-Type: application/json' \
        -d '{"jsonrpc":"2.0","id":1,"method":"chain_getBlockHash","params":[0]}' \
        "$LOCAL_RPC" 2>/dev/null \
      | python3 -c 'import json,sys
try: print(json.load(sys.stdin)["result"])
except Exception: pass' 2>/dev/null)
  [ -n "$g" ] && break
  sleep 2
done
if [ -z "$g" ]; then
  say "     WARNING: node did not answer yet; run ./verify.sh once it is up"
elif [ "$g" != "$EXPECTED_GENESIS" ]; then
  die "this node built genesis $g, expected $EXPECTED_GENESIS.
     It is on a DIFFERENT CHAIN and will never peer with the network.
     Stop here and write to sylvain@paraxiom.org with this output."
else
  say "     ok, genesis $g"
fi
