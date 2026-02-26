/**
 * QuantumHarmony Keystore Manager
 * Handles key management via RPC methods
 */

class KeystoreManager {
    constructor(rpcEndpoint = 'http://127.0.0.1:9944') {
        this.rpcEndpoint = rpcEndpoint;
        this.cachedKeys = [];
    }

    async rpc(method, params = []) {
        const res = await fetch(this.rpcEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
        });
        const data = await res.json();
        if (data.error) {
            throw new Error(data.error.message || JSON.stringify(data.error));
        }
        return data.result;
    }

    /**
     * Check if node has keys in keystore
     * Uses author_hasKey RPC
     */
    async hasKey(publicKey, keyType = 'aura') {
        try {
            const result = await this.rpc('author_hasKey', [publicKey, keyType]);
            return result === true;
        } catch (e) {
            console.error('hasKey error:', e);
            return false;
        }
    }

    /**
     * Check if node has any session keys
     */
    async hasSessionKeys(keys) {
        try {
            const result = await this.rpc('author_hasSessionKeys', [keys]);
            return result === true;
        } catch (e) {
            console.error('hasSessionKeys error:', e);
            return false;
        }
    }

    /**
     * Insert a key into the keystore
     * Uses author_insertKey RPC
     * @param {string} keyType - Key type (e.g., 'aura', 'gran')
     * @param {string} suri - Secret URI (seed phrase or hex)
     * @param {string} publicKey - Public key (hex)
     */
    async insertKey(keyType, suri, publicKey) {
        try {
            await this.rpc('author_insertKey', [keyType, suri, publicKey]);
            return { success: true, message: 'Key inserted successfully' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    }

    /**
     * Rotate session keys
     * Generates new session keys and returns the encoded public keys
     */
    async rotateKeys() {
        try {
            const result = await this.rpc('author_rotateKeys', []);
            return { success: true, keys: result };
        } catch (e) {
            return { success: false, message: e.message };
        }
    }

    /**
     * Get pending extrinsics count (as a health indicator)
     */
    async getPendingExtrinsics() {
        try {
            const result = await this.rpc('author_pendingExtrinsics', []);
            return result.length;
        } catch (e) {
            return -1;
        }
    }

    /**
     * Derive account ID from SPHINCS+ public key
     * Uses Keccak-256 hash (matching the runtime implementation)
     */
    deriveAccountId(publicKeyHex) {
        // This would need a keccak256 implementation
        // For now, return the first 32 bytes as a placeholder
        const clean = publicKeyHex.replace('0x', '');
        return '0x' + clean.substring(0, 64);
    }

    /**
     * Validate SPHINCS+ key format
     */
    validateSphincsKey(keyHex) {
        const clean = keyHex.replace('0x', '').replace(/[^0-9a-fA-F]/g, '');

        if (clean.length === 256) {
            return { valid: true, type: 'secret', bytes: 128 };
        } else if (clean.length === 128) {
            return { valid: true, type: 'public', bytes: 64 };
        } else if (clean.length === 96) {
            return { valid: true, type: 'seed', bytes: 48 };
        } else {
            return {
                valid: false,
                type: 'unknown',
                bytes: clean.length / 2,
                message: `Invalid length: ${clean.length / 2} bytes. Expected 128 (secret), 64 (public), or 48 (seed).`
            };
        }
    }

    /**
     * Get dev account info
     */
    getDevAccounts() {
        // SECURITY: Dev account keys must be loaded from environment variables.
        // Generate new keys with: subkey generate --scheme sphincs
        console.warn('Dev accounts require ALICE_SECRET, BOB_SEED, CHARLIE_SEED env vars');
        return {
            alice: {
                name: 'Alice',
                secret: window.__ALICE_SECRET || '',
                public: '',
                accountId: '',
                isSudo: true
            },
            bob: {
                name: 'Bob',
                seed: window.__BOB_SEED || '',
                isSudo: false
            },
            charlie: {
                name: 'Charlie',
                seed: window.__CHARLIE_SEED || '',
                isSudo: false
            }
        };
    }

    /**
     * Check if a key matches the sudo account
     */
    async isSudoKey(publicKeyHex) {
        const sudoAccountId = '0xe40ec85c92436dda3961649a53a4d2e41b15748c8f9f7f5b8d37e6e90f187700';
        // Query the sudo.key storage to verify
        try {
            const sudoKey = await this.rpc('state_getStorage', [
                '0x5c0d1176a568c1f92944340dbfed9e9c530ebca703c85910e7164cb7d1c9e47b' // twox128("Sudo") + twox128("Key")
            ]);
            return sudoKey === publicKeyHex || sudoKey?.includes(publicKeyHex.replace('0x', ''));
        } catch (e) {
            // Fallback to known sudo account
            const derived = this.deriveAccountId(publicKeyHex);
            return derived === sudoAccountId;
        }
    }
}

// Export for use in browser and Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KeystoreManager };
}
if (typeof window !== 'undefined') {
    window.KeystoreManager = KeystoreManager;
}
