/**
 * QuantumHarmony IPFS Integration
 *
 * Provides decentralized document storage via IPFS:
 * - Pinata pinning service integration
 * - Public and encrypted upload options
 * - Gateway retrieval
 */

// Default public gateways for retrieval
const IPFS_GATEWAYS = [
    'https://gateway.pinata.cloud/ipfs/',
    'https://ipfs.io/ipfs/',
    'https://cloudflare-ipfs.com/ipfs/',
    'https://dweb.link/ipfs/'
];

/**
 * IPFS Configuration
 */
let ipfsConfig = {
    pinataApiKey: '',
    pinataSecretKey: '',
    preferredGateway: IPFS_GATEWAYS[0]
};

/**
 * Load IPFS config from localStorage
 */
function loadIPFSConfig() {
    const saved = localStorage.getItem('qh_ipfs_config');
    if (saved) {
        ipfsConfig = { ...ipfsConfig, ...JSON.parse(saved) };
    }
    return ipfsConfig;
}

/**
 * Save IPFS config to localStorage
 */
function saveIPFSConfig(config) {
    ipfsConfig = { ...ipfsConfig, ...config };
    localStorage.setItem('qh_ipfs_config', JSON.stringify(ipfsConfig));
}

/**
 * Check if Pinata is configured
 */
function isPinataConfigured() {
    loadIPFSConfig();
    return ipfsConfig.pinataApiKey && ipfsConfig.pinataSecretKey;
}

/**
 * Upload file to IPFS via Pinata
 * @param {File} file - The file to upload
 * @param {Object} options - Upload options
 * @returns {Promise<{cid: string, size: number}>}
 */
async function uploadToIPFS(file, options = {}) {
    loadIPFSConfig();

    if (!ipfsConfig.pinataApiKey || !ipfsConfig.pinataSecretKey) {
        throw new Error('Pinata API keys not configured. Go to Settings to add your keys.');
    }

    const formData = new FormData();
    formData.append('file', file);

    // Add metadata
    const metadata = JSON.stringify({
        name: options.name || file.name,
        keyvalues: {
            app: 'QuantumHarmony Notarial',
            category: options.category || 'document',
            timestamp: new Date().toISOString()
        }
    });
    formData.append('pinataMetadata', metadata);

    // Pinning options
    const pinataOptions = JSON.stringify({
        cidVersion: 1
    });
    formData.append('pinataOptions', pinataOptions);

    const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method: 'POST',
        headers: {
            'pinata_api_key': ipfsConfig.pinataApiKey,
            'pinata_secret_api_key': ipfsConfig.pinataSecretKey
        },
        body: formData
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || `Pinata upload failed: ${response.status}`);
    }

    const result = await response.json();

    return {
        cid: result.IpfsHash,
        size: result.PinSize,
        timestamp: result.Timestamp
    };
}

/**
 * Upload encrypted file to IPFS
 * @param {File} file - The file to upload
 * @param {Uint8Array} encryptionKey - AES-256 key for encryption
 * @returns {Promise<{cid: string, size: number, encrypted: boolean}>}
 */
async function uploadEncryptedToIPFS(file, encryptionKey) {
    // Read file as array buffer
    const fileBuffer = await file.arrayBuffer();
    const fileBytes = new Uint8Array(fileBuffer);

    // Generate IV
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);

    let encryptedData;

    if (crypto.subtle) {
        // Use Web Crypto API
        const key = await crypto.subtle.importKey(
            'raw',
            encryptionKey,
            { name: 'AES-GCM' },
            false,
            ['encrypt']
        );

        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            fileBytes
        );

        // Prepend IV to encrypted data
        encryptedData = new Uint8Array(iv.length + encrypted.byteLength);
        encryptedData.set(iv, 0);
        encryptedData.set(new Uint8Array(encrypted), iv.length);
    } else {
        // Fallback XOR encryption (less secure, for HTTP)
        encryptedData = new Uint8Array(iv.length + fileBytes.length);
        encryptedData.set(iv, 0);
        for (let i = 0; i < fileBytes.length; i++) {
            encryptedData[iv.length + i] = fileBytes[i] ^ encryptionKey[i % encryptionKey.length];
        }
    }

    // Create encrypted blob
    const encryptedBlob = new Blob([encryptedData], { type: 'application/octet-stream' });
    const encryptedFile = new File([encryptedBlob], file.name + '.encrypted', {
        type: 'application/octet-stream'
    });

    const result = await uploadToIPFS(encryptedFile, {
        name: file.name + '.encrypted',
        category: 'encrypted-document'
    });

    return {
        ...result,
        encrypted: true,
        iv: bytesToHex(iv)
    };
}

/**
 * Fetch file from IPFS
 * @param {string} cid - The IPFS CID
 * @returns {Promise<ArrayBuffer>}
 */
async function fetchFromIPFS(cid) {
    loadIPFSConfig();

    // Try gateways in order
    const gateways = [ipfsConfig.preferredGateway, ...IPFS_GATEWAYS.filter(g => g !== ipfsConfig.preferredGateway)];

    for (const gateway of gateways) {
        try {
            const response = await fetch(gateway + cid, {
                method: 'GET',
                headers: {
                    'Accept': '*/*'
                }
            });

            if (response.ok) {
                return await response.arrayBuffer();
            }
        } catch (e) {
            console.warn(`Gateway ${gateway} failed:`, e.message);
        }
    }

    throw new Error('Failed to fetch from all IPFS gateways');
}

/**
 * Decrypt file fetched from IPFS
 * @param {ArrayBuffer} encryptedBuffer - The encrypted data
 * @param {Uint8Array} encryptionKey - AES-256 key
 * @returns {Promise<ArrayBuffer>}
 */
async function decryptIPFSFile(encryptedBuffer, encryptionKey) {
    const encryptedData = new Uint8Array(encryptedBuffer);

    // Extract IV (first 12 bytes)
    const iv = encryptedData.slice(0, 12);
    const ciphertext = encryptedData.slice(12);

    if (crypto.subtle) {
        const key = await crypto.subtle.importKey(
            'raw',
            encryptionKey,
            { name: 'AES-GCM' },
            false,
            ['decrypt']
        );

        return await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            ciphertext
        );
    } else {
        // Fallback XOR decryption
        const decrypted = new Uint8Array(ciphertext.length);
        for (let i = 0; i < ciphertext.length; i++) {
            decrypted[i] = ciphertext[i] ^ encryptionKey[i % encryptionKey.length];
        }
        return decrypted.buffer;
    }
}

/**
 * Get IPFS URL for a CID
 */
function getIPFSUrl(cid) {
    loadIPFSConfig();
    return ipfsConfig.preferredGateway + cid;
}

/**
 * Test Pinata connection
 */
async function testPinataConnection() {
    loadIPFSConfig();

    if (!ipfsConfig.pinataApiKey || !ipfsConfig.pinataSecretKey) {
        return { success: false, error: 'API keys not configured' };
    }

    try {
        const response = await fetch('https://api.pinata.cloud/data/testAuthentication', {
            method: 'GET',
            headers: {
                'pinata_api_key': ipfsConfig.pinataApiKey,
                'pinata_secret_api_key': ipfsConfig.pinataSecretKey
            }
        });

        if (response.ok) {
            return { success: true };
        } else {
            const error = await response.json().catch(() => ({}));
            return { success: false, error: error.message || 'Authentication failed' };
        }
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Helper: bytes to hex
 */
function bytesToHex(bytes) {
    return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a random encryption key (32 bytes) as base64url string
 * @returns {string} base64url-encoded key
 */
function generateEncryptionKey() {
    const key = new Uint8Array(32);
    crypto.getRandomValues(key);
    return key;
}

/**
 * Generate encryption key as base64url string (for URL embedding)
 * @returns {string}
 */
function generateEncryptionKeyBase64url() {
    const key = new Uint8Array(32);
    crypto.getRandomValues(key);
    return base64urlEncode(key);
}

/**
 * Hash an ArrayBuffer using SHA-256
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string>} 0x-prefixed hex hash
 */
async function hashArrayBuffer(buffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Download from IPFS and decrypt if key provided
 * @param {string} cid - IPFS CID
 * @param {string} [base64urlKey] - Optional base64url encryption key
 * @returns {Promise<{data: ArrayBuffer, encrypted: boolean}>}
 */
async function downloadFromIPFS(cid, base64urlKey) {
    const raw = await fetchFromIPFS(cid);
    if (base64urlKey) {
        const keyBytes = base64urlDecode(base64urlKey);
        const decrypted = await decryptIPFSFile(raw, keyBytes);
        return { data: decrypted, encrypted: true };
    }
    return { data: raw, encrypted: false };
}

/**
 * Base64url encode a Uint8Array
 */
function base64urlEncode(bytes) {
    const binStr = String.fromCharCode(...bytes);
    return btoa(binStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64url decode to Uint8Array
 */
function base64urlDecode(str) {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    const binStr = atob(base64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
    return bytes;
}

// Export for use in main app
window.QHIPFS = {
    loadIPFSConfig,
    saveIPFSConfig,
    isPinataConfigured,
    uploadToIPFS,
    uploadEncryptedToIPFS,
    fetchFromIPFS,
    decryptIPFSFile,
    downloadFromIPFS,
    getIPFSUrl,
    testPinataConnection,
    generateEncryptionKey,
    generateEncryptionKeyBase64url,
    hashArrayBuffer,
    base64urlEncode,
    base64urlDecode,
    GATEWAYS: IPFS_GATEWAYS
};
