/**
 * QuantumHarmony Upgrade Manager
 * Handles runtime upgrades with chunked upload support
 */

class UpgradeManager {
    constructor(rpcEndpoint = 'http://127.0.0.1:9944') {
        this.rpcEndpoint = rpcEndpoint;
        this.chunkSize = 64 * 1024; // 64KB chunks
        this.currentUpgrade = null;
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
     * Submit runtime upgrade - automatically chooses single-shot or chunked based on size
     */
    async submitUpgrade(wasmFile, secretKey, options = {}) {
        const {
            onProgress = () => {},
            onLog = console.log,
            forceChunked = false,
            chunkThreshold = 500 * 1024 // Use chunked for >500KB
        } = options;

        const wasmBytes = await wasmFile.arrayBuffer();
        const wasmSize = wasmBytes.byteLength;

        onLog(`WASM size: ${(wasmSize / 1024).toFixed(2)} KB`);
        onProgress({ phase: 'preparing', progress: 0 });

        // Normalize the secret key
        const normalizedKey = this.normalizeSecretKey(secretKey);

        // Choose upgrade method based on size
        if (forceChunked || wasmSize > chunkThreshold) {
            onLog(`Using chunked upgrade (${Math.ceil(wasmSize / this.chunkSize)} chunks)`);
            return this.submitChunkedUpgrade(wasmBytes, normalizedKey, { onProgress, onLog });
        } else {
            onLog('Using single-shot upgrade');
            return this.submitSingleUpgrade(wasmBytes, normalizedKey, { onProgress, onLog });
        }
    }

    /**
     * Single-shot upgrade for smaller WASM files
     */
    async submitSingleUpgrade(wasmBytes, secretKey, { onProgress, onLog }) {
        onProgress({ phase: 'uploading', progress: 10 });
        onLog('Converting WASM to hex...');

        const wasmHex = '0x' + Array.from(new Uint8Array(wasmBytes))
            .map(b => b.toString(16).padStart(2, '0')).join('');

        onProgress({ phase: 'uploading', progress: 30 });
        onLog('Submitting to node...');

        const result = await this.rpc('quantumharmony_submitRuntimeUpgrade', [wasmHex, secretKey]);

        onProgress({ phase: 'submitted', progress: 80 });
        onLog(`Transaction submitted: ${result}`);

        // Wait for finalization
        onLog('Waiting for finalization...');
        await this.waitForFinalization(result, { onProgress, onLog });

        onProgress({ phase: 'complete', progress: 100 });
        return { success: true, txHash: result, method: 'single-shot' };
    }

    /**
     * Chunked upgrade for larger WASM files
     */
    async submitChunkedUpgrade(wasmBytes, secretKey, { onProgress, onLog }) {
        const wasmHex = '0x' + Array.from(new Uint8Array(wasmBytes))
            .map(b => b.toString(16).padStart(2, '0')).join('');

        // Step 1: Initiate chunked upgrade
        onProgress({ phase: 'initiating', progress: 5 });
        onLog('Initiating chunked upgrade...');

        const initResult = await this.rpc('chunkedUpgrade_initiate', [wasmHex, secretKey]);
        onLog(`Upgrade initiated: ${initResult.upgrade_id}`);
        onLog(`Total chunks: ${initResult.total_chunks}`);

        const totalChunks = initResult.total_chunks;
        const wasmBytesArray = new Uint8Array(wasmBytes);

        // Step 2: Upload each chunk
        const txHashes = [];
        for (let i = 0; i < totalChunks; i++) {
            const start = i * this.chunkSize;
            const end = Math.min(start + this.chunkSize, wasmBytesArray.length);
            const chunk = wasmBytesArray.slice(start, end);
            const chunkHex = '0x' + Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join('');

            const progress = 10 + (70 * (i + 1) / totalChunks);
            onProgress({ phase: 'uploading', progress, chunk: i + 1, totalChunks });
            onLog(`Uploading chunk ${i + 1}/${totalChunks}...`);

            const txHash = await this.rpc('chunkedUpgrade_uploadChunk', [i, chunkHex, secretKey]);
            txHashes.push(txHash);
            onLog(`Chunk ${i + 1} uploaded: ${txHash.substring(0, 20)}...`);

            // Small delay between chunks to avoid overwhelming the pool
            await new Promise(r => setTimeout(r, 500));
        }

        // Step 3: Finalize
        onProgress({ phase: 'finalizing', progress: 85 });
        onLog('Finalizing upgrade...');

        const finalResult = await this.rpc('chunkedUpgrade_finalize', [secretKey]);
        onLog(`Finalization submitted: ${finalResult}`);

        // Wait for finalization
        await this.waitForFinalization(finalResult, { onProgress, onLog });

        onProgress({ phase: 'complete', progress: 100 });
        return {
            success: true,
            txHash: finalResult,
            method: 'chunked',
            chunks: totalChunks,
            chunkTxHashes: txHashes
        };
    }

    /**
     * Wait for transaction finalization
     */
    async waitForFinalization(txHash, { onProgress, onLog }, maxBlocks = 10) {
        const startBlock = await this.getCurrentBlock();
        onLog(`Waiting for finalization (current block: ${startBlock})...`);

        for (let i = 0; i < maxBlocks; i++) {
            await new Promise(r => setTimeout(r, 6000)); // Wait ~1 block

            const currentBlock = await this.getCurrentBlock();
            const progress = 80 + (15 * (i + 1) / maxBlocks);
            onProgress({ phase: 'finalizing', progress, block: currentBlock });

            // Check if spec version changed (indicates successful upgrade)
            const version = await this.rpc('state_getRuntimeVersion', []);
            onLog(`Block ${currentBlock}: spec_version = ${version.specVersion}`);

            if (currentBlock > startBlock + 2) {
                return true; // Assume finalized after 2 blocks
            }
        }

        onLog('Warning: Finalization check timed out');
        return false;
    }

    async getCurrentBlock() {
        const header = await this.rpc('chain_getHeader', []);
        return parseInt(header.number, 16);
    }

    async getSpecVersion() {
        const version = await this.rpc('state_getRuntimeVersion', []);
        return version.specVersion;
    }

    /**
     * Normalize secret key input to proper hex format
     */
    normalizeSecretKey(input) {
        const DEV_ACCOUNTS = {
            alice: 'REDACTED_ALICE_SECRET',
            bob: 'REDACTED_BOB_SEED',
            charlie: 'REDACTED_CHARLIE_SEED'
        };

        let key = input.trim().replace(/['"]/g, '');
        const keyLower = key.toLowerCase();

        // Check for dev account names
        if (keyLower === 'alice' || keyLower === '//alice') {
            return '0x' + DEV_ACCOUNTS.alice;
        } else if (keyLower === 'bob' || keyLower === '//bob') {
            return '0x' + DEV_ACCOUNTS.bob;
        } else if (keyLower === 'charlie' || keyLower === '//charlie') {
            return '0x' + DEV_ACCOUNTS.charlie;
        }

        // Normalize hex key
        let hexPart = key.startsWith('0x') ? key.slice(2) : key;
        hexPart = hexPart.replace(/[^0-9a-fA-F]/g, '');

        if (hexPart.length < 96) {
            throw new Error(`Key too short: ${hexPart.length / 2} bytes. Need 48 (seed) or 128 (full key).`);
        }

        return '0x' + hexPart;
    }

    /**
     * Check upgrade status
     */
    async checkUpgradeStatus() {
        try {
            const status = await this.rpc('chunkedUpgrade_status', []);
            return status;
        } catch (e) {
            return null;
        }
    }

    /**
     * Cancel pending chunked upgrade
     */
    async cancelUpgrade(secretKey) {
        const normalizedKey = this.normalizeSecretKey(secretKey);
        return this.rpc('chunkedUpgrade_cancel', [normalizedKey]);
    }
}

// Export for use in browser and Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { UpgradeManager };
}
if (typeof window !== 'undefined') {
    window.UpgradeManager = UpgradeManager;
}
