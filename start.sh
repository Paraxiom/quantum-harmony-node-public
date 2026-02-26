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

    # Remove old data
    echo "Removing old chain data..."
    docker volume rm "$VOLUME_NAME" 2>/dev/null
    docker volume create "$VOLUME_NAME" >/dev/null

    # Download snapshot
    echo "Downloading chain snapshot..."
    echo "  Source: $SNAPSHOT_URL"
    echo ""

    curl -fL --progress-bar "$SNAPSHOT_URL" | \
        docker run --rm -i -v "$VOLUME_NAME":/data alpine \
        sh -c 'mkdir -p /data/chains/dev3 && cd /data/chains/dev3 && tar xzf -'

    if [ $? -ne 0 ]; then
        echo ""
        echo "ERROR: Snapshot download/extract failed."
        echo "Check your internet connection and try again."
        exit 1
    fi

    echo ""
    echo "Snapshot applied. Starting node..."
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
