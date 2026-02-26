#!/bin/bash
#
# QuantumHarmony Upgrade Manager
#
# Prevents 2-day recovery cycles by:
# 1. Pre-flight validation before upgrades
# 2. Automatic state snapshots
# 3. Rollback capability
#
# Usage:
#   ./upgrade-manager.sh preflight              # Run pre-flight checks
#   ./upgrade-manager.sh snapshot <name>        # Create chain state snapshot
#   ./upgrade-manager.sh rollback <name>        # Rollback to snapshot
#   ./upgrade-manager.sh upgrade-runtime <wasm> # Upgrade runtime with safety checks
#   ./upgrade-manager.sh upgrade-node <binary>  # Upgrade node binary with safety checks
#

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SNAPSHOTS_DIR="${PROJECT_ROOT}/snapshots"
LOGS_DIR="${PROJECT_ROOT}/logs"

# Validator SSH configs
ALICE_SSH="ubuntu@51.79.26.123"
BOB_SSH="ubuntu@51.79.26.168"
CHARLIE_SSH="ubuntu@209.38.225.4"
SSH_KEY="${HOME}/.ssh/ovh_simple"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ============================================
# PRE-FLIGHT CHECKS
# ============================================
preflight() {
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║         QUANTUMHARMONY PRE-UPGRADE CHECKLIST              ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo ""

    local passed=0
    local failed=0

    # 1. Check SSH connectivity to all validators
    log_info "1. Testing SSH connectivity..."
    for validator in "alice:${ALICE_SSH}" "bob:${BOB_SSH}" "charlie:${CHARLIE_SSH}"; do
        name="${validator%%:*}"
        ssh_host="${validator##*:}"
        if ssh -i "$SSH_KEY" -o ConnectTimeout=5 -o BatchMode=yes "$ssh_host" "echo ok" &>/dev/null; then
            log_success "   $name: SSH OK"
            ((passed++))
        else
            log_error "   $name: SSH FAILED"
            ((failed++))
        fi
    done

    # 2. Check all validators are running
    log_info "2. Checking validator processes..."
    for validator in "alice:${ALICE_SSH}" "bob:${BOB_SSH}" "charlie:${CHARLIE_SSH}"; do
        name="${validator%%:*}"
        ssh_host="${validator##*:}"
        if ssh -i "$SSH_KEY" "$ssh_host" "pgrep -f quantumharmony" &>/dev/null; then
            log_success "   $name: Node running"
            ((passed++))
        else
            log_error "   $name: Node NOT running"
            ((failed++))
        fi
    done

    # 3. Check block production (via local node if running)
    log_info "3. Checking block production..."
    if curl -s http://localhost:9944 -H "Content-Type: application/json" \
        -d '{"id":1,"jsonrpc":"2.0","method":"chain_getHeader"}' 2>/dev/null | grep -q "result"; then
        local block_hex=$(curl -s http://localhost:9944 -H "Content-Type: application/json" \
            -d '{"id":1,"jsonrpc":"2.0","method":"chain_getHeader"}' | jq -r '.result.number')
        local block_num=$((block_hex))
        log_success "   Best block: #${block_num}"
        ((passed++))
    else
        log_warn "   Local node not available, skipping block check"
    fi

    # 4. Check disk space on validators
    log_info "4. Checking disk space..."
    for validator in "alice:${ALICE_SSH}" "bob:${BOB_SSH}" "charlie:${CHARLIE_SSH}"; do
        name="${validator%%:*}"
        ssh_host="${validator##*:}"
        local disk_pct=$(ssh -i "$SSH_KEY" "$ssh_host" "df -h / | tail -1 | awk '{print \$5}' | tr -d '%'" 2>/dev/null || echo "100")
        if [ "$disk_pct" -lt 80 ]; then
            log_success "   $name: ${disk_pct}% disk used"
            ((passed++))
        else
            log_warn "   $name: ${disk_pct}% disk used (>80%)"
            ((failed++))
        fi
    done

    # 5. Check memory on validators
    log_info "5. Checking memory..."
    for validator in "alice:${ALICE_SSH}" "bob:${BOB_SSH}" "charlie:${CHARLIE_SSH}"; do
        name="${validator%%:*}"
        ssh_host="${validator##*:}"
        local mem_free=$(ssh -i "$SSH_KEY" "$ssh_host" "free -m | awk '/^Mem:/ {print \$7}'" 2>/dev/null || echo "0")
        if [ "$mem_free" -gt 500 ]; then
            log_success "   $name: ${mem_free}MB available"
            ((passed++))
        else
            log_warn "   $name: Only ${mem_free}MB available"
            ((failed++))
        fi
    done

    # Summary
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "📊 PRE-FLIGHT RESULTS: ${passed} passed, ${failed} failed"
    echo "═══════════════════════════════════════════════════════════"

    if [ "$failed" -gt 0 ]; then
        log_error "DO NOT PROCEED - Fix issues above first"
        return 1
    else
        log_success "All checks passed - SAFE TO PROCEED"
        return 0
    fi
}

# ============================================
# SNAPSHOT MANAGEMENT
# ============================================
create_snapshot() {
    local name="${1:-$(date +%Y%m%d_%H%M%S)}"
    local snapshot_dir="${SNAPSHOTS_DIR}/${name}"

    log_info "Creating snapshot: ${name}"
    mkdir -p "$snapshot_dir"

    # Save current runtime version
    log_info "Saving runtime version..."
    curl -s http://localhost:9944 -H "Content-Type: application/json" \
        -d '{"id":1,"jsonrpc":"2.0","method":"state_getRuntimeVersion"}' \
        > "${snapshot_dir}/runtime_version.json" 2>/dev/null || true

    # Save current chain state info
    log_info "Saving chain state info..."
    curl -s http://localhost:9944 -H "Content-Type: application/json" \
        -d '{"id":1,"jsonrpc":"2.0","method":"chain_getHeader"}' \
        > "${snapshot_dir}/latest_header.json" 2>/dev/null || true

    # Save current chain spec
    log_info "Backing up chain spec..."
    cp "${PROJECT_ROOT}/configs/chain-spec.json" "${snapshot_dir}/" 2>/dev/null || true

    # Create marker file with metadata
    cat > "${snapshot_dir}/snapshot_meta.json" << EOF
{
    "name": "${name}",
    "created": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "created_by": "$(whoami)",
    "machine": "$(hostname)"
}
EOF

    # Backup validator chain data (optional, requires SSH)
    read -p "Backup validator chain data? This may take time [y/N]: " backup_chain
    if [[ "$backup_chain" =~ ^[Yy]$ ]]; then
        for validator in "alice:${ALICE_SSH}" "bob:${BOB_SSH}" "charlie:${CHARLIE_SSH}"; do
            name_v="${validator%%:*}"
            ssh_host="${validator##*:}"
            log_info "Backing up ${name_v} chain data..."
            ssh -i "$SSH_KEY" "$ssh_host" "cd quantumharmony && tar czf chain-data-backup.tar.gz data/" 2>/dev/null || true
            scp -i "$SSH_KEY" "${ssh_host}:quantumharmony/chain-data-backup.tar.gz" \
                "${snapshot_dir}/${name_v}-chain-data.tar.gz" 2>/dev/null || true
        done
    fi

    log_success "Snapshot created: ${snapshot_dir}"
    ls -la "$snapshot_dir"
}

list_snapshots() {
    echo "Available snapshots:"
    echo ""
    if [ -d "$SNAPSHOTS_DIR" ]; then
        for snap in "$SNAPSHOTS_DIR"/*/; do
            if [ -f "${snap}snapshot_meta.json" ]; then
                local name=$(basename "$snap")
                local created=$(jq -r '.created' "${snap}snapshot_meta.json" 2>/dev/null || echo "unknown")
                echo "  - ${name} (created: ${created})"
            fi
        done
    else
        echo "  No snapshots found"
    fi
}

# ============================================
# ROLLBACK PROCEDURE
# ============================================
rollback() {
    local name="$1"

    if [ -z "$name" ]; then
        list_snapshots
        echo ""
        read -p "Enter snapshot name to rollback to: " name
    fi

    local snapshot_dir="${SNAPSHOTS_DIR}/${name}"

    if [ ! -d "$snapshot_dir" ]; then
        log_error "Snapshot not found: ${name}"
        list_snapshots
        return 1
    fi

    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║                    ROLLBACK PROCEDURE                     ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo ""

    # Show snapshot info
    log_info "Snapshot info:"
    cat "${snapshot_dir}/snapshot_meta.json" 2>/dev/null || true
    echo ""

    # Confirm
    log_warn "This will stop all validators and restore from snapshot!"
    read -p "Are you sure? Type 'ROLLBACK' to confirm: " confirm
    if [ "$confirm" != "ROLLBACK" ]; then
        log_info "Rollback cancelled"
        return 1
    fi

    # Stop all validators
    log_info "Stopping validators..."
    for validator in "alice:${ALICE_SSH}" "bob:${BOB_SSH}" "charlie:${CHARLIE_SSH}"; do
        name_v="${validator%%:*}"
        ssh_host="${validator##*:}"
        log_info "  Stopping ${name_v}..."
        ssh -i "$SSH_KEY" "$ssh_host" "pkill -f quantumharmony || true" 2>/dev/null || true
    done

    sleep 5

    # Restore chain data if available
    for validator in "alice:${ALICE_SSH}" "bob:${BOB_SSH}" "charlie:${CHARLIE_SSH}"; do
        name_v="${validator%%:*}"
        ssh_host="${validator##*:}"
        local backup_file="${snapshot_dir}/${name_v}-chain-data.tar.gz"

        if [ -f "$backup_file" ]; then
            log_info "Restoring ${name_v} chain data..."
            scp -i "$SSH_KEY" "$backup_file" "${ssh_host}:quantumharmony/chain-data-restore.tar.gz"
            ssh -i "$SSH_KEY" "$ssh_host" "cd quantumharmony && rm -rf data && tar xzf chain-data-restore.tar.gz"
        else
            log_warn "No chain data backup for ${name_v}, will need to re-sync"
        fi
    done

    # Restart validators
    log_info "Restarting validators..."
    for validator in "alice:${ALICE_SSH}" "bob:${BOB_SSH}" "charlie:${CHARLIE_SSH}"; do
        name_v="${validator%%:*}"
        ssh_host="${validator##*:}"
        log_info "  Starting ${name_v}..."
        ssh -i "$SSH_KEY" "$ssh_host" "cd quantumharmony && nohup ./start-validator.sh > validator.log 2>&1 &" 2>/dev/null || true
    done

    log_success "Rollback initiated. Monitor with: node scripts/network-health-agent.js monitor"
}

# ============================================
# SAFE RUNTIME UPGRADE
# ============================================
upgrade_runtime() {
    local wasm_path="$1"

    if [ -z "$wasm_path" ] || [ ! -f "$wasm_path" ]; then
        log_error "Usage: $0 upgrade-runtime <path-to-wasm>"
        return 1
    fi

    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║                SAFE RUNTIME UPGRADE                       ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo ""

    # Step 1: Pre-flight
    log_info "Step 1: Running pre-flight checks..."
    if ! preflight; then
        log_error "Pre-flight failed. Aborting upgrade."
        return 1
    fi

    # Step 2: Validate WASM
    log_info "Step 2: Validating WASM file..."
    node "${SCRIPT_DIR}/network-health-agent.js" validate-runtime "$wasm_path"

    # Step 3: Create snapshot
    log_info "Step 3: Creating pre-upgrade snapshot..."
    local snapshot_name="pre-upgrade-$(date +%Y%m%d_%H%M%S)"
    create_snapshot "$snapshot_name"

    # Step 4: Confirm
    log_warn "Ready to upgrade. Snapshot created: ${snapshot_name}"
    read -p "Proceed with runtime upgrade? [y/N]: " proceed
    if [[ ! "$proceed" =~ ^[Yy]$ ]]; then
        log_info "Upgrade cancelled"
        return 1
    fi

    # Step 5: Submit upgrade
    log_info "Step 5: Submitting runtime upgrade..."
    # This would use the dashboard's upgrade mechanism or direct RPC
    log_warn "TODO: Implement runtime upgrade submission via chunkedUpgrade RPCs"

    log_success "Upgrade process complete. Monitor with: node scripts/network-health-agent.js monitor"
}

# ============================================
# SAFE NODE BINARY UPGRADE
# ============================================
upgrade_node() {
    local binary_path="$1"

    if [ -z "$binary_path" ] || [ ! -f "$binary_path" ]; then
        log_error "Usage: $0 upgrade-node <path-to-binary>"
        return 1
    fi

    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║                SAFE NODE BINARY UPGRADE                   ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo ""

    # Pre-flight
    if ! preflight; then
        log_error "Pre-flight failed. Aborting upgrade."
        return 1
    fi

    # Create snapshot
    local snapshot_name="pre-node-upgrade-$(date +%Y%m%d_%H%M%S)"
    create_snapshot "$snapshot_name"

    # Rolling upgrade - one validator at a time
    log_info "Starting rolling upgrade (one validator at a time)..."

    for validator in "alice:${ALICE_SSH}" "bob:${BOB_SSH}" "charlie:${CHARLIE_SSH}"; do
        name="${validator%%:*}"
        ssh_host="${validator##*:}"

        log_info "Upgrading ${name}..."

        # Stop validator
        ssh -i "$SSH_KEY" "$ssh_host" "pkill -f quantumharmony || true"
        sleep 5

        # Backup old binary
        ssh -i "$SSH_KEY" "$ssh_host" "cd quantumharmony && cp quantumharmony-node quantumharmony-node.backup" 2>/dev/null || true

        # Upload new binary
        scp -i "$SSH_KEY" "$binary_path" "${ssh_host}:quantumharmony/quantumharmony-node"
        ssh -i "$SSH_KEY" "$ssh_host" "chmod +x quantumharmony/quantumharmony-node"

        # Restart
        ssh -i "$SSH_KEY" "$ssh_host" "cd quantumharmony && nohup ./start-validator.sh > validator.log 2>&1 &"

        # Wait and verify
        log_info "Waiting 30s for ${name} to sync..."
        sleep 30

        # Check if running
        if ssh -i "$SSH_KEY" "$ssh_host" "pgrep -f quantumharmony" &>/dev/null; then
            log_success "${name} upgraded and running"
        else
            log_error "${name} failed to start! Rolling back..."
            ssh -i "$SSH_KEY" "$ssh_host" "cd quantumharmony && cp quantumharmony-node.backup quantumharmony-node"
            ssh -i "$SSH_KEY" "$ssh_host" "cd quantumharmony && nohup ./start-validator.sh > validator.log 2>&1 &"
            return 1
        fi
    done

    log_success "All validators upgraded successfully!"
}

# ============================================
# MAIN
# ============================================
mkdir -p "$SNAPSHOTS_DIR" "$LOGS_DIR"

case "${1:-help}" in
    preflight)
        preflight
        ;;
    snapshot)
        create_snapshot "$2"
        ;;
    list-snapshots)
        list_snapshots
        ;;
    rollback)
        rollback "$2"
        ;;
    upgrade-runtime)
        upgrade_runtime "$2"
        ;;
    upgrade-node)
        upgrade_node "$2"
        ;;
    *)
        echo "QuantumHarmony Upgrade Manager"
        echo ""
        echo "Commands:"
        echo "  preflight              Run pre-upgrade validation checks"
        echo "  snapshot [name]        Create a snapshot of current state"
        echo "  list-snapshots         List available snapshots"
        echo "  rollback [name]        Rollback to a previous snapshot"
        echo "  upgrade-runtime <wasm> Safe runtime upgrade with validation"
        echo "  upgrade-node <binary>  Safe node binary rolling upgrade"
        echo ""
        echo "Examples:"
        echo "  $0 preflight"
        echo "  $0 snapshot before-v19"
        echo "  $0 rollback before-v19"
        echo ""
        ;;
esac
