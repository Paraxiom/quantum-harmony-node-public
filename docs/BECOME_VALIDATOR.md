# QuantumHarmony Validator Onboarding Guide

**Last Verified:** 2026-04-15/16 (tested with Kria + Edwin)

## PREREQUISITES
- **OS:** Linux (Ubuntu 22.04 recommended) or macOS with Docker
- **Hardware:** 4+ CPU cores, 8GB+ RAM, 100GB+ SSD
- **Network:** Public IP with port `30333` open (or NAT traversal configured)
- **Tools:** Docker installed

---

## STEP-BY-STEP VALIDATOR ONBOARDING

### 1. Clone the Node Repository
```bash
git clone https://github.com/Paraxiom/quantum-harmony-node-public.git
cd quantum-harmony-node-public
```

---

### 2. Generate SPHINCS+ Keypair (Locally)
**Never expose your secret key.**
```bash
docker run --rm rust:1.85-bookworm bash -c '
  cargo init --bin /tmp/keygen && cd /tmp/keygen
  # Add dependencies to Cargo.toml:
  # pqcrypto-sphincsplus = "0.8.0"
  # hex = "0.4.3"
  # main.rs: Generate keypair, print public to stdout, secret to stderr
  cargo run --release 2>secret.txt
'
```
- **Public key:** Sent to Paraxiom
- **Secret key:** `secret.txt` (keep it secure!)

---

### 3. Install Secret Key in Keystore
```bash
VOLPATH=$(docker volume inspect quantum-harmony-node_node-data --format '{{.Mountpoint}}')
sudo mkdir -p "$VOLPATH/chains/dev3/keystore"
KEYSTORE="$VOLPATH/chains/dev3/keystore/61757261<YOUR_64_BYTE_PUBKEY_HEX>"
echo -n '"0x<YOUR_128_BYTE_SECRET_HEX>"' | sudo tee "$KEYSTORE" > /dev/null
sudo chmod 600 "$KEYSTORE"
sudo chown -R 1000:1000 "$VOLPATH/chains"
```

---

### 4. Submit Public Key to Paraxiom
Send **only** your public key to:
- Email: `sylvaincormier@protonmail.com`
- OR: GitHub issue on [quantum-harmony-node-public](https://github.com/Paraxiom/quantum-harmony-node-public)

Paraxiom will execute:
- `validator_set.addValidator(your_account)`
- `session.setKeys(your_aura_pubkey)`

---

### 5. Fetch Chainspec and Start Node
```bash
curl -L -o configs/chain-spec.json https://paraxiom.org/chainspec.json
sha256sum configs/chain-spec.json  # Must match: dc35f7582f88e320528516167ed26989fa5611a99495be2432d5370003defee6
NODE_NAME=YourName ./start.sh
```

---

### 6. Wait for Activation
- **Activation delay:** 2 session boundaries (~12 hours)
- Monitor logs:
  ```bash
  docker logs -f quantumharmony-node 2>&1 | grep "CLAIMED"
  ```
- **Success:** `"CLAIMED SLOT"` indicates block production.

---

## IMPORTANT SECURITY NOTES
- 🔒 **Secret Key Security:** Never share or store secret keys in unsecured locations.
- 🛡️ **Validator Flag:** Ensure `--validator` is set (handled by `start.sh`).
- ⏳ **Session Period:** 7200 blocks (~6 hours). Activation takes ~12 hours.
- 🌐 **NAT Configuration:** Use `--public-addr` if behind NAT.

---

## References
- [Validator Requirements Update Protocol](https://internal.paraxiom.org/procedures/9a452366-7a06-4a45-bd1b-42f109e64be1)
- [SPHINCS+ Cryptographic Standards](https://pqcrypto.org/sphincsplus/)
