#!/bin/bash

# Start QuantumHarmony node using docker-compose
# Usage:
#   ./start.sh              - Start node + dashboard
#   ./start.sh --bootstrap  - Download chain snapshot then start (first-time setup)
#   ./start.sh --full       - Start full stack (node + dashboard + faucet + all services)
#   ./start.sh --dash       - Start node + dashboard + faucet
#   ./start.sh --bridge     - Start node + Drista chat (NIP-01 ↔ Mesh Forum)

cd "$(dirname "${BASH_SOURCE[0]}")"

SNAPSHOT_URL="https://paraxiom.org/snapshots/chaindata-latest.tar.gz"
CHAINSPEC_URL="https://paraxiom.org/chainspec.json"
EXPECTED_CHAINSPEC_SHA256="dc35f7582f88e320528516167ed26989fa5611a99495be2432d5370003defee6"
COMPOSE_FILE="docker-compose.operator.yml"
VOLUME_NAME="quantum-harmony-node_node-data"

bootstrap() {
    echo "╔══════════════════════════════════════════════════╗"
    echo "║  QuantumHarmony Chain Bootstrap                  ║"
    echo "╚══════════════════════════════════════════════════╝"
    echo ""

    # Pull latest image
    echo "Pulling latest node image..."
    docker-compose -f "$COMPOSE_FILE" pull --quiet 2>/dev/null

    # Stop any running node
    docker-compose -f "$COMPOSE_FILE" down 2>/dev/null

    # Refresh chainspec from canonical source. The chainspec embedded in the
    # repo (configs/chain-spec.json) may be stale if the operator's local clone
    # is behind. The version at https://paraxiom.org/chainspec.json is always
    # the genesis the live network is actually running on.
    echo "Refreshing chainspec from $CHAINSPEC_URL ..."
    if curl -sfL -o configs/chain-spec.json.new "$CHAINSPEC_URL"; then
        ACTUAL_SHA=$(sha256sum configs/chain-spec.json.new | awk '{print $1}')
        if [ "$ACTUAL_SHA" = "$EXPECTED_CHAINSPEC_SHA256" ]; then
            mv configs/chain-spec.json.new configs/chain-spec.json
            echo "  ✓ chainspec sha256 matches expected ($EXPECTED_CHAINSPEC_SHA256)"
        else
            echo "  ⚠  chainspec sha256 MISMATCH:"
            echo "       expected: $EXPECTED_CHAINSPEC_SHA256"
            echo "       got:      $ACTUAL_SHA"
            echo "  Update start.sh's EXPECTED_CHAINSPEC_SHA256 if this is a"
            echo "  legitimate chainspec rev, or check for a download issue."
            rm -f configs/chain-spec.json.new
        fi
    else
        echo "  ⚠  could not fetch chainspec from $CHAINSPEC_URL"
        echo "  Falling back to whatever is in configs/chain-spec.json"
    fi

    # Remove old data
    echo "Removing old chain data..."
    docker volume rm "$VOLUME_NAME" 2>/dev/null
    docker volume create "$VOLUME_NAME" >/dev/null

    # Download snapshot (if available)
    echo "Downloading chain snapshot..."
    echo "  Source: $SNAPSHOT_URL"
    echo ""

    if curl -sfI "$SNAPSHOT_URL" > /dev/null 2>&1; then
        curl -fL --progress-bar "$SNAPSHOT_URL" | \
            docker run --rm -i -v "$VOLUME_NAME":/data alpine \
            sh -c 'mkdir -p /data/chains/quantumharmony_prod && cd /data/chains/quantumharmony_prod && tar xzf -'

        if [ $? -ne 0 ]; then
            echo ""
            echo "WARNING: Snapshot download/extract failed."
            echo "The node will sync from genesis (this may take a while)."
        else
            echo ""
            echo "Snapshot applied."
        fi
    else
        echo "Snapshot not available at $SNAPSHOT_URL"
        echo "The node will sync from genesis (this may take a while)."
    fi

    echo ""
    echo "Starting node..."
    echo ""

    # Start normally
    docker-compose -f "$COMPOSE_FILE" up -d
    echo ""
    echo "Services starting:"
    echo "  Node:       ws://localhost:9944"
    echo "  Dashboard:  http://localhost:8080"
    echo ""
    echo "The node will sync remaining blocks from the network."
    echo "View logs: docker-compose -f $COMPOSE_FILE logs -f"
}

case "${1:-}" in
    --bootstrap)
        bootstrap
        ;;
    --full)
        COMPOSE_FILE="docker-compose.yml"
        echo "Starting full stack (requires POSTGRES_PASSWORD env var)..."
        docker-compose -f "$COMPOSE_FILE" pull --quiet 2>/dev/null
        docker-compose -f "$COMPOSE_FILE" up -d
        echo ""
        echo "Services starting:"
        echo "  Node:       ws://localhost:9944"
        echo "  Dashboard:  http://localhost:8080"
        echo "  Faucet:     http://localhost:8085"
        echo "  KYC API:    http://localhost:8200"
        echo "  Operator:   http://localhost:9955"
        echo "  QRNG:       http://localhost:8106"
        echo ""
        echo "View logs: docker-compose -f $COMPOSE_FILE logs -f"
        ;;
    *)
        echo "Starting node + dashboard..."
        docker-compose -f "$COMPOSE_FILE" pull --quiet 2>/dev/null
        docker-compose -f "$COMPOSE_FILE" up -d
        echo ""
        echo "Services starting:"
        echo "  Node:       ws://localhost:9944"
        echo "  Dashboard:  http://localhost:8080"
        echo ""
        echo "View logs: docker-compose -f $COMPOSE_FILE logs -f"
        ;;
esac
