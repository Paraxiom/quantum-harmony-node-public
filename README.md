# QuantumHarmony Node Operator

Run a QuantumHarmony node with one command using Docker.

**QuantumHarmony** is a post-quantum Layer 1 blockchain secured with SPHINCS+ and Falcon-512 signatures — 950 Rust tests, 32 Lean 4 theorems, zero sorries.

## Prerequisites

**Install Docker:**

- **Mac**: [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/)
- **Windows**: [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/)
- **Linux**:
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  # Log out and back in
  ```

Verify installation:

```bash
docker --version
docker-compose --version
```

## System Requirements

| Resource    | Minimum   | Recommended |
| ----------- | --------- | ----------- |
| **RAM**     | 8 GB      | 16 GB       |
| **Swap**    | 4 GB      | 4-8 GB      |
| **Disk**    | 20 GB SSD | 50 GB SSD   |
| **CPU**     | 2 cores   | 4 cores     |
| **Network** | 10 Mbps   | 100 Mbps    |

**Notes:**

- SSD strongly recommended for sync performance
- Swap space helps prevent OOM crashes during sync
- Chain data grows over time (~10GB currently)
- Higher bandwidth speeds up initial sync

## Quick Start

```bash
# Clone the repo
git clone https://github.com/Paraxiom/quantum-harmony-node-public.git
cd quantum-harmony-node-public

# Run setup (installs QSSH, generates keys)
./setup.sh

# Start with one command — node + dashboard come up together
./start.sh
```

The operator dashboard launches automatically at **http://localhost:8080**.

### Start Options

| Command | What it does |
| --- | --- |
| `./start.sh` | Node + LCARS dashboard (default) |
| `./start.sh --bootstrap` | Download chain snapshot first, then start (recommended for first-time setup) |
| `./start.sh --full` | Full stack: node + dashboard + faucet + KYC + QRNG (requires `.env`) |

### Manual Start

```bash
docker-compose -f docker-compose.operator.yml up -d
docker-compose -f docker-compose.operator.yml logs -f
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  NODE OPERATOR STACK                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   ┌──────────────────┐    ┌──────────────────────────┐  │
│   │  QuantumHarmony  │    │    LCARS Dashboard       │  │
│   │      Node        │    │    (port 8080)           │  │
│   │   (port 9944)    │    └──────────────────────────┘  │
│   └────────┬─────────┘                                   │
│            │                                             │
│   ┌────────▼─────────────────────────────────────────┐  │
│   │              Nginx Reverse Proxy                  │  │
│   │           (ports 80, 443)                         │  │
│   └──────────────────────────────────────────────────┘  │
│                                                          │
├─────────────────────────────────────────────────────────┤
│   SPHINCS+-256s POST-QUANTUM SECURED                     │
└─────────────────────────────────────────────────────────┘
```

## Services

| Service   | Port   | Description            |
| --------- | ------ | ---------------------- |
| node      | 9944   | RPC/WebSocket endpoint |
| node      | 30333  | P2P networking         |
| node      | 9615   | Prometheus metrics     |
| dashboard | 8080   | Operator web UI        |
| nginx     | 80/443 | Reverse proxy          |

## LCARS Dashboard Guide

The dashboard launches automatically at **http://localhost:8080** when you run `./start.sh`. It's a Star Trek LCARS-styled operator interface with 12 tabs:

| Tab | What it does |
| --- | --- |
| **STATUS** | Block height, peer count, sync progress, finalized head. Check here first to confirm your node is syncing. |
| **TRANSFER** | Send QMHY tokens to any address. Paste your account key to sign transactions. |
| **FAUCET** | Request test tokens for your account. Click once, wait for confirmation. |
| **GOVERN** | On-chain governance: view proposals, vote, submit motions. |
| **REWARDS** | Track your validator rewards and staking performance. |
| **RUNTIME** | Runtime version info and upgrade status. |
| **KEYS** | Generate session keys, check keystore, rotate keys. Essential for validator setup. |
| **QUANTUM** | Post-quantum security status — SPHINCS+/Falcon key health and algorithm info. |
| **NETWORK** | Live peer map, connection topology, bootnode status. |
| **SIGNALS** | Network signals and event stream. |
| **PROOFS** | On-chain proof verification and attestation status. |
| **QUESTS** | Gamified onboarding (Devonomics) — earn QMHY by completing validator milestones. |
| **SETTINGS** | Node name, RPC endpoint, display preferences. |

### First-time walkthrough

1. Open **http://localhost:8080**
2. Check **STATUS** — wait until sync progress shows blocks increasing
3. Go to **KEYS** → click **CHECK KEYSTORE** to see current state
4. Go to **FAUCET** → request test tokens
5. Go to **KEYS** → **ROTATE SESSION KEYS** to generate your validator keys
6. Send your account address, peer ID, and session keys to the network admin (see [Become a Validator](#become-a-validator) below)

### Coming soon: Agent Mode

We're building an autonomous node operator agent that monitors health, handles upgrades, and manages governance actions — with a dashboard approval flow for critical decisions. Stay tuned.

## Devonomics: Gamified Onboarding

Earn QMHY tokens by completing quests. Your node is your character.

| Quest      | Action                 | Reward   |
| ---------- | ---------------------- | -------- |
| Genesis    | Node syncs to network  | 100 QMHY |
| Identity   | Generate session keys  | 50 QMHY  |
| Registered | Create account         | 25 QMHY  |
| Connected  | 3+ peers connected     | 50 QMHY  |
| Voice      | Post to validator chat | 25 QMHY  |
| Producer   | Author first block     | 200 QMHY |
| Quantum    | Use QRNG entropy       | 100 QMHY |

**Tiers:**

- Bronze: 0-249 QMHY
- Silver: 250-549 QMHY
- Gold: 550-999 QMHY
- Platinum: 1000+ QMHY

See [DEVONOMICS.md](DEVONOMICS.md) for full details.

## Configuration

### Environment Variables

Create a `.env` file:

```bash
NODE_NAME=MyNode
```

### Custom Chain Spec

Replace `configs/chain-spec.json` with your chain spec.

## Network

**Production Testnet Bootnodes:**

- Alice: `51.79.26.123`
- Bob: `51.79.26.168`
- Charlie: `209.38.225.4`

**Ports Required:**

- `30333` - P2P (must be open for peers)
- `9944` - RPC (optional, for external access)

## Commands

```bash
# Start all services
./start.sh
# or: docker-compose up -d

# Stop all services
docker-compose down

# View node logs
docker-compose logs -f node

# Restart node only
docker-compose restart node

# Check status
docker-compose ps
```

## Become a Validator

Follow these steps to join the network as a validator:

### Step 1: Start Your Node

```bash
git clone https://github.com/Paraxiom/quantum-harmony-node-public.git
cd quantum-harmony-node-public
docker-compose up -d
```

Wait for sync to complete (check dashboard at http://localhost:8080 - STATUS tab shows sync progress).

### Step 2: Create Your Account

1. Open http://localhost:8080
2. Go to **KEYS** section
3. Click **CREATE ACCOUNT**
4. **SAVE YOUR MNEMONIC** - it will only be shown once!
5. Your address appears in the header

### Step 3: Get Test Tokens

1. Go to **FAUCET** section
2. Click to request QMHY tokens
3. Wait for confirmation

### Step 4: Generate Session Keys

1. Go to **KEYS** section
2. Click **GENERATE NEW KEY**
3. Copy the session keys (public key)

### Step 5: Get Your Peer ID

Run this command:

```bash
curl -s localhost:9944 -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"system_localPeerId"}' | jq -r .result
```

### Step 6: Register with Network

Send to the network admin:

- Your account address
- Your peer ID
- Your session keys (public key)

They will register you in the validator set.

### Step 7: Verify

Once registered, your node will start producing blocks. Check:

- **STATUS** tab shows "Validator" role
- **NETWORK** tab shows your node in the mesh

---

## QSSH: Quantum-Secure Remote Access

**QSSH is required for post-quantum security.** Without QSSH, connections use classical cryptography vulnerable to quantum attacks.

### Install QSSH

```bash
git clone https://github.com/Paraxiom/qssh.git
cd qssh
cargo build --release
cargo install --path .
```

### Generate Keys

```bash
qssh-keygen -t falcon -f ~/.qssh/operator_falcon
qssh-keygen -t sphincs -f ~/.qssh/operator_sphincs
```

### Connect to Your Cloud Validator

```bash
# Create quantum-secure tunnel
qssh -L 9944:localhost:9944 operator@your-validator.cloud:42

# In another terminal, start dashboard
./start.sh ui

# Enter "localhost:9944" in the dashboard endpoint field
```

### Security

| Component    | Algorithm     | Protection   |
| ------------ | ------------- | ------------ |
| Key Exchange | Falcon-512    | Post-quantum |
| Signatures   | SPHINCS+-256f | Hash-based   |
| Encryption   | AES-256-GCM   | Symmetric    |

Traditional SSH (RSA/ECDSA) is vulnerable to quantum attacks. QSSH protects your validator connections today against future quantum computers.

See [docs/QSSH_OPERATOR_GUIDE.md](docs/QSSH_OPERATOR_GUIDE.md) for complete instructions.

---

## Cleanup

To completely remove all containers, images, and data:

```bash
# Stop and remove containers
docker-compose down

# Remove the Docker image (to force fresh pull)
docker rmi sylvaincormier/quantumharmony-node:latest

# Remove all data (WARNING: deletes chain data!)
docker volume rm quantum-harmony-node_node-data

# Full reset - remove everything
docker-compose down -v --rmi all
```

## Troubleshooting

### Node ignoring changes to `chain-spec.json`

If you modify your configuration file but the node continues to throw old errors, Docker may be using a cached volume. Force a fresh state by wiping the volumes:

```bash
docker-compose down -v
docker-compose up -d
```

## License

Apache-2.0
