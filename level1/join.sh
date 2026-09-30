#!/usr/bin/env bash
# QuantumHarmony level 1 node: fetch the chainspec and the signed snapshot, then start.
#
#   ./join.sh            first start (downloads about 116 GB, verifies, starts;
#                        needs about 240 GB free during the install; run it again to resume)
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

# Published 2026-09-30 (RELEASE-CHECKLIST.md items 2 and 3). If they are ever missing,
# this script stops with a clear message.
SNAPSHOT_URL="https://paraxiom.org/snapshots/level1-latest.tar.gz"
SNAPSHOT_SHA_URL="${SNAPSHOT_URL}.sha256"
# The signature covers the .sha256 file, and the .sha256 file covers the snapshot.
# (Signing a 120 GB file directly would mean moving it to the machine that holds the key.)
SNAPSHOT_SIG_URL="${SNAPSHOT_SHA_URL}.asc"

KEY_URL="https://paraxiom.github.io/apt/paraxiom.gpg"
KEY_FPR="F138C1E15C0C364B0F94155A3191BE373AA98E2F"   # Paraxiom APT Signing Key <apt@paraxiom.org>

VOLUME="level1_qh-level1-data"
COMPOSE=(docker compose -f docker-compose.yml)

say()  { printf '%s\n' "$*"; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

need docker; need curl; need gpg; need python3
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (docker compose version)"
case "$(docker info --format '{{.Architecture}}' 2>/dev/null)" in
  x86_64|amd64) ;;
  *) say "WARNING: the node image is built for x86_64 (amd64) only. On this machine it runs"
     say "         under emulation, which has not been tested and may not keep up with the chain." ;;
esac
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
size=$(curl -sfIL "$SNAPSHOT_URL" | awk 'tolower($1)=="content-length:"{v=$2} END{gsub(/\r/,"",v); print v}') \
  || die "no snapshot published yet at $SNAPSHOT_URL (Paraxiom has not released it; ask sylvain@paraxiom.org)"
[ -n "$size" ] || die "no snapshot published yet at $SNAPSHOT_URL (Paraxiom has not released it; ask sylvain@paraxiom.org)"
gb=$(( size / 1000000000 + 1 ))
curl -sfL -o snapshot.sha256 "$SNAPSHOT_SHA_URL" || die "cannot fetch $SNAPSHOT_SHA_URL"
curl -sfL -o snapshot.sha256.asc "$SNAPSHOT_SIG_URL" || die "cannot fetch $SNAPSHOT_SIG_URL"
# Accept only a valid signature made by the pinned key. (gpg's "not certified" warning is
# about its web of trust; the key's fingerprint was already checked in step 2.)
gpg --batch --status-fd 1 --verify snapshot.sha256.asc snapshot.sha256 2>/dev/null \
  | grep -q "^\[GNUPG:\] VALIDSIG $KEY_FPR " || die "the checksum file's signature does not verify"
say "     ok, checksum file signed by $KEY_FPR"
exp=$(awk '{print $1}' snapshot.sha256)

# Check the disk BEFORE a download that takes hours. The archive lands in this folder;
# the database is extracted into a Docker volume, which may be on another disk (and on
# Docker Desktop lives inside its virtual disk, 64 GB by default), so each is measured
# where it will actually be written.
have=0; [ -f snapshot.tar.gz ] && have=$(wc -c < snapshot.tar.gz | tr -d ' ')
free_here=$(( $(df -Pk . | awk 'NR==2{print $4}') * 1024 ))
[ $(( free_here + have )) -gt $(( size + 2000000000 )) ] \
  || die "not enough space here for the ${gb} GB download: $(( free_here / 1000000000 )) GB free in $(pwd)"
docker volume create qh-level1-spacecheck >/dev/null
free_vol=$(( $(docker run --rm -v qh-level1-spacecheck:/data alpine df -Pk /data 2>/dev/null | awk 'NR==2{print $4}') * 1024 ))
docker volume rm qh-level1-spacecheck >/dev/null
docker volume inspect "$VOLUME" >/dev/null 2>&1 && free_vol=$(( free_vol + size ))   # replaced in step 4
[ "$free_vol" -gt $(( size * 11 / 10 )) ] \
  || die "not enough space for Docker volumes: $(( free_vol / 1000000000 )) GB free, the database needs about $(( gb * 11 / 10 )) GB.
     On Docker Desktop, raise Settings > Resources > Disk usage limit, then run ./join.sh again."
say "     disk ok: ${gb} GB to download, $(( free_here / 1000000000 )) GB free here, $(( free_vol / 1000000000 )) GB for Docker volumes"

# Resumable: a dropped connection continues where it stopped when ./join.sh is run again.
[ "$have" -gt "$size" ] && { rm -f snapshot.tar.gz; have=0; }   # left over from an older snapshot
tries=0
while [ "$have" -ne "$size" ]; do
  tries=$(( tries + 1 )); [ "$tries" -le 20 ] || die "snapshot download keeps failing; run ./join.sh again later to resume"
  curl -fL -C - --progress-bar -o snapshot.tar.gz "$SNAPSHOT_URL" || { say "     connection lost, resuming in 10 s"; sleep 10; }
  have=$(wc -c < snapshot.tar.gz | tr -d ' ')
done
say "     checking the download (a few minutes)"
got=$(sha256sum snapshot.tar.gz | awk '{print $1}')
[ "$exp" = "$got" ] || { rm -f snapshot.tar.gz; die "snapshot sha256 mismatch (file removed; run ./join.sh again)"; }
say "     ok, signed checksum verified, snapshot matches it"

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
