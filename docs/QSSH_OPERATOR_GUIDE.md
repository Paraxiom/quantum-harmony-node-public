# QSSH Operator Guide

## Quantum-Secure Remote Node Access

This guide explains how operators can securely connect to their QuantumHarmony validator nodes running on cloud infrastructure using QSSH (Quantum-Secure Shell).

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         OPERATOR FLOW                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   LOCAL MACHINE                          CLOUD VALIDATOR                 │
│   ─────────────                          ───────────────                 │
│                                                                          │
│   ┌──────────────┐      QSSH Tunnel      ┌──────────────┐              │
│   │  Dashboard   │◄══════════════════════►│  QSSH-RPC    │              │
│   │  :8080       │   Falcon-512/SPHINCS+  │  :42         │              │
│   └──────┬───────┘                        └──────┬───────┘              │
│          │                                       │                       │
│          ↓                                       ↓                       │
│   ┌──────────────┐                       ┌──────────────┐              │
│   │  localhost   │                       │  Validator   │              │
│   │  :9944       │                       │  Node :9944  │              │
│   └──────────────┘                       └──────────────┘              │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

### 1. Install QSSH on Your Local Machine

```bash
# Clone the QSSH repository
git clone https://github.com/Paraxiom/qssh.git
cd qssh

# Build and install
cargo build --release
cargo install --path .

# Verify installation
qssh --version
```

### 2. Generate Quantum-Safe Keys

```bash
# Generate Falcon-512 key pair (for key exchange)
qssh-keygen -t falcon -f ~/.qssh/operator_falcon

# Generate SPHINCS+ key pair (for signatures)
qssh-keygen -t sphincs -f ~/.qssh/operator_sphincs
```

### 3. Register Your Public Key with the Validator

Copy your public key to the validator's authorized keys:

```bash
# Display your public key
cat ~/.qssh/operator_falcon.pub

# Add to validator's authorized keys (via existing SSH or admin interface)
ssh admin@your-validator.cloud "echo 'YOUR_PUBLIC_KEY' >> ~/.qssh/authorized_keys"
```

## Connecting to Your Validator

### Step 1: Establish QSSH Tunnel

```bash
# Connect to your validator with port forwarding
qssh -L 9944:localhost:9944 operator@your-validator.cloud:42

# This creates a quantum-secure tunnel:
# - Local port 9944 → forwarded through QSSH → Validator's port 9944
```

### Step 2: Start the Dashboard

In a separate terminal:

```bash
cd quantum-harmony-node
./start.sh ui
```

### Step 3: Connect Dashboard to Node

1. Open http://localhost:8080 in your browser
2. In the endpoint input field, enter: `localhost:9944`
3. Click **CONNECT**

The dashboard will now communicate with your cloud validator through the quantum-secure QSSH tunnel.

## Security Features

### Post-Quantum Cryptography

QSSH uses NIST-approved post-quantum algorithms:

| Component | Algorithm | Security Level |
|-----------|-----------|----------------|
| Key Exchange | Falcon-512 | NIST Level 1 |
| Signatures | SPHINCS+-SHAKE-256f | NIST Level 5 |
| Encryption | AES-256-GCM | 256-bit |

### Why QSSH?

Traditional SSH (RSA/ECDSA) is vulnerable to quantum attacks:

- **Shor's Algorithm**: Can break RSA-2048 and ECDSA in polynomial time
- **Timeline**: Cryptographically-relevant quantum computers expected by 2030-2035
- **Harvest Now, Decrypt Later**: Adversaries may be storing encrypted traffic today

QSSH protects your validator connections **today** against future quantum threats.

## Advanced Usage

### Multiple Validators

```bash
# Connect to multiple validators with different local ports
qssh -L 9944:localhost:9944 operator@alice.validator:42 &
qssh -L 9945:localhost:9944 operator@bob.validator:42 &
qssh -L 9946:localhost:9944 operator@charlie.validator:42 &
```

### Persistent Connection

Use a systemd service for always-on tunnel:

```ini
# /etc/systemd/user/qssh-validator.service
[Unit]
Description=QSSH Tunnel to Validator
After=network.target

[Service]
ExecStart=/usr/local/bin/qssh -L 9944:localhost:9944 -N operator@your-validator.cloud:42
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable qssh-validator
systemctl --user start qssh-validator
```

### QKD Integration (Optional)

For maximum security with hardware quantum key distribution:

```bash
qssh -L 9944:localhost:9944 \
     --qkd \
     --qkd-endpoint https://qkd-device.local/api/v1 \
     operator@your-validator.cloud:42
```

## Troubleshooting

### Connection Refused

```bash
# Check if QSSH server is running on validator
ssh admin@your-validator.cloud "docker logs charlie-validator | grep QSSH"
```

### Key Authentication Failed

```bash
# Verify key is in authorized_keys
ssh admin@your-validator.cloud "cat ~/.qssh/authorized_keys"

# Check key permissions
chmod 600 ~/.qssh/operator_falcon
chmod 644 ~/.qssh/operator_falcon.pub
```

### Tunnel Not Working

```bash
# Test tunnel locally
curl -s -X POST -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"system_health","params":[],"id":1}' \
     http://localhost:9944
```

## Dashboard Endpoint Input

The dashboard includes an endpoint input field in the header bar. This allows operators to:

1. **Local Node**: Leave blank or enter `/rpc` to use the local nginx proxy
2. **QSSH Tunnel**: Enter `localhost:9944` (or custom port) when using QSSH tunnel
3. **Direct Connection**: Enter `http://your-validator:9944` (not recommended - use QSSH)

The endpoint is saved to localStorage for persistence across sessions.

## References

- [QSSH Repository](https://github.com/Paraxiom/qssh)
- [QSSH Integration Guide](../qssh/QUANTUM_HARMONY_INTEGRATION.md)
- [Post-Quantum Cryptography Overview](./MD/CRYPTOGRAPHIC_ARCHITECTURE_COMPLETE.md)

---

*For support, visit https://github.com/Paraxiom/quantum-harmony-node/issues*
