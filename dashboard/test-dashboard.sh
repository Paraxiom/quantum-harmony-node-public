#!/bin/bash
#
# QuantumHarmony Dashboard Test Suite
# Tests all dashboard features against the running node/faucet
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
TOTAL=0

# Default endpoints
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:8080}"
RPC_URL="${RPC_URL:-http://localhost:9944}"
FAUCET_URL="${FAUCET_URL:-http://51.79.26.123:8080}"

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║      QuantumHarmony Dashboard Test Suite                 ║${NC}"
echo -e "${BLUE}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║  Dashboard: ${DASHBOARD_URL}                             ${NC}"
echo -e "${BLUE}║  RPC:       ${RPC_URL}                                   ${NC}"
echo -e "${BLUE}║  Faucet:    ${FAUCET_URL}                                ${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Test function
test_endpoint() {
    local name="$1"
    local url="$2"
    local method="${3:-GET}"
    local data="$4"
    local expected="$5"

    TOTAL=$((TOTAL + 1))

    echo -n "  Testing: $name... "

    if [ "$method" == "POST" ]; then
        response=$(curl -s -X POST -H "Content-Type: application/json" -d "$data" "$url" 2>/dev/null)
    else
        response=$(curl -s "$url" 2>/dev/null)
    fi

    if [ -z "$response" ]; then
        echo -e "${RED}FAILED${NC} (no response)"
        FAILED=$((FAILED + 1))
        return 1
    fi

    if [ -n "$expected" ]; then
        if echo "$response" | grep -q "$expected"; then
            echo -e "${GREEN}PASSED${NC}"
            PASSED=$((PASSED + 1))
            return 0
        else
            echo -e "${RED}FAILED${NC} (expected: $expected)"
            FAILED=$((FAILED + 1))
            return 1
        fi
    else
        echo -e "${GREEN}PASSED${NC}"
        PASSED=$((PASSED + 1))
        return 0
    fi
}

# Test RPC function
test_rpc() {
    local name="$1"
    local method="$2"
    local params="${3:-[]}"
    local expected="$4"

    TOTAL=$((TOTAL + 1))

    echo -n "  Testing: $name... "

    response=$(curl -s -H "Content-Type: application/json" \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"$method\",\"params\":$params,\"id\":1}" \
        "$RPC_URL" 2>/dev/null)

    if [ -z "$response" ]; then
        echo -e "${RED}FAILED${NC} (no response)"
        FAILED=$((FAILED + 1))
        return 1
    fi

    if echo "$response" | grep -q "error"; then
        echo -e "${RED}FAILED${NC} (RPC error)"
        echo "    Response: $response"
        FAILED=$((FAILED + 1))
        return 1
    fi

    if [ -n "$expected" ]; then
        if echo "$response" | grep -q "$expected"; then
            echo -e "${GREEN}PASSED${NC}"
            PASSED=$((PASSED + 1))
            return 0
        else
            echo -e "${RED}FAILED${NC} (expected: $expected)"
            FAILED=$((FAILED + 1))
            return 1
        fi
    else
        echo -e "${GREEN}PASSED${NC}"
        PASSED=$((PASSED + 1))
        return 0
    fi
}

echo -e "${YELLOW}═══ Dashboard Availability ═══${NC}"
test_endpoint "Dashboard HTML loads" "$DASHBOARD_URL/" "GET" "" "Node Operator"
test_endpoint "Dashboard serves JS" "$DASHBOARD_URL/js/keystore-manager.js" "GET" "" "KeystoreManager"

echo ""
echo -e "${YELLOW}═══ RPC Proxy Tests ═══${NC}"
test_endpoint "RPC proxy /rpc" "$DASHBOARD_URL/rpc" "POST" '{"jsonrpc":"2.0","method":"system_chain","params":[],"id":1}' "result"

echo ""
echo -e "${YELLOW}═══ Node RPC Tests ═══${NC}"
test_rpc "system_chain" "system_chain" "[]" ""  # Any chain name is fine
test_rpc "system_name" "system_name" "[]" ""
test_rpc "system_version" "system_version" "[]" ""
test_rpc "system_health" "system_health" "[]" "peers"
test_rpc "chain_getHeader" "chain_getHeader" "[]" "number"

echo ""
echo -e "${YELLOW}═══ Keystore RPC Tests (Unsafe) ═══${NC}"
test_rpc "author_rotateKeys" "author_rotateKeys" "[]" "result"
test_rpc "author_pendingExtrinsics" "author_pendingExtrinsics" "[]" "result"

echo ""
echo -e "${YELLOW}═══ Faucet Tests ═══${NC}"
test_endpoint "Faucet status" "$FAUCET_URL/status" "GET" "" "running"
test_endpoint "Faucet health" "$FAUCET_URL/health" "GET" "" "healthy"
test_endpoint "Faucet proxy via dashboard" "$DASHBOARD_URL/faucet/status" "GET" "" "running"
test_endpoint "Faucet health via dashboard" "$DASHBOARD_URL/faucet/health" "GET" "" "healthy"

echo ""
echo -e "${YELLOW}═══ Network Connectivity ═══${NC}"
# Test peer count
PEERS=$(curl -s -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"system_health","params":[],"id":1}' \
    "$RPC_URL" 2>/dev/null | jq -r '.result.peers // 0')

TOTAL=$((TOTAL + 1))
echo -n "  Testing: Node has peers... "
if [ "$PEERS" -gt 0 ]; then
    echo -e "${GREEN}PASSED${NC} ($PEERS peers)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}FAILED${NC} (0 peers)"
    FAILED=$((FAILED + 1))
fi

# Test block production
BLOCK=$(curl -s -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"chain_getHeader","params":[],"id":1}' \
    "$RPC_URL" 2>/dev/null | jq -r '.result.number // "0x0"')
BLOCK_DEC=$((16#${BLOCK#0x}))

TOTAL=$((TOTAL + 1))
echo -n "  Testing: Blocks being produced... "
if [ "$BLOCK_DEC" -gt 0 ]; then
    echo -e "${GREEN}PASSED${NC} (block #$BLOCK_DEC)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}FAILED${NC} (block 0)"
    FAILED=$((FAILED + 1))
fi

echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo ""

# Summary
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC} ($PASSED/$TOTAL)"
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC} ($PASSED passed, $FAILED failed out of $TOTAL)"
    exit 1
fi
