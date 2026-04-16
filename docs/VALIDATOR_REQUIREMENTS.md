# QuantumHarmony Validator Requirements (Testnet)

**Chain ID**: dev3  
**Genesis Hash**: 0x756386bd90fa820d3a8cdfeecbf86f37754b17369c01bac6b9647bf8a178bc5c  
**Runtime**: v33 (spec_version 33)  
**Last Updated**: 2026-04-16  

---

## Current Validator Set
| Operator | Location | Provider | Status |
|----------|----------|----------|--------|
| Alice | Montreal | OVH | Active |
| Bob | Beauharnois | OVH | Active |
| Charlie | Frankfurt | DigitalOcean | Active |
| Kria | Accra | Community | Active |
| Edwin | Accra | Community | Active |

---

## Core Requirements

### Consensus Protocol
- **Algorithm**: Aura with SPHINCS+-SHAKE-256f-simple signatures
  - Public key size: 64 bytes
  - Signature size: 49,856 bytes
- **Block Finality**: Proof of Coherence (replaces GRANDPA)
- **Block Time**: 3 seconds
- **Session Period**: 7200 blocks (~6 hours)

### Cryptographic Standards
- **Block Hashing**: Keccak-256
- **PQC Transport**: DISABLED (classical Noise with Ed25619)
- **Planned**: ML-KEM-1024 (disabled via `DISABLE_PQC_TRANSPORT=1`)

---

## Hardware Requirements
- **Minimum**: 
  - 4 CPU cores
  - 8GB RAM
  - 100GB SSD
- **Recommended Cloud Options**:
  - OVH B2-15: ~$30/month
  - DigitalOcean/Linode/Vultr: ~$48/month

---

## Onboarding Process

1. **Key Generation**:
   - Generate SPHINCS+ keypair locally using `pqcrypto-sphincsplus` crate
   - Store secret key securely on operator machine

2. **Key Installation**:
   - Place public key in keystore: `/data/chains/dev3/keystore/61757261{pubkey_hex}`
   - NEVER expose private key to external systems

3. **Validator Registration**:
   - Sudo holder submits:
     ```rust
     validator_set.addValidator(account)
     sudoAs(account, session.setKeys(aura_pubkey))
     ```

4. **Node Activation**:
   - Start node with `--validator` flag
   - Waiting period: 2 session boundaries (~12 hours) for activation

---

## Network Configuration

**Bootnodes**:
- Alice: `/ip4/51.79.26.123/tcp/30333/p2p/12D3KooWFZUzy2DjKEPsRsnSxUjTwrkuLjQ6Mq53KKixHVSuq59A`
- Bob: `/ip4/51.79.26.168/tcp/30333/p2p/12D3KooWBu3YCQaKegjYqcigpoCMid8emDryvDo2Ld46UEySeHhe`
- Charlie: `/ip4/209.38.225.4/tcp/30333/p2p/12D3KooWHHixshw8E1pF3tMvAVCjN8ghQERzGTtmMuWrkRc4jwY2`

---

## Security Disclosures

**Post-Quantum Protections**:
- Full SPHINCS+ implementation (NIST Level 5)
- Coherence Shield: Falcon-512 attestation (optional for AI nodes)

**Known Limitations**:
- PQC P2P transport DISABLED (handshake race condition)
- Quantum key-exchange DISABLED (peer-ban cascade risk)
- No staking implementation
- No slashing implementation

---

## Appendix

**Token Info**:
- Symbol: QMHY
- Decimals: 18

**Network Status**:
- CURRENTLY TESTNET
- Mainnet transition criteria not yet defined
