# QuantumHarmony Key Backup & Recovery

## Critical Information

**Your validator keys are CUSTOM GENERATED (not standard Substrate dev keys).**

This means:
- Standard `//Alice`, `//Bob`, `//Charlie` mnemonics will NOT work
- You must have backups of the actual private keys
- If keys are lost, those validator slots cannot be recovered

## Key Types

QuantumHarmony uses **SPHINCS+ post-quantum signatures**:

| Type | Size | Purpose |
|------|------|---------|
| Secret Key | 128 bytes (256 hex) | Signing (NEVER share) |
| Public Key | 64 bytes (128 hex) | Verification (safe to share) |
| Seed | 48 bytes (96 hex) | Can derive secret key |

## Validator Accounts

| Validator | SS58 Address | Location |
|-----------|--------------|----------|
| Alice | `5HDjAbVHMuJzezSccj6eFrEA6nKjonrFRm8h7aTiJXSHP5Qi` | Montreal, OVH |
| Bob | `5CAgvufYLRan7pybcGWqTxsxXRAj922Qep6UJmZuVWu8Uv11` | Beauharnois, OVH |
| Charlie | `5En9M95WwS354QWCM29UyFLsdQgXZ8WzdBvmHa3u6w1bmTS1` | Frankfurt, DO |

## Keystore Location

Keys are stored in the node's keystore directory:
```
/data/chains/<chain-id>/keystore/
```

Each key file is named with the key type and public key hash.

## Backup Procedure

### 1. Backup Keystore Files

```bash
# SSH to each validator
ssh -i ~/.ssh/ovh_simple ubuntu@51.79.26.123

# Create encrypted backup of keystore
cd quantumharmony
tar czf - data/chains/*/keystore | gpg -c > keystore-backup-alice-$(date +%Y%m%d).tar.gz.gpg

# Transfer to secure location
scp keystore-backup-*.gpg secure-backup-server:/backups/
```

### 2. Export Session Keys (if needed)

```bash
# Via RPC (must have --rpc-methods=Unsafe)
curl -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"author_rotateKeys","params":[]}' \
  http://localhost:9944
```

**Warning**: `author_rotateKeys` generates NEW keys. Only use if intentionally rotating.

### 3. Document Key Mapping

Keep a secure offline record mapping:
- Validator name → SS58 address → Key file hash
- Do NOT store secret keys in plain text
- Use hardware security module (HSM) if possible

## Recovery Procedure

### If Keystore Lost But Have Backup

```bash
# Restore keystore backup
gpg -d keystore-backup-alice.tar.gz.gpg | tar xzf -

# Move to correct location
mv keystore data/chains/<chain-id>/

# Restart node
./start-validator.sh
```

### If Keys Completely Lost

**This is a catastrophic scenario.** Options:

1. **If seed phrase exists**: Derive keys from seed
2. **If other validators exist**: Add new validator via governance
3. **If no recovery possible**: That validator slot is permanently lost

### Adding Replacement Validator

If a validator key is lost, add a new validator via governance:

1. Generate new SPHINCS+ keypair
2. Submit `proposeValidator` extrinsic
3. Other validators vote to approve
4. New validator joins after approval

## Security Best Practices

1. **Offline Backups**: Store encrypted backups offline
2. **Multiple Locations**: Keep backups in 2+ geographic locations
3. **Regular Testing**: Periodically verify backups can be restored
4. **Access Control**: Limit who can access key backups
5. **Audit Trail**: Log all key access and operations

## Emergency Contacts

If you lose access to keys and need help:
- Network admin: [contact info]
- Backup location 1: [info]
- Backup location 2: [info]

## Verification Commands

Check if node has valid keys:

```bash
# Check keystore files exist
ls -la data/chains/*/keystore/

# Check node recognizes keys (via RPC)
curl -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"author_hasSessionKeys","params":["<session_keys_hex>"]}' \
  http://localhost:9944
```

---

**Remember**: In post-quantum cryptography, key sizes are larger but security is stronger.
Handle these keys with the same care as any cryptographic secret material.
