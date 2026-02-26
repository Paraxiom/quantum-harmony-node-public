# Become a QuantumHarmony Validator

This guide explains how to join the QuantumHarmony testnet as a validator.

## Overview

QuantumHarmony uses **governance-based validator admission**. New validators must be approved by existing validators before they can produce blocks.

**Process:**
1. Run your node and sync with the network
2. Generate your unique SPHINCS+ session key
3. Submit your public key for governance approval
4. Wait for validator vote (typically 24-48 hours)
5. After approval, you'll become active at the next session rotation

---

## Step 1: Start Your Node

```bash
git clone https://github.com/Paraxiom/quantum-harmony-node.git
cd quantum-harmony-node
./start.sh
```

Wait for your node to sync. Check the dashboard at http://localhost:8080

**Sync Status:**
- Block height should match the network (~increasing every 6 seconds)
- "Syncing: No" means you're caught up
- 2-3 peers connected is normal

---

## Step 2: Generate Session Key

### Option A: Via Dashboard (Recommended)

1. Open http://localhost:8080
2. Go to **Key Management** section
3. Click **Generate New Key**
4. Copy your **Session Key** (64-byte public key starting with `0x`)

### Option B: Via RPC

```bash
curl -s http://localhost:9944 \
  -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"author_rotateKeys","params":[]}' \
  | jq -r '.result'
```

**Important:** Your secret key is automatically stored in the node's keystore. Never share your secret key.

---

## Step 3: Submit Governance Proposal

Use the **Validator Governance** panel in your dashboard:

1. Open http://localhost:8080
2. Go to **Validator Governance** tab
3. Enter your session key in "Validator Account (Public Key)"
4. Select your signing key in "Sign As"
5. Click **Propose**

Alternatively, ask an existing validator to propose you:
- **Telegram Dev Channel:** https://t.me/+dg3-c2KFfd1iMTUx
- **Email:** sylvain@paraxiom.org

---

## Step 4: Validator Voting

After proposal submission:

1. Existing validators see your proposal in their governance panel
2. They review and vote YES/NO
3. Voting window: 10 blocks (~1 minute) - but response time depends on validator availability
4. After voting period ends, anyone can click **Finalize**
5. If approved (majority yes votes), your key is added to the pending set

**Note:** Validator response time varies. Join the Telegram channel for faster coordination.

---

## Step 5: Activation

After governance approval, your validator activates at the **next session rotation**.

- Sessions rotate every ~6 hours
- Check your logs for: `Number of authorities: 4` (or higher)
- When active, you'll see: `Claimed slot for block #XXX`

**Verify you're active:**
```bash
docker logs quantumharmony-node 2>&1 | grep "Claimed slot"
```

---

## Troubleshooting

### "Key not found in keystore"
This is **normal** until your validator is activated. It means:
- Your node is checking if it should author blocks
- Your key isn't in the active set yet
- Wait for session rotation after governance approval

### Node not syncing
- Check peers: `curl http://localhost:9944 -d '{"id":1,"jsonrpc":"2.0","method":"system_health"}'`
- Ensure port 30333 is open for P2P
- Try restarting: `docker-compose restart node`

### Genesis mismatch
If your genesis hash doesn't match the network:
```bash
git pull
docker-compose down -v
./start.sh
```

---

## Current Network

**Production Validators:**
| Validator | Location | Status |
|-----------|----------|--------|
| Validator 1 | Montreal, CA | Active |
| Validator 2 | Beauharnois, CA | Active |
| Validator 3 | Frankfurt, DE | Active |

**Genesis Hash:** `0xc18cc638862625ae46879052e3fcff864a1ae408a8166b65934ce7e153b8b5e1`

---

## Questions?

- Telegram Dev Channel: https://t.me/+dg3-c2KFfd1iMTUx
- GitHub Issues: https://github.com/Paraxiom/quantum-harmony-node/issues
- Email: sylvain@paraxiom.org
