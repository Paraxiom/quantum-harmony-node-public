/**
 * QuantumHarmony Encrypted Keystore
 *
 * Provides password-protected SPHINCS+ key management:
 * - Key generation with secure random
 * - PBKDF2 key derivation (Web Crypto API)
 * - AES-256-GCM encryption
 * - JSON keystore format
 * - Keccak-256 (SHA3) for AccountId (PQC-compatible, matches QuantumHasher)
 */

// Keccak-256 wrapper using js-sha3 library (loaded from CDN)
// Provides PQC-compatible 256-bit hashing matching QuantumHasher in runtime
function keccak_256(input) {
    if (typeof keccak256 === 'undefined' && typeof sha3_256 === 'undefined') {
        throw new Error('js-sha3 library not loaded. Include it before keystore.js');
    }
    // js-sha3 exposes keccak256 function
    const hashHex = keccak256(input);
    // Convert hex string to Uint8Array
    const bytes = new Uint8Array(hashHex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hashHex.substr(i * 2, 2), 16);
    }
    return bytes;
}

// Blake2b-512 for SS58 checksum (per SS58 specification - this is fixed)
function blake2b_512(input) {
    if (typeof blakejs === 'undefined') {
        throw new Error('blakejs library not loaded. Include it before keystore.js');
    }
    return blakejs.blake2b(input, null, 64);
}

/**
 * SS58 encode an AccountId (32-byte Keccak hash of public key)
 * Network prefix 42 = generic Substrate
 * Uses Blake2b-512 for checksum (per SS58 specification)
 */
function ss58Encode(accountId) {
    const SS58_PREFIX = new Uint8Array([0x53, 0x53, 0x35, 0x38, 0x50, 0x52, 0x45]); // "SS58PRE"
    const prefix = 42; // Generic Substrate network

    // Prepare data: [prefix, ...accountId]
    const data = new Uint8Array(1 + accountId.length);
    data[0] = prefix;
    data.set(accountId, 1);

    // Checksum: Blake2b-512(SS58PRE + data)[0..2] per SS58 specification
    const checksumInput = new Uint8Array(SS58_PREFIX.length + data.length);
    checksumInput.set(SS58_PREFIX);
    checksumInput.set(data, SS58_PREFIX.length);
    const fullHash = blake2b_512(checksumInput);
    const checksum = fullHash.slice(0, 2);

    // Final: base58(prefix + accountId + checksum)
    const final = new Uint8Array(data.length + 2);
    final.set(data);
    final.set(checksum, data.length);

    return bytesToBase58(final);
}

/**
 * Derive PQC-compatible AccountId from SPHINCS+ public key
 * Uses Keccak-256 (SHA3) hash - matches QuantumHasher in runtime
 */
function deriveAccountId(publicKey) {
    return keccak_256(publicKey);
}

// Argon2id parameters (OWASP recommended)
const ARGON2_MEMORY = 65536;  // 64 MB
const ARGON2_ITERATIONS = 3;
const ARGON2_PARALLELISM = 4;
const ARGON2_HASH_LENGTH = 32;

// We'll use a pure JS Argon2 implementation
// For production, use argon2-browser WASM module

/**
 * Simple PBKDF2 fallback (until Argon2 WASM is integrated)
 * In production, replace with Argon2id
 */
async function deriveKey(password, salt, iterations = 100000) {
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);

    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: iterations,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );

    return key;
}

/**
 * Fallback key derivation for HTTP (no crypto.subtle)
 */
function deriveKeyFallback(password, salt, iterations = 100000) {
    // Simple PBKDF2-like derivation using SHA-256
    let key = new Uint8Array([...new TextEncoder().encode(password), ...salt]);

    for (let i = 0; i < Math.min(iterations, 10000); i++) {
        key = sha256Bytes(key);
    }

    return key.slice(0, 32);
}

/**
 * SHA-256 that returns Uint8Array
 */
function sha256Bytes(data) {
    const K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    const rotr = (n, x) => (x >>> n) | (x << (32 - n));
    const ch = (x, y, z) => (x & y) ^ (~x & z);
    const maj = (x, y, z) => (x & y) ^ (x & z) ^ (y & z);
    const sigma0 = x => rotr(2, x) ^ rotr(13, x) ^ rotr(22, x);
    const sigma1 = x => rotr(6, x) ^ rotr(11, x) ^ rotr(25, x);
    const gamma0 = x => rotr(7, x) ^ rotr(18, x) ^ (x >>> 3);
    const gamma1 = x => rotr(17, x) ^ rotr(19, x) ^ (x >>> 10);

    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

    const l = bytes.length;
    const k = (512 - ((l * 8 + 1 + 64) % 512)) % 512;
    const padded = new Uint8Array(l + 1 + (k / 8) + 8);
    padded.set(bytes);
    padded[l] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 4, l * 8, false);

    for (let i = 0; i < padded.length; i += 64) {
        const W = new Uint32Array(64);
        for (let t = 0; t < 16; t++) W[t] = view.getUint32(i + t * 4, false);
        for (let t = 16; t < 64; t++) W[t] = (gamma1(W[t-2]) + W[t-7] + gamma0(W[t-15]) + W[t-16]) >>> 0;

        let [a, b, c, d, e, f, g, h] = H;
        for (let t = 0; t < 64; t++) {
            const T1 = (h + sigma1(e) + ch(e, f, g) + K[t] + W[t]) >>> 0;
            const T2 = (sigma0(a) + maj(a, b, c)) >>> 0;
            h = g; g = f; f = e; e = (d + T1) >>> 0;
            d = c; c = b; b = a; a = (T1 + T2) >>> 0;
        }
        H = H.map((v, i) => (v + [a,b,c,d,e,f,g,h][i]) >>> 0);
    }

    const result = new Uint8Array(32);
    H.forEach((v, i) => {
        result[i * 4] = (v >> 24) & 0xff;
        result[i * 4 + 1] = (v >> 16) & 0xff;
        result[i * 4 + 2] = (v >> 8) & 0xff;
        result[i * 4 + 3] = v & 0xff;
    });
    return result;
}

/**
 * Generate a new SPHINCS+ keypair via server-side API
 * The node binary's `sphincs-key generate` produces valid keypairs.
 * Browser-side random bytes do NOT produce valid SPHINCS+ keys.
 *
 * @param {string} [apiUrl] - Override API URL (defaults to /api/generate-keypair)
 * @returns {Promise<{secretKey: Uint8Array, publicKey: Uint8Array, address?: string}>}
 */
async function generateKeypair(apiUrl) {
    const endpoints = [
        apiUrl,
        window.location.origin + '/api/generate-keypair',
        'https://quantumharmony.network/api/generate-keypair'
    ].filter(Boolean);

    for (const url of endpoints) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(15000)
            });

            if (!response.ok) continue;

            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) continue;

            const data = await response.json();
            if (!data.success || !data.secret_key_hex) continue;

            const cleanHex = data.secret_key_hex.replace(/^0x/, '');
            if (cleanHex.length !== 256) continue;

            const secretKey = new Uint8Array(128);
            for (let i = 0; i < 128; i++) {
                secretKey[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
            }
            const publicKey = secretKey.slice(64, 128);

            return {
                secretKey,
                publicKey,
                address: data.address || null
            };
        } catch (e) {
            console.warn('Keygen API failed at', url, ':', e.message);
        }
    }

    throw new Error(
        'Could not generate a valid SPHINCS+ keypair. ' +
        'The keygen API is unavailable. Please use "Import Existing Key" ' +
        'with a key generated by: quantumharmony-node sphincs-key generate'
    );
}

/**
 * Generate a 24-word seed phrase (BIP39-style)
 */
function generateSeedPhrase() {
    // Simplified word list (in production, use full BIP39 wordlist)
    const words = [
        'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract',
        'absurd', 'abuse', 'access', 'accident', 'account', 'accuse', 'achieve', 'acid',
        'acoustic', 'acquire', 'across', 'act', 'action', 'actor', 'actress', 'actual',
        'adapt', 'add', 'addict', 'address', 'adjust', 'admit', 'adult', 'advance',
        'advice', 'aerobic', 'affair', 'afford', 'afraid', 'again', 'age', 'agent',
        'agree', 'ahead', 'aim', 'air', 'airport', 'aisle', 'alarm', 'album',
        'alcohol', 'alert', 'alien', 'all', 'alley', 'allow', 'almost', 'alone',
        'alpha', 'already', 'also', 'alter', 'always', 'amateur', 'amazing', 'among',
        'amount', 'amused', 'analyst', 'anchor', 'ancient', 'anger', 'angle', 'angry',
        'animal', 'ankle', 'announce', 'annual', 'answer', 'antenna', 'antique', 'anxiety',
        'any', 'apart', 'apology', 'appear', 'apple', 'approve', 'april', 'arch',
        'arctic', 'area', 'arena', 'argue', 'arm', 'armed', 'armor', 'army',
        'around', 'arrange', 'arrest', 'arrive', 'arrow', 'art', 'artefact', 'artist',
        'artwork', 'ask', 'aspect', 'assault', 'asset', 'assist', 'assume', 'asthma',
        'athlete', 'atom', 'attack', 'attend', 'attitude', 'attract', 'auction', 'audit',
        'august', 'aunt', 'author', 'auto', 'autumn', 'average', 'avocado', 'avoid',
        'awake', 'aware', 'away', 'awesome', 'awful', 'awkward', 'axis', 'baby',
        'bachelor', 'bacon', 'badge', 'bag', 'balance', 'balcony', 'ball', 'bamboo',
        'banana', 'banner', 'bar', 'barely', 'bargain', 'barrel', 'base', 'basic',
        'basket', 'battle', 'beach', 'bean', 'beauty', 'because', 'become', 'beef',
        'before', 'begin', 'behave', 'behind', 'believe', 'below', 'belt', 'bench',
        'benefit', 'best', 'betray', 'better', 'between', 'beyond', 'bicycle', 'bid',
        'bike', 'bind', 'biology', 'bird', 'birth', 'bitter', 'black', 'blade',
        'blame', 'blanket', 'blast', 'bleak', 'bless', 'blind', 'blood', 'blossom',
        'blouse', 'blue', 'blur', 'blush', 'board', 'boat', 'body', 'boil',
        'bomb', 'bone', 'bonus', 'book', 'boost', 'border', 'boring', 'borrow',
        'boss', 'bottom', 'bounce', 'box', 'boy', 'bracket', 'brain', 'brand',
        'brass', 'brave', 'bread', 'breeze', 'brick', 'bridge', 'brief', 'bright',
        'bring', 'brisk', 'broccoli', 'broken', 'bronze', 'broom', 'brother', 'brown',
        'brush', 'bubble', 'buddy', 'budget', 'buffalo', 'build', 'bulb', 'bulk',
        'bullet', 'bundle', 'bunker', 'burden', 'burger', 'burst', 'bus', 'business',
        'busy', 'butter', 'buyer', 'buzz', 'cabbage', 'cabin', 'cable', 'cactus'
    ];

    const indices = new Uint16Array(24);
    crypto.getRandomValues(indices);

    return Array.from(indices).map(i => words[i % words.length]).join(' ');
}

/**
 * Derive keypair from seed phrase
 * NOTE: Seed-derived keys are NOT valid SPHINCS+ keypairs.
 * Use generateKeypair() (server-side) or import a pre-generated key instead.
 */
function keypairFromSeed(seedPhrase) {
    throw new Error(
        'Seed phrase key derivation is not supported for SPHINCS+. ' +
        'Please use "Import Existing Key" with a key generated by: ' +
        'quantumharmony-node sphincs-key generate'
    );
}

/**
 * Simple XOR-based encryption for HTTP fallback
 */
function xorEncrypt(data, key) {
    const result = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
        result[i] = data[i] ^ key[i % key.length];
    }
    return result;
}

/**
 * Create encrypted keystore from keypair
 */
async function createKeystore(keypair, password, name = 'My Signing Key') {
    // Trim password to avoid whitespace issues
    password = password.trim();

    console.log('=== CREATE KEYSTORE DEBUG ===');
    console.log('Password length (after trim):', password.length);
    console.log('Secret key length:', keypair.secretKey.length);

    const salt = new Uint8Array(32);
    crypto.getRandomValues(salt);

    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);

    console.log('Generated salt bytes:', salt.length);
    console.log('Generated IV bytes:', iv.length);

    const id = crypto.randomUUID ? crypto.randomUUID() :
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });

    let ciphertext, mac;

    if (crypto.subtle) {
        // Use Web Crypto API (HTTPS)
        console.log('Using Web Crypto API for encryption...');
        const key = await deriveKey(password, salt);
        console.log('Key derived for encryption');

        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            keypair.secretKey
        );
        console.log('Encryption done, ciphertext bytes:', encrypted.byteLength);

        // AES-GCM includes auth tag in output
        ciphertext = new Uint8Array(encrypted);
        mac = ''; // Included in ciphertext for GCM
    } else {
        // Fallback for HTTP
        const key = deriveKeyFallback(password, salt);
        ciphertext = xorEncrypt(keypair.secretKey, key);
        mac = bytesToHex(sha256Bytes(new Uint8Array([...ciphertext, ...key])));
    }

    // Compute Substrate-compatible address from public key
    // Uses blake2-256 hash (same as Substrate runtime) + proper SS58 encoding
    const accountId = deriveAccountId(keypair.publicKey);
    const address = ss58Encode(accountId);

    const keystore = {
        version: 1,
        id: id,
        address: address,
        publicKey: bytesToHex(keypair.publicKey),
        crypto: {
            cipher: crypto.subtle ? 'aes-256-gcm' : 'xor-sha256',
            ciphertext: bytesToHex(ciphertext),
            cipherparams: {
                iv: bytesToHex(iv)
            },
            kdf: crypto.subtle ? 'pbkdf2' : 'pbkdf2-fallback',
            kdfparams: {
                iterations: crypto.subtle ? 100000 : 10000,
                salt: bytesToHex(salt),
                hash: 'sha-256'
            },
            mac: mac
        },
        meta: {
            name: name,
            created: new Date().toISOString(),
            algorithm: 'sphincs+-shake-256f'
        }
    };

    // Verify we can decrypt immediately (catch bugs early)
    console.log('Verifying keystore can be decrypted...');
    try {
        const testSalt = hexToBytes(keystore.crypto.kdfparams.salt);
        const testIv = hexToBytes(keystore.crypto.cipherparams.iv);
        const testCiphertext = hexToBytes(keystore.crypto.ciphertext);

        console.log('Verify - salt bytes:', testSalt.length);
        console.log('Verify - IV bytes:', testIv.length);
        console.log('Verify - ciphertext bytes:', testCiphertext.length);

        if (crypto.subtle) {
            const testKey = await deriveKey(password, testSalt, keystore.crypto.kdfparams.iterations);
            const testDecrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: testIv },
                testKey,
                testCiphertext
            );
            console.log('Verification SUCCESS - decrypted length:', testDecrypted.byteLength);
        }
    } catch (verifyError) {
        console.error('VERIFICATION FAILED:', verifyError);
        throw new Error('Keystore creation failed verification: ' + verifyError.message);
    }

    return keystore;
}

/**
 * Decrypt keystore with password
 */
async function unlockKeystore(keystore, password) {
    // Trim password to avoid whitespace issues
    password = password.trim();

    console.log('=== UNLOCK DEBUG ===');
    console.log('Keystore ID:', keystore.id);
    console.log('Cipher:', keystore.crypto.cipher);
    console.log('KDF:', keystore.crypto.kdf);
    console.log('Iterations:', keystore.crypto.kdfparams.iterations);
    console.log('Salt hex length:', keystore.crypto.kdfparams.salt.length);
    console.log('IV hex length:', keystore.crypto.cipherparams.iv.length);
    console.log('Ciphertext hex length:', keystore.crypto.ciphertext.length);
    console.log('Password length (after trim):', password.length);

    const salt = hexToBytes(keystore.crypto.kdfparams.salt);
    const iv = hexToBytes(keystore.crypto.cipherparams.iv);
    const ciphertext = hexToBytes(keystore.crypto.ciphertext);

    console.log('Parsed salt bytes:', salt.length);
    console.log('Parsed IV bytes:', iv.length);
    console.log('Parsed ciphertext bytes:', ciphertext.length);

    let secretKey;

    if (crypto.subtle && keystore.crypto.cipher === 'aes-256-gcm') {
        try {
            console.log('Using Web Crypto API for decryption...');
            const key = await deriveKey(password, salt, keystore.crypto.kdfparams.iterations);
            console.log('Key derived successfully');

            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                ciphertext
            );
            console.log('Decryption successful, length:', decrypted.byteLength);
            secretKey = new Uint8Array(decrypted);
        } catch (e) {
            console.error('Decryption error:', e.name, e.message);
            console.error('This usually means wrong password or corrupted data');
            throw new Error('Invalid password');
        }
    } else {
        // Fallback decryption
        const key = deriveKeyFallback(password, salt, keystore.crypto.kdfparams.iterations);
        secretKey = xorEncrypt(ciphertext, key);

        // Verify MAC if present
        if (keystore.crypto.mac) {
            const expectedMac = bytesToHex(sha256Bytes(new Uint8Array([...ciphertext, ...key])));
            if (expectedMac !== keystore.crypto.mac) {
                throw new Error('Invalid password');
            }
        }
    }

    // Verify key length
    if (secretKey.length !== 128) {
        throw new Error('Invalid keystore format');
    }

    return {
        secretKey: secretKey,
        publicKey: secretKey.slice(64, 128),
        address: keystore.address
    };
}

/**
 * Helper: bytes to hex
 */
function bytesToHex(bytes) {
    return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Helper: hex to bytes
 */
function hexToBytes(hex) {
    hex = hex.replace(/^0x/, '');
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
}

/**
 * Helper: bytes to base58 (simplified)
 */
function bytesToBase58(bytes) {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let num = BigInt('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''));
    let result = '';
    while (num > 0) {
        result = ALPHABET[Number(num % 58n)] + result;
        num = num / 58n;
    }
    // Add leading zeros
    for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
        result = '1' + result;
    }
    return result || '1';
}

/**
 * Save keystore to localStorage
 */
function saveKeystore(keystore) {
    const keystores = JSON.parse(localStorage.getItem('qh_keystores') || '[]');

    // Check if already exists
    const existingIndex = keystores.findIndex(k => k.id === keystore.id);
    if (existingIndex >= 0) {
        keystores[existingIndex] = keystore;
    } else {
        keystores.push(keystore);
    }

    localStorage.setItem('qh_keystores', JSON.stringify(keystores));

    // Set as active if first keystore
    if (keystores.length === 1) {
        localStorage.setItem('qh_active_keystore', keystore.id);
    }
}

/**
 * Load all keystores from localStorage
 */
function loadKeystores() {
    return JSON.parse(localStorage.getItem('qh_keystores') || '[]');
}

/**
 * Get active keystore
 */
function getActiveKeystore() {
    const keystores = loadKeystores();
    const activeId = localStorage.getItem('qh_active_keystore');
    return keystores.find(k => k.id === activeId) || keystores[0] || null;
}

/**
 * Set active keystore
 */
function setActiveKeystore(id) {
    localStorage.setItem('qh_active_keystore', id);
}

/**
 * Delete keystore
 */
function deleteKeystore(id) {
    const keystores = loadKeystores();
    const filtered = keystores.filter(k => k.id !== id);
    localStorage.setItem('qh_keystores', JSON.stringify(filtered));

    // Update active if deleted
    if (localStorage.getItem('qh_active_keystore') === id) {
        localStorage.setItem('qh_active_keystore', filtered[0]?.id || '');
    }
}

/**
 * Export keystore as JSON file
 */
function exportKeystore(keystore) {
    const blob = new Blob([JSON.stringify(keystore, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `keystore-${keystore.address.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Import keystore from JSON file
 */
async function importKeystoreFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const keystore = JSON.parse(e.target.result);
                if (!keystore.version || !keystore.crypto || !keystore.address) {
                    throw new Error('Invalid keystore format');
                }
                resolve(keystore);
            } catch (err) {
                reject(new Error('Failed to parse keystore file'));
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
}

// Export for use in main app
window.QHKeystore = {
    generateKeypair,
    generateSeedPhrase,
    keypairFromSeed,
    createKeystore,
    unlockKeystore,
    saveKeystore,
    loadKeystores,
    getActiveKeystore,
    setActiveKeystore,
    deleteKeystore,
    exportKeystore,
    importKeystoreFile,
    bytesToHex,
    hexToBytes
};
