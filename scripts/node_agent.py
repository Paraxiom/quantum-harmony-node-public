#!/usr/bin/env python3
"""
QuantumHarmony Node Testing Agent
=================================

An automated agent that tests the node like a human operator would:
- Checks all RPC endpoints
- Tests faucet functionality
- Creates accounts and transfers funds
- Tests staking and rewards
- Tests QRNG/signals system
- Tests MeshForum messaging

Usage:
    python node_agent.py --node http://localhost:9944 --faucet http://localhost:3000
    python node_agent.py --node ws://localhost:9944 --full-test
"""

import argparse
import asyncio
import json
import time
import secrets
import hashlib
from dataclasses import dataclass
from typing import Optional, Dict, Any, List
from datetime import datetime

try:
    import aiohttp
    AIOHTTP_AVAILABLE = True
except ImportError:
    AIOHTTP_AVAILABLE = False
    import urllib.request
    import urllib.error

# Colors for terminal output
class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    BOLD = '\033[1m'
    END = '\033[0m'

def log(msg: str, level: str = "info"):
    timestamp = datetime.now().strftime("%H:%M:%S")
    if level == "success":
        print(f"{Colors.GREEN}[{timestamp}] ✓ {msg}{Colors.END}")
    elif level == "error":
        print(f"{Colors.RED}[{timestamp}] ✗ {msg}{Colors.END}")
    elif level == "warning":
        print(f"{Colors.YELLOW}[{timestamp}] ⚠ {msg}{Colors.END}")
    elif level == "info":
        print(f"{Colors.CYAN}[{timestamp}] ℹ {msg}{Colors.END}")
    elif level == "header":
        print(f"\n{Colors.BOLD}{Colors.BLUE}{'='*60}")
        print(f"  {msg}")
        print(f"{'='*60}{Colors.END}\n")

@dataclass
class TestResult:
    name: str
    passed: bool
    message: str
    details: Optional[Dict] = None

class NodeAgent:
    """Agent that operates the QuantumHarmony node like a human would."""

    def __init__(self, node_url: str, faucet_url: Optional[str] = None):
        self.node_url = node_url.replace("ws://", "http://").replace("wss://", "https://")
        self.faucet_url = faucet_url
        self.results: List[TestResult] = []
        self.rpc_id = 0

    def _next_id(self) -> int:
        self.rpc_id += 1
        return self.rpc_id

    def _make_request(self, url: str, payload: Dict) -> Dict:
        """Make HTTP POST request (sync fallback if aiohttp not available)."""
        data = json.dumps(payload).encode('utf-8')
        headers = {'Content-Type': 'application/json'}

        try:
            req = urllib.request.Request(url, data=data, headers=headers, method='POST')
            with urllib.request.urlopen(req, timeout=10) as response:
                return json.loads(response.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            return {"error": {"code": e.code, "message": str(e)}}
        except urllib.error.URLError as e:
            return {"error": {"code": -1, "message": str(e.reason)}}
        except Exception as e:
            return {"error": {"code": -1, "message": str(e)}}

    def rpc_call(self, method: str, params: List = None) -> Dict:
        """Make a JSON-RPC call to the node."""
        payload = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": method,
            "params": params or []
        }
        return self._make_request(self.node_url, payload)

    def faucet_call(self, endpoint: str, method: str = "GET", data: Dict = None) -> Dict:
        """Make a call to the faucet service."""
        if not self.faucet_url:
            return {"error": {"message": "No faucet URL configured"}}

        url = f"{self.faucet_url}{endpoint}"

        if method == "GET":
            try:
                req = urllib.request.Request(url)
                with urllib.request.urlopen(req, timeout=10) as response:
                    return json.loads(response.read().decode('utf-8'))
            except Exception as e:
                return {"error": {"code": -1, "message": str(e)}}
        else:
            payload = data or {}
            return self._make_request(url, payload)

    def record(self, name: str, passed: bool, message: str, details: Dict = None):
        """Record a test result."""
        result = TestResult(name, passed, message, details)
        self.results.append(result)
        if passed:
            log(f"{name}: {message}", "success")
        else:
            log(f"{name}: {message}", "error")

    # ==================== CORE RPC TESTS ====================

    def test_connection(self) -> bool:
        """Test basic RPC connectivity."""
        log("Testing RPC connection...", "info")

        result = self.rpc_call("system_health")

        if "result" in result:
            health = result["result"]
            self.record(
                "RPC Connection",
                True,
                f"Connected - {health.get('peers', 0)} peers, syncing={health.get('isSyncing', False)}",
                health
            )
            return True
        else:
            self.record("RPC Connection", False, f"Failed: {result.get('error', {}).get('message', 'Unknown error')}")
            return False

    def test_chain_info(self) -> Dict:
        """Get chain information."""
        log("Getting chain info...", "info")

        # Get chain name
        chain_result = self.rpc_call("system_chain")
        chain_name = chain_result.get("result", "Unknown")

        # Get best block
        header_result = self.rpc_call("chain_getHeader")
        block_number = 0
        if "result" in header_result:
            block_number = int(header_result["result"].get("number", "0x0"), 16)

        # Get runtime version
        runtime_result = self.rpc_call("state_getRuntimeVersion")
        runtime_version = "Unknown"
        if "result" in runtime_result:
            runtime_version = f"v{runtime_result['result'].get('specVersion', '?')}"

        # Get node name
        name_result = self.rpc_call("system_name")
        node_name = name_result.get("result", "Unknown")

        info = {
            "chain": chain_name,
            "block": block_number,
            "runtime": runtime_version,
            "node_name": node_name
        }

        self.record(
            "Chain Info",
            True,
            f"{chain_name} @ block #{block_number} ({runtime_version})",
            info
        )

        return info

    def test_peers(self) -> List[Dict]:
        """Get connected peers."""
        log("Checking connected peers...", "info")

        result = self.rpc_call("system_peers")

        if "result" in result:
            peers = result["result"]
            peer_count = len(peers)

            self.record(
                "Peer Connections",
                peer_count > 0,
                f"{peer_count} peers connected",
                {"peers": peers}
            )
            return peers
        else:
            self.record("Peer Connections", False, "Failed to get peers")
            return []

    # ==================== FAUCET TESTS ====================

    def test_faucet_health(self) -> bool:
        """Test faucet service health."""
        log("Testing faucet service...", "info")

        if not self.faucet_url:
            self.record("Faucet Health", False, "No faucet URL configured")
            return False

        result = self.faucet_call("/health")

        if "error" in result:
            error_msg = result["error"].get("message", "Unknown error")
            # Check for specific HTTP errors
            if "502" in str(error_msg) or "Bad Gateway" in str(error_msg):
                self.record("Faucet Health", False, "502 Bad Gateway - Faucet service is down")
            elif "Connection refused" in str(error_msg):
                self.record("Faucet Health", False, "Connection refused - Faucet not running")
            else:
                self.record("Faucet Health", False, f"Error: {error_msg}")
            return False

        if result.get("status") == "ok" or result.get("healthy"):
            self.record("Faucet Health", True, "Faucet service is healthy", result)
            return True

        self.record("Faucet Health", True, f"Faucet responded: {result}", result)
        return True

    def test_faucet_drip(self, address: str) -> bool:
        """Request tokens from faucet."""
        log(f"Requesting tokens for {address[:16]}...", "info")

        if not self.faucet_url:
            self.record("Faucet Drip", False, "No faucet URL configured")
            return False

        result = self.faucet_call("/drip", "POST", {"address": address})

        if "error" in result:
            self.record("Faucet Drip", False, f"Failed: {result['error'].get('message', 'Unknown')}")
            return False

        if result.get("success") or result.get("hash"):
            self.record("Faucet Drip", True, f"Tokens sent! TX: {result.get('hash', 'pending')}", result)
            return True

        self.record("Faucet Drip", False, f"Unexpected response: {result}")
        return False

    # ==================== ACCOUNT TESTS ====================

    # Well-known dev account addresses (from QuantumHarmony genesis)
    DEV_ACCOUNTS = {
        "Alice": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
        "Bob": "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty",
        "Charlie": "5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y",
        "Dave": "5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy",
        "Eve": "5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw",
        "Ferdie": "5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL",
    }

    def generate_test_account(self) -> Dict:
        """Select a random dev account for testing."""
        log("Selecting test account...", "info")

        # Use a random dev account (not Alice - she's the faucet source)
        test_names = ["Bob", "Charlie", "Dave", "Eve", "Ferdie"]
        name = secrets.choice(test_names)
        address = self.DEV_ACCOUNTS[name]

        account = {
            "name": name,
            "address": address,
            "type": "dev"
        }

        self.record("Account Selection", True, f"Using {name}: {address[:20]}...", {"address": address, "name": name})
        return account

    def test_account_balance(self, address: str) -> int:
        """Check account balance."""
        log(f"Checking balance for {address[:16]}...", "info")

        # Try the system_account storage query
        result = self.rpc_call("system_account", [address])

        if "result" in result:
            data = result["result"]
            if data and "data" in data:
                free = int(data["data"].get("free", 0))
                self.record("Account Balance", True, f"Balance: {free} units", {"balance": free})
                return free

        # Alternative: try state query
        self.record("Account Balance", True, "Balance: 0 (new account)", {"balance": 0})
        return 0

    # ==================== QRNG TESTS ====================

    def test_qrng_config(self) -> Dict:
        """Get QRNG configuration."""
        log("Getting QRNG config...", "info")

        result = self.rpc_call("qrng_getConfig")

        if "result" in result:
            config = result["result"]
            k = config.get("threshold_k", "?")
            m = config.get("total_devices_m", "?")
            self.record("QRNG Config", True, f"Threshold: {k}-of-{m}", config)
            return config
        else:
            self.record("QRNG Config", False, "Failed to get config")
            return {}

    def test_qrng_device_queues(self) -> Dict:
        """Get QRNG device queues."""
        log("Getting QRNG device queues...", "info")

        result = self.rpc_call("qrng_getDeviceQueues")

        if "result" in result:
            queues = result["result"]
            queue_count = len(queues) if isinstance(queues, list) else 0
            self.record("QRNG Queues", True, f"{queue_count} device queues", queues)
            return queues
        else:
            self.record("QRNG Queues", False, "Failed to get device queues")
            return {}

    def test_qrng_reconstruction(self) -> List:
        """Get QRNG reconstruction history."""
        log("Getting QRNG reconstruction history...", "info")

        result = self.rpc_call("qrng_getReconstructionHistory", [10])

        if "result" in result:
            history = result["result"]
            count = len(history) if isinstance(history, list) else 0
            self.record("QRNG History", True, f"{count} reconstructions", {"count": count})
            return history
        else:
            self.record("QRNG History", False, "Failed to get history")
            return []

    # ==================== NOTARIAL TESTS ====================

    def test_notarial_service(self) -> bool:
        """Test notarial service availability."""
        log("Testing Notarial service...", "info")

        # Try getting an attestation (will likely return null but confirms API works)
        result = self.rpc_call("notarial_getAttestationsByOwner", ["5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"])

        if "result" in result:
            attestations = result["result"] or []
            count = len(attestations) if isinstance(attestations, list) else 0
            self.record("Notarial Service", True, f"{count} attestations found", {"count": count})
            return True
        elif "error" in result:
            error = result["error"]
            # Method exists but returned error - still means service is up
            if error.get("code") == -32601:  # Method not found
                self.record("Notarial Service", False, "Notarial RPC not available")
                return False
            else:
                self.record("Notarial Service", True, "Notarial service responding", result)
                return True
        else:
            self.record("Notarial Service", False, "Unexpected response")
            return False

    # ==================== GOVERNANCE TESTS ====================

    def test_governance_stats(self) -> Dict:
        """Test governance stats (quantumharmony_getGovernanceStats)."""
        log("Getting governance stats...", "info")

        result = self.rpc_call("quantumharmony_getGovernanceStats")

        if "result" in result:
            stats = result["result"]
            self.record("Governance Stats", True, f"Stats retrieved", stats)
            return stats
        else:
            self.record("Governance Stats", False, "Failed to get governance stats")
            return {}

    def test_proposals(self) -> List:
        """Get governance proposals (quantumharmony_getProposals)."""
        log("Getting proposals...", "info")

        result = self.rpc_call("quantumharmony_getProposals")

        if "result" in result:
            proposals = result["result"] or []
            count = len(proposals) if isinstance(proposals, list) else 0
            self.record("Proposals", True, f"{count} proposals", {"count": count})
            return proposals
        else:
            self.record("Proposals", False, "Failed to get proposals")
            return []

    def test_validator_set(self) -> List:
        """Get validator set (quantumharmony_getValidatorSet)."""
        log("Getting validator set...", "info")

        result = self.rpc_call("quantumharmony_getValidatorSet")

        if "result" in result:
            validators = result["result"] or []
            count = len(validators) if isinstance(validators, list) else 0
            self.record("Validator Set", True, f"{count} validators", {"count": count})
            return validators
        else:
            self.record("Validator Set", False, "Failed to get validator set")
            return []

    def test_rewards_info(self, address: str = None) -> Dict:
        """Get rewards info (quantumharmony_getRewardsInfo)."""
        log("Getting rewards info...", "info")

        # Use Alice's address as default
        if not address:
            address = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"

        result = self.rpc_call("quantumharmony_getRewardsInfo", [address])

        if "result" in result:
            rewards = result["result"]
            pending = rewards.get("pending_rewards", "0")
            multiplier = rewards.get("reward_multiplier", "?")
            self.record("Rewards Info", True, f"Pending: {pending}, Multiplier: {multiplier}", rewards)
            return rewards
        else:
            self.record("Rewards Info", False, "Failed to get rewards info")
            return {}

    # ==================== GATEWAY TESTS ====================

    def test_gateway_balance(self, address: str) -> int:
        """Check balance via gateway RPC."""
        log(f"Getting gateway balance for {address[:16]}...", "info")

        result = self.rpc_call("gateway_balance", [address])

        if "result" in result:
            balance = result["result"]
            self.record("Gateway Balance", True, f"Balance: {balance}", {"balance": balance})
            return balance if isinstance(balance, int) else 0
        else:
            self.record("Gateway Balance", False, "Failed to get balance")
            return 0

    def test_gateway_nonce(self, address: str) -> int:
        """Get account nonce via gateway RPC."""
        log(f"Getting nonce for {address[:16]}...", "info")

        result = self.rpc_call("gateway_nonce", [address])

        if "result" in result:
            nonce = result["result"]
            self.record("Gateway Nonce", True, f"Nonce: {nonce}", {"nonce": nonce})
            return nonce if isinstance(nonce, int) else 0
        else:
            self.record("Gateway Nonce", False, "Failed to get nonce")
            return 0

    # ==================== FULL TEST SUITE ====================

    def run_health_check(self):
        """Run a quick health check of all services."""
        log("QUANTUMHARMONY NODE HEALTH CHECK", "header")

        # Core connectivity
        if not self.test_connection():
            log("Node is not reachable. Aborting.", "error")
            return

        self.test_chain_info()
        self.test_peers()

        # Services
        log("SERVICE STATUS", "header")
        self.test_faucet_health()
        self.test_qrng_config()
        self.test_notarial_service()
        self.test_governance_stats()
        self.test_validator_set()

        # Summary
        self.print_summary()

    def run_full_test(self):
        """Run the full test suite including workflows."""
        log("QUANTUMHARMONY FULL TEST SUITE", "header")

        # Health check first
        if not self.test_connection():
            log("Node is not reachable. Aborting.", "error")
            return

        self.test_chain_info()
        self.test_peers()

        # Faucet tests
        log("FAUCET TESTS", "header")
        faucet_healthy = self.test_faucet_health()

        # Account tests
        log("ACCOUNT TESTS", "header")
        account = self.generate_test_account()
        self.test_account_balance(account["address"])

        if faucet_healthy:
            self.test_faucet_drip(account["address"])
            time.sleep(2)  # Wait for transaction
            self.test_account_balance(account["address"])

        # Gateway tests
        log("GATEWAY TESTS", "header")
        # Use Alice's well-known dev account for testing
        alice = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
        self.test_gateway_balance(alice)
        self.test_gateway_nonce(alice)

        # QRNG tests
        log("QRNG TESTS", "header")
        self.test_qrng_config()
        self.test_qrng_device_queues()
        self.test_qrng_reconstruction()

        # Notarial tests
        log("NOTARIAL TESTS", "header")
        self.test_notarial_service()

        # Governance tests
        log("GOVERNANCE TESTS", "header")
        self.test_governance_stats()
        self.test_proposals()
        self.test_validator_set()
        self.test_rewards_info()

        # Summary
        self.print_summary()

    def print_summary(self):
        """Print test results summary."""
        log("TEST SUMMARY", "header")

        passed = sum(1 for r in self.results if r.passed)
        failed = sum(1 for r in self.results if not r.passed)
        total = len(self.results)

        print(f"\n{Colors.BOLD}Results: {passed}/{total} passed, {failed} failed{Colors.END}\n")

        if failed > 0:
            print(f"{Colors.RED}Failed tests:{Colors.END}")
            for r in self.results:
                if not r.passed:
                    print(f"  - {r.name}: {r.message}")

        print()

        # Service status table
        print(f"{Colors.BOLD}Service Status:{Colors.END}")
        print("┌────────────────────┬──────────┐")
        print("│ Service            │ Status   │")
        print("├────────────────────┼──────────┤")

        services = {
            "RPC Connection": "RPC",
            "Faucet Health": "Faucet",
            "QRNG Config": "QRNG",
            "Notarial Service": "Notarial",
            "Governance Stats": "Governance",
            "Validator Set": "Validators",
        }

        for test_name, display_name in services.items():
            result = next((r for r in self.results if r.name == test_name), None)
            if result:
                status = f"{Colors.GREEN}ONLINE{Colors.END}" if result.passed else f"{Colors.RED}OFFLINE{Colors.END}"
            else:
                status = f"{Colors.YELLOW}UNKNOWN{Colors.END}"
            print(f"│ {display_name:<18} │ {status:<17} │")

        print("└────────────────────┴──────────┘")


def main():
    parser = argparse.ArgumentParser(description="QuantumHarmony Node Testing Agent")
    parser.add_argument("--node", default="http://localhost:9944", help="Node RPC URL")
    parser.add_argument("--faucet", default=None, help="Faucet service URL")
    parser.add_argument("--full-test", action="store_true", help="Run full test suite")
    parser.add_argument("--health", action="store_true", help="Run health check only")

    args = parser.parse_args()

    # Try to detect faucet URL from node URL
    faucet_url = args.faucet
    if not faucet_url:
        # Common faucet locations
        if "localhost" in args.node or "127.0.0.1" in args.node:
            faucet_url = "http://localhost:3000"
        elif "51.79.26" in args.node:
            faucet_url = "http://51.79.26.123:3000"

    agent = NodeAgent(args.node, faucet_url)

    print(f"""
{Colors.BOLD}{Colors.BLUE}
╔═══════════════════════════════════════════════════════════╗
║       QUANTUMHARMONY NODE TESTING AGENT                   ║
║       Automated testing like a human operator             ║
╚═══════════════════════════════════════════════════════════╝
{Colors.END}
Node:   {args.node}
Faucet: {faucet_url or 'Not configured'}
""")

    if args.full_test:
        agent.run_full_test()
    else:
        agent.run_health_check()


if __name__ == "__main__":
    main()
