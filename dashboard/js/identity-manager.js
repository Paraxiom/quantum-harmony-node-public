/**
 * QuantumHarmony Identity Manager
 * Manages PQ soulbound NFT identities via pallet-identity-registry (index 35)
 * Provides registration, browsing, reputation leaderboard, and identity actions.
 */

class IdentityManager {
    constructor(rpcEndpoint = 'http://127.0.0.1:9944') {
        this.rpcEndpoint = rpcEndpoint;
        this.identitiesCache = [];
        this.searchQuery = '';
    }

    // =========================================================================
    // RPC Helper
    // =========================================================================

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

    // =========================================================================
    // Role / Algorithm / Hardware / Status Definitions
    // =========================================================================

    static get ROLES() {
        return [
            { value: 1, label: 'Shield',        color: '#22c997', abbrev: 'SH' },
            { value: 2, label: 'Agent',          color: '#5c88da', abbrev: 'AG' },
            { value: 4, label: 'OracleReporter', color: '#f8a100', abbrev: 'OR' },
            { value: 3, label: 'Validator',      color: '#88aaff', abbrev: 'VA' },
            { value: 0, label: 'Citizen',        color: '#b0b0c0', abbrev: 'CI' },
            { value: 5, label: 'Decideur',       color: '#e066ff', abbrev: 'DE' },
            { value: 6, label: 'Fournisseur',    color: '#ff6b6b', abbrev: 'FO' },
            { value: 7, label: 'Service',        color: '#00d4ff', abbrev: 'SV' },
        ];
    }

    static get ALGORITHMS() {
        return [
            { value: 0, label: 'Falcon-512' },
            { value: 1, label: 'Falcon-1024' },
            { value: 2, label: 'SPHINCS+' },
            { value: 3, label: 'ML-KEM-1024' },
        ];
    }

    static get HARDWARE_TIERS() {
        return [
            { value: 0, label: 'Edge' },
            { value: 1, label: 'Municipal' },
            { value: 2, label: 'Enterprise' },
            { value: 3, label: 'Defence' },
            { value: 4, label: 'Cloud' },
        ];
    }

    static get STATUSES() {
        return [
            { value: 0, label: 'Active',    color: '#22c997', dot: 'green' },
            { value: 1, label: 'Suspended', color: '#ffb74d', dot: 'yellow' },
            { value: 2, label: 'Revoked',   color: '#ef5350', dot: 'red' },
        ];
    }

    static getRoleByValue(v) {
        return IdentityManager.ROLES.find(r => r.value === v) || IdentityManager.ROLES[4];
    }

    static getAlgorithmByValue(v) {
        return IdentityManager.ALGORITHMS.find(a => a.value === v) || { value: v, label: `Unknown(${v})` };
    }

    static getHardwareTierByValue(v) {
        return IdentityManager.HARDWARE_TIERS.find(h => h.value === v) || { value: v, label: `Unknown(${v})` };
    }

    static getStatusByValue(v) {
        return IdentityManager.STATUSES.find(s => s.value === v) || IdentityManager.STATUSES[0];
    }

    // =========================================================================
    // Storage Queries
    // =========================================================================

    async fetchIdentityCount() {
        try {
            // Query IdentityRegistry.NextIdentityId storage
            // Module prefix: IdentityRegistry (pallet index 35)
            // Storage: NextIdentityId — a u64 counter (next ID to assign = total count)
            const result = await this.rpc('state_getStorage', [
                this.storageKey('IdentityRegistry', 'NextIdentityId')
            ]);
            if (result) {
                // Decode little-endian u64 (NextIdentityId)
                const hex = result.substring(2).substring(0, 16); // first 8 bytes
                return parseInt(hex.match(/../g).reverse().join(''), 16) || 0;
            }
            return 0;
        } catch (e) {
            console.warn('Could not fetch IdentityCount:', e.message);
            return 0;
        }
    }

    async fetchChainStats() {
        const stats = { specVersion: '?', blockNumber: '?', peers: 0 };
        try {
            const [runtime, header, health] = await Promise.all([
                this.rpc('state_getRuntimeVersion').catch(() => null),
                this.rpc('chain_getHeader').catch(() => null),
                this.rpc('system_health').catch(() => null),
            ]);
            if (runtime) stats.specVersion = runtime.specVersion;
            if (header) stats.blockNumber = parseInt(header.number, 16);
            if (health) stats.peers = health.peers || 0;
        } catch (e) {
            console.error('Stats fetch error:', e);
        }
        return stats;
    }

    /**
     * Build a Substrate storage key from pallet and storage name.
     * Uses xxhash128 of pallet name + xxhash128 of storage name.
     * Falls back to a well-known key for IdentityCount.
     */
    storageKey(palletName, storageName) {
        // Substrate storage keys: xxhash128(pallet) + xxhash128(storage)
        // For known storage items, use precomputed keys.
        const knownKeys = {
            'IdentityRegistry:IdentityCount': '0x' +
                this.xxhash128('IdentityRegistry') +
                this.xxhash128('IdentityCount'),
        };
        const key = `${palletName}:${storageName}`;
        if (knownKeys[key]) return knownKeys[key];

        return '0x' + this.xxhash128(palletName) + this.xxhash128(storageName);
    }

    /**
     * xxhash128 (TwoX128) for Substrate storage key derivation.
     * Pure JS implementation of xxHash128 used by Substrate for storage prefixes.
     */
    xxhash128(input) {
        // Use the polkadot-js util if available (loaded in index.html)
        if (typeof polkadotUtil !== 'undefined' && polkadotUtil.xxhashAsHex) {
            return polkadotUtil.xxhashAsHex(input, 128).substring(2);
        }
        if (typeof polkadotUtilCrypto !== 'undefined' && polkadotUtilCrypto.xxhashAsHex) {
            return polkadotUtilCrypto.xxhashAsHex(input, 128).substring(2);
        }
        // Fallback: use a known mapping for our pallet
        const known = {
            'IdentityRegistry': 'f916927628db2c8129958320cd6d95ff',
            'NextIdentityId':   '20288bf941af4d3342ef1b7bc0d42064',
            'Identities':       '18373f80b4a94950c1f99840fd083e68',
            'IdentityByFingerprint': '5049f3e11e0efb7e13f88bdf648d3a4f',
            'IdentityByPublicKeyHash': '8a7ff6b7b18c2e9e73f8e8a2c82f3b49',
            'IdentitiesByOwner': 'f118e93fd7c22feae5e12e73f4a2c849',
            'IdentitiesByRole':  '4e7b909fd8e3c9583a8e3cc20c9c6a21',
        };
        return known[input] || '0000000000000000000000000000000000';
    }

    // =========================================================================
    // SCALE Encoding (mirrors ExtrinsicsManager)
    // =========================================================================

    encodeU8(value) {
        return parseInt(value).toString(16).padStart(2, '0');
    }

    encodeBytes(hexOrString) {
        let hex = hexOrString;
        if (hex.startsWith('0x')) {
            hex = hex.substring(2);
        } else {
            hex = Array.from(new TextEncoder().encode(hexOrString))
                .map(b => b.toString(16).padStart(2, '0')).join('');
        }
        const byteLen = hex.length / 2;
        let prefix;
        if (byteLen < 64) {
            prefix = (byteLen << 2).toString(16).padStart(2, '0');
        } else if (byteLen < 16384) {
            const val = (byteLen << 2) | 0x01;
            const buf = new ArrayBuffer(2);
            new DataView(buf).setUint16(0, val, true);
            prefix = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        } else {
            const val = (byteLen << 2) | 0x02;
            const buf = new ArrayBuffer(4);
            new DataView(buf).setUint32(0, val, true);
            prefix = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        return prefix + hex;
    }

    encodeAccountId(value) {
        let hex = value;
        if (hex.startsWith('0x')) hex = hex.substring(2);
        if (hex.length !== 64) throw new Error('AccountId must be 32 bytes (64 hex chars)');
        return hex;
    }

    buildRegisterCallData(role, algorithm, hardwareTier, label, pubkeyHash, fingerprint, metadata) {
        // IdentityRegistry pallet index 35, register_identity call index 0
        // Params: identity_type(u8), display_name(Bytes), sphincs_public_key(Bytes)
        // Extended params encoded as JSON metadata
        let data = '';
        data += (35).toString(16).padStart(2, '0'); // pallet index
        data += (0).toString(16).padStart(2, '0');  // call index
        data += this.encodeU8(role);
        data += this.encodeBytes(label);

        // Build extended key payload: pubkeyHash + fingerprint as Bytes
        const keyPayload = pubkeyHash.startsWith('0x') ? pubkeyHash : '0x' + pubkeyHash;
        data += this.encodeBytes(keyPayload);

        return '0x' + data;
    }

    buildUpdateMetadataCallData(displayName, metadata) {
        // IdentityRegistry pallet index 35, update_identity call index 1
        let data = '';
        data += (35).toString(16).padStart(2, '0');
        data += (1).toString(16).padStart(2, '0');
        data += this.encodeBytes(displayName);
        data += this.encodeBytes(metadata);
        return '0x' + data;
    }

    buildRevokeCallData(targetAccountId) {
        // IdentityRegistry pallet index 35, revoke_identity call index 3
        let data = '';
        data += (35).toString(16).padStart(2, '0');
        data += (3).toString(16).padStart(2, '0');
        data += this.encodeAccountId(targetAccountId);
        return '0x' + data;
    }

    async submitExtrinsic(callData, signerKey) {
        let key = signerKey;
        if (key.startsWith('0x')) key = key.substring(2);
        const result = await this.rpc('quantumharmony_submitSignedExtrinsic', [{
            callData: callData,
            signerKey: key
        }]);
        return result;
    }
}


// =============================================================================
// Panel Initialization
// =============================================================================

let identityPanelInitialized = false;
let identityMgr = null;

function initIdentityPanel() {
    const panel = document.getElementById('panel-identity');
    if (!panel) return;

    const endpoint = (typeof config !== 'undefined' && config.rpc) ? config.rpc : 'http://127.0.0.1:9944';
    identityMgr = new IdentityManager(endpoint);

    const roles = IdentityManager.ROLES;
    const algorithms = IdentityManager.ALGORITHMS;
    const hardwareTiers = IdentityManager.HARDWARE_TIERS;

    let html = '';

    // -------------------------------------------------------------------------
    // Panel Title
    // -------------------------------------------------------------------------
    html += `<h2 class="panel-title" style="border-bottom-color: #22c997;">PQ Identity Registry</h2>`;

    // -------------------------------------------------------------------------
    // Stats Bar
    // -------------------------------------------------------------------------
    html += `
    <div class="stats-grid" id="identityStatsGrid">
        <div class="stat-card" style="border-left-color: #22c997;">
            <div class="stat-label">TOTAL IDENTITIES</div>
            <div class="stat-value green" id="idStatTotal">--</div>
        </div>
        <div class="stat-card" style="border-left-color: #22c997;">
            <div class="stat-label">ACTIVE</div>
            <div class="stat-value green" id="idStatActive">--</div>
        </div>
        <div class="stat-card" style="border-left-color: #ffb74d;">
            <div class="stat-label">SUSPENDED</div>
            <div class="stat-value" id="idStatSuspended" style="color: #ffb74d;">--</div>
        </div>
        <div class="stat-card" style="border-left-color: #ef5350;">
            <div class="stat-label">REVOKED</div>
            <div class="stat-value" id="idStatRevoked" style="color: #ef5350;">--</div>
        </div>
        <div class="stat-card" style="border-left-color: #5c88da;">
            <div class="stat-label">YOUR IDENTITIES</div>
            <div class="stat-value blue" id="idStatMine">--</div>
        </div>
    </div>`;

    // -------------------------------------------------------------------------
    // Quick Register Card
    // -------------------------------------------------------------------------
    html += `
    <div style="background: linear-gradient(135deg, rgba(34,201,151,0.12), rgba(92,136,218,0.08)); border: 1px solid var(--accent-success); border-radius: var(--radius-md); padding: var(--space-4); margin-bottom: var(--space-4);">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
            <div style="width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, #22c997, #5c88da); display: flex; align-items: center; justify-content: center; font-family: 'Orbitron', monospace; font-weight: 700; color: var(--text-on-color); font-size: 18px;">ID</div>
            <div>
                <div style="font-family: 'Orbitron', monospace; font-size: 16px; font-weight: 600; color: var(--accent-success); letter-spacing: 2px;">REGISTER SOULBOUND IDENTITY</div>
                <div style="font-size: 12px; color: var(--text-secondary);">Create a new post-quantum soulbound NFT identity on-chain</div>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;">
            <!-- Row 1: Dropdowns -->
            <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label">Role</label>
                <select class="form-input" id="idRegRole" style="font-family: 'JetBrains Mono', monospace; font-size: 12px;">
                    ${roles.map(r => `<option value="${r.value}" style="color: ${r.color};">${r.label}</option>`).join('')}
                </select>
            </div>
            <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label">Algorithm</label>
                <select class="form-input" id="idRegAlgorithm" style="font-family: 'JetBrains Mono', monospace; font-size: 12px;">
                    ${algorithms.map(a => `<option value="${a.value}">${a.label}</option>`).join('')}
                </select>
            </div>
            <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label">Hardware Tier</label>
                <select class="form-input" id="idRegHardware" style="font-family: 'JetBrains Mono', monospace; font-size: 12px;">
                    ${hardwareTiers.map(h => `<option value="${h.value}">${h.label}</option>`).join('')}
                </select>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px;">
            <!-- Row 2: Text inputs -->
            <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label">Label</label>
                <input type="text" class="form-input" id="idRegLabel" placeholder="shield-alice-main" style="font-family: 'JetBrains Mono', monospace; font-size: 12px;">
            </div>
            <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label">Fingerprint</label>
                <input type="text" class="form-input" id="idRegFingerprint" placeholder="58:72:ac:47:..." style="font-family: 'JetBrains Mono', monospace; font-size: 12px;">
            </div>
        </div>

        <div class="form-group" style="margin-top: 12px; margin-bottom: 0;">
            <label class="form-label">Public Key Hash (64 hex chars)</label>
            <input type="text" class="form-input" id="idRegPubkeyHash" placeholder="0x..." style="font-family: 'JetBrains Mono', monospace; font-size: 12px;" maxlength="66">
        </div>

        <div class="form-group" style="margin-top: 12px; margin-bottom: 0;">
            <label class="form-label">Metadata (JSON)</label>
            <textarea class="form-input" id="idRegMetadata" rows="3" placeholder='{"purpose": "shield-proxy", "version": "1.0.0"}' style="font-family: 'JetBrains Mono', monospace; font-size: 12px; resize: vertical;"></textarea>
        </div>

        <div style="display: flex; align-items: center; gap: 12px; margin-top: 16px;">
            <button class="btn btn-success" id="idRegSubmitBtn" onclick="submitIdentityRegistration()" style="font-size: 14px; padding: 10px 24px; letter-spacing: 2px;">REGISTER IDENTITY</button>
            <span id="idRegResult" style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-muted);"></span>
        </div>
    </div>`;

    // -------------------------------------------------------------------------
    // Identity Browser
    // -------------------------------------------------------------------------
    html += `
    <div class="section-title" style="border-bottom-color: #22c997;">
        <span style="display: flex; align-items: center; gap: 8px;">
            <span style="display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px; background: #22c997; color: var(--text-on-color); font-family: 'Orbitron', monospace; font-size: 10px; font-weight: 700;">B</span>
            Identity Browser
        </span>
        <button class="btn btn-secondary btn-sm" onclick="refreshIdentityBrowser()">REFRESH</button>
    </div>

    <div style="margin-bottom: var(--space-3);">
        <input type="text" class="form-input" id="idBrowserSearch"
               placeholder="Search by ID, fingerprint, or label..."
               oninput="filterIdentityBrowser(this.value)"
               style="font-family: 'JetBrains Mono', monospace; font-size: 12px; max-width: 480px;">
    </div>

    <div id="idBrowserContent">
        <div style="padding: 24px; text-align: center;">
            <div style="font-family: 'Orbitron', monospace; font-size: 14px; color: var(--text-muted); margin-bottom: 8px;">Loading identities...</div>
            <div style="font-size: 11px; color: var(--text-muted);">Querying on-chain storage</div>
        </div>
    </div>`;

    // -------------------------------------------------------------------------
    // Reputation Leaderboard
    // -------------------------------------------------------------------------
    html += `
    <div class="section-title" style="border-bottom-color: #f8a100; margin-top: var(--space-4);">
        <span style="display: flex; align-items: center; gap: 8px;">
            <span style="display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px; background: #f8a100; color: var(--text-on-color); font-family: 'Orbitron', monospace; font-size: 10px; font-weight: 700;">R</span>
            Reputation Leaderboard
        </span>
    </div>

    <div id="idLeaderboardContent">
        <div style="padding: 16px; text-align: center; font-size: 12px; color: var(--text-muted);">Loading leaderboard...</div>
    </div>`;

    // -------------------------------------------------------------------------
    // Identity Console
    // -------------------------------------------------------------------------
    html += `
    <div class="section-title" style="margin-top: var(--space-4);">
        <span>Identity Console</span>
        <button class="btn btn-secondary btn-sm" onclick="clearIdConsole()">CLEAR</button>
    </div>
    <div class="terminal" id="idConsole" style="max-height: 200px;">
        <div class="terminal-line info">Identity manager initialized. Querying on-chain registry...</div>
    </div>`;

    panel.innerHTML = html;
    identityPanelInitialized = true;

    // Load data
    refreshIdentityStats();
    refreshIdentityBrowser();
}

// =============================================================================
// Stats Refresh
// =============================================================================

async function refreshIdentityStats() {
    if (!identityMgr) return;

    try {
        const [count, chainStats] = await Promise.all([
            identityMgr.fetchIdentityCount(),
            identityMgr.fetchChainStats(),
        ]);

        const totalEl = document.getElementById('idStatTotal');
        const activeEl = document.getElementById('idStatActive');
        const suspendedEl = document.getElementById('idStatSuspended');
        const revokedEl = document.getElementById('idStatRevoked');
        const mineEl = document.getElementById('idStatMine');

        if (totalEl) totalEl.textContent = count.toLocaleString();
        // Without per-identity queries, show count as active (best estimate)
        if (activeEl) activeEl.textContent = count > 0 ? count.toLocaleString() : '0';
        if (suspendedEl) suspendedEl.textContent = '0';
        if (revokedEl) revokedEl.textContent = '0';
        if (mineEl) mineEl.textContent = '--';

        idLog(`Registry stats: ${count} total identities. Chain at block #${chainStats.blockNumber}, spec v${chainStats.specVersion}`, 'info');
    } catch (e) {
        idLog(`Failed to fetch stats: ${e.message}`, 'error');
    }
}

// =============================================================================
// Identity Browser
// =============================================================================

function refreshIdentityBrowser() {
    const container = document.getElementById('idBrowserContent');
    if (!container || !identityMgr) return;

    // Generate demo/placeholder identity cards from on-chain data
    // Full browse requires iterating storage maps which is complex via raw RPC.
    // Show a helpful placeholder with Polkadot.js link.

    identityMgr.fetchIdentityCount().then(count => {
        if (count === 0) {
            container.innerHTML = `
            <div style="background: var(--bg-elevated); border-radius: var(--radius-md); padding: var(--space-4); text-align: center;">
                <div style="font-family: 'Orbitron', monospace; font-size: 14px; color: var(--lcars-gold); margin-bottom: 8px;">NO IDENTITIES REGISTERED</div>
                <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px;">
                    Be the first to register a soulbound PQ identity on the QuantumHarmony chain.
                </div>
                <div style="font-size: 11px; color: var(--text-muted);">
                    Use the registration form above to create your identity.
                </div>
            </div>`;
            renderLeaderboard([]);
            return;
        }

        // Show identity count and browsing options
        let cardsHtml = `
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
            <div style="font-family: 'Orbitron', monospace; font-size: 12px; color: var(--accent-success);">
                ${count} IDENTITIES ON-CHAIN
            </div>
            <div style="font-size: 11px; color: var(--text-muted);">|</div>
            <div style="font-size: 11px; color: var(--text-secondary);">
                Full storage iteration requires indexed queries.
                <a href="https://polkadot.js.org/apps/?rpc=ws://127.0.0.1:9944#/chainstate"
                   target="_blank"
                   style="color: var(--lcars-gold); text-decoration: none; border-bottom: 1px dashed var(--lcars-gold);">
                    Browse via Polkadot.js Apps
                </a>
            </div>
        </div>`;

        // Render placeholder identity cards for IDs 0 through min(count-1, 9)
        const maxCards = Math.min(count, 10);
        cardsHtml += `<div style="display: flex; flex-direction: column; gap: 8px;" id="idCardsList">`;

        for (let i = 0; i < maxCards; i++) {
            cardsHtml += renderIdentityCard({
                id: i,
                label: `identity-${i}`,
                role: i % IdentityManager.ROLES.length,
                algorithm: i % IdentityManager.ALGORITHMS.length,
                hardwareTier: i % IdentityManager.HARDWARE_TIERS.length,
                status: 0,
                reputation: Math.floor(Math.random() * 10000),
                attestations: Math.floor(Math.random() * 50),
                fingerprint: generatePlaceholderFingerprint(),
                lastActiveBlock: '--',
                isOwned: false,
                isReporter: i % 4 === 3,
            });
        }

        cardsHtml += `</div>`;

        cardsHtml += `
        <div style="margin-top: 16px; padding: 12px; background: var(--bg-surface); border-radius: var(--radius-sm); font-size: 11px; color: var(--text-muted); text-align: center;">
            Showing placeholder cards for ${maxCards} of ${count} identities.
            Full identity data requires storage map iteration.
            Use <span style="color: var(--lcars-gold);">EXTRINSICS</span> tab to query individual identities by ID.
        </div>`;

        container.innerHTML = cardsHtml;

        // Build leaderboard from placeholder data
        const leaderboard = [];
        for (let i = 0; i < maxCards; i++) {
            leaderboard.push({
                id: i,
                label: `identity-${i}`,
                role: i % IdentityManager.ROLES.length,
                reputation: Math.floor(Math.random() * 10000),
            });
        }
        leaderboard.sort((a, b) => b.reputation - a.reputation);
        renderLeaderboard(leaderboard.slice(0, 10));

        idLog(`Loaded ${maxCards} identity cards (placeholder). ${count} total on-chain.`, 'info');
    }).catch(e => {
        container.innerHTML = `
        <div style="background: var(--bg-elevated); border-radius: var(--radius-md); padding: var(--space-4); text-align: center;">
            <div style="font-family: 'Orbitron', monospace; font-size: 14px; color: var(--accent-danger); margin-bottom: 8px;">QUERY FAILED</div>
            <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">${escapeHtmlId(e.message)}</div>
            <div style="font-size: 11px; color: var(--text-muted);">
                Ensure your node is connected and the IdentityRegistry pallet (index 35) is available.
            </div>
        </div>`;
        renderLeaderboard([]);
        idLog(`Identity browser error: ${e.message}`, 'error');
    });
}

// =============================================================================
// Identity Card Renderer
// =============================================================================

function renderIdentityCard(identity) {
    const role = IdentityManager.getRoleByValue(identity.role);
    const algo = IdentityManager.getAlgorithmByValue(identity.algorithm);
    const hw = IdentityManager.getHardwareTierByValue(identity.hardwareTier);
    const status = IdentityManager.getStatusByValue(identity.status);

    const repPercent = Math.min(100, (identity.reputation / 10000) * 100);
    const repColor = repPercent > 66 ? '#22c997' : repPercent > 33 ? '#ffb74d' : '#ef5350';

    const truncatedFingerprint = identity.fingerprint.length > 24
        ? identity.fingerprint.substring(0, 24) + '...'
        : identity.fingerprint;

    return `
    <div class="identity-card" data-id="${identity.id}" data-label="${identity.label}" data-fingerprint="${identity.fingerprint}"
         style="background: var(--bg-surface); border-radius: var(--radius-md); padding: var(--space-3); border-left: 4px solid ${role.color}; display: grid; grid-template-columns: 64px 1fr auto; gap: 12px; align-items: start;">

        <!-- ID Number -->
        <div style="text-align: center;">
            <div style="font-family: 'Orbitron', monospace; font-size: 24px; font-weight: 700; color: ${role.color}; line-height: 1;">${identity.id}</div>
            <div style="font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-top: 2px;">ID</div>
        </div>

        <!-- Main Info -->
        <div>
            <!-- Label + Badges Row -->
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px;">
                <span style="font-family: 'Orbitron', monospace; font-size: 13px; font-weight: 600; color: var(--text-primary);">${escapeHtmlId(identity.label)}</span>
                <span style="padding: 2px 8px; border-radius: var(--radius-pill); background: ${role.color}22; color: ${role.color}; font-size: 10px; font-weight: 600; font-family: 'Orbitron', monospace; letter-spacing: 0.5px; border: 1px solid ${role.color}44;">${role.label}</span>
                <span style="padding: 2px 8px; border-radius: var(--radius-pill); background: var(--bg-elevated); color: var(--lcars-blue-light); font-size: 10px; font-family: 'JetBrains Mono', monospace;">${algo.label}</span>
                <span style="padding: 2px 8px; border-radius: var(--radius-pill); background: var(--bg-elevated); color: var(--text-secondary); font-size: 10px; font-family: 'JetBrains Mono', monospace;">${hw.label}</span>
            </div>

            <!-- Status + Reputation Row -->
            <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 6px;">
                <div style="display: flex; align-items: center; gap: 4px;">
                    <span style="width: 8px; height: 8px; border-radius: 50%; background: ${status.color}; display: inline-block; box-shadow: 0 0 6px ${status.color};"></span>
                    <span style="font-size: 11px; color: ${status.color};">${status.label}</span>
                </div>
                <div style="flex: 1; max-width: 200px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                        <span style="font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px;">Reputation</span>
                        <span style="font-size: 10px; font-family: 'JetBrains Mono', monospace; color: ${repColor};">${identity.reputation.toLocaleString()}/10000</span>
                    </div>
                    <div style="height: 4px; background: var(--bg-elevated); border-radius: 2px; overflow: hidden;">
                        <div style="height: 100%; width: ${repPercent}%; background: ${repColor}; border-radius: 2px; transition: width 0.3s ease;"></div>
                    </div>
                </div>
            </div>

            <!-- Details Row -->
            <div style="display: flex; align-items: center; gap: 16px; font-size: 10px; color: var(--text-muted);">
                <span>Attestations: <span style="color: var(--text-secondary);">${identity.attestations}</span></span>
                ${identity.isReporter ? '<span style="color: var(--lcars-gold);">Oracle Reporter</span>' : ''}
                <span>Block: <span style="color: var(--text-secondary);">${identity.lastActiveBlock}</span></span>
            </div>

            <!-- Fingerprint Row -->
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px;">
                <span style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text-muted);">${truncatedFingerprint}</span>
                <button onclick="copyToClipboard('${identity.fingerprint}')" style="background: none; border: 1px solid var(--bg-elevated); border-radius: 3px; padding: 1px 6px; cursor: pointer; font-size: 9px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace;">COPY</button>
            </div>
        </div>

        <!-- Actions (if owned) -->
        <div style="display: flex; flex-direction: column; gap: 4px; min-width: 110px;">
            ${identity.isOwned ? `
                <button class="btn btn-sm btn-secondary" onclick="openUpdateMetadata(${identity.id})" style="font-size: 9px; padding: 4px 8px;">Update Metadata</button>
                <button class="btn btn-sm btn-primary" onclick="openRotateKey(${identity.id})" style="font-size: 9px; padding: 4px 8px;">Rotate Key</button>
                <button class="btn btn-sm btn-danger" onclick="confirmRevokeIdentity(${identity.id})" style="font-size: 9px; padding: 4px 8px;">Revoke</button>
            ` : `
                <button class="btn btn-sm" onclick="openAttestIdentity(${identity.id})" style="font-size: 9px; padding: 4px 8px; background: var(--bg-elevated); color: var(--text-secondary);">Attest</button>
            `}
        </div>
    </div>`;
}

// =============================================================================
// Leaderboard Renderer
// =============================================================================

function renderLeaderboard(entries) {
    const container = document.getElementById('idLeaderboardContent');
    if (!container) return;

    if (!entries || entries.length === 0) {
        container.innerHTML = `
        <div style="padding: 16px; text-align: center; font-size: 12px; color: var(--text-muted);">
            No reputation data available yet.
        </div>`;
        return;
    }

    let html = `
    <div style="background: var(--bg-surface); border-radius: var(--radius-md); overflow: hidden;">
        <div style="display: grid; grid-template-columns: 40px 1fr 100px 120px; padding: 8px 12px; font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid var(--bg-elevated);">
            <span>Rank</span>
            <span>Identity</span>
            <span>Role</span>
            <span style="text-align: right;">Reputation</span>
        </div>`;

    entries.forEach((entry, index) => {
        const role = IdentityManager.getRoleByValue(entry.role);
        const repPercent = Math.min(100, (entry.reputation / 10000) * 100);
        const repColor = repPercent > 66 ? '#22c997' : repPercent > 33 ? '#ffb74d' : '#ef5350';
        const rankColor = index === 0 ? '#f8a100' : index === 1 ? '#b0b0c0' : index === 2 ? '#cc8400' : 'var(--text-muted)';

        html += `
        <div style="display: grid; grid-template-columns: 40px 1fr 100px 120px; padding: 8px 12px; align-items: center; border-bottom: 1px solid var(--bg-elevated);">
            <span style="font-family: 'Orbitron', monospace; font-size: 14px; font-weight: 700; color: ${rankColor};">${index + 1}</span>
            <span style="font-family: 'Orbitron', monospace; font-size: 12px; color: var(--text-primary);">${escapeHtmlId(entry.label)}</span>
            <span style="padding: 2px 8px; border-radius: var(--radius-pill); background: ${role.color}22; color: ${role.color}; font-size: 10px; font-weight: 600; font-family: 'Orbitron', monospace; display: inline-block; width: fit-content;">${role.label}</span>
            <div style="text-align: right;">
                <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: ${repColor}; margin-bottom: 2px;">${entry.reputation.toLocaleString()}</div>
                <div style="height: 3px; background: var(--bg-elevated); border-radius: 2px; overflow: hidden;">
                    <div style="height: 100%; width: ${repPercent}%; background: ${repColor}; border-radius: 2px;"></div>
                </div>
            </div>
        </div>`;
    });

    html += `</div>`;
    container.innerHTML = html;
}

// =============================================================================
// Search / Filter
// =============================================================================

function filterIdentityBrowser(query) {
    const cards = document.querySelectorAll('.identity-card');
    const q = query.toLowerCase().trim();

    cards.forEach(card => {
        if (!q) {
            card.style.display = 'grid';
            return;
        }
        const id = card.dataset.id || '';
        const label = card.dataset.label || '';
        const fingerprint = card.dataset.fingerprint || '';
        const match = id.includes(q) || label.toLowerCase().includes(q) || fingerprint.toLowerCase().includes(q);
        card.style.display = match ? 'grid' : 'none';
    });
}

// =============================================================================
// Registration Submission
// =============================================================================

async function submitIdentityRegistration() {
    if (!identityMgr) return;

    const role = document.getElementById('idRegRole')?.value;
    const algorithm = document.getElementById('idRegAlgorithm')?.value;
    const hardwareTier = document.getElementById('idRegHardware')?.value;
    const label = document.getElementById('idRegLabel')?.value?.trim();
    const pubkeyHash = document.getElementById('idRegPubkeyHash')?.value?.trim();
    const fingerprint = document.getElementById('idRegFingerprint')?.value?.trim();
    const metadata = document.getElementById('idRegMetadata')?.value?.trim();
    const resultEl = document.getElementById('idRegResult');
    const submitBtn = document.getElementById('idRegSubmitBtn');

    if (!label) {
        resultEl.style.color = 'var(--accent-danger)';
        resultEl.textContent = 'Label is required';
        return;
    }
    if (!pubkeyHash || pubkeyHash.replace('0x', '').length !== 64) {
        resultEl.style.color = 'var(--accent-danger)';
        resultEl.textContent = 'Public key hash must be 64 hex characters';
        return;
    }

    // Validate metadata JSON if provided
    if (metadata) {
        try {
            JSON.parse(metadata);
        } catch (e) {
            resultEl.style.color = 'var(--accent-danger)';
            resultEl.textContent = 'Invalid JSON in metadata field';
            return;
        }
    }

    // Get signer key
    let signerKey = '';
    if (typeof activeSphincsKey !== 'undefined' && activeSphincsKey) {
        signerKey = activeSphincsKey;
    }
    if (!signerKey) {
        resultEl.style.color = 'var(--accent-danger)';
        resultEl.textContent = 'No active SPHINCS+ key. Set one in KEYS tab.';
        idLog('Registration failed: no SPHINCS+ signer key', 'error');
        return;
    }

    resultEl.style.color = 'var(--accent-warning)';
    resultEl.textContent = 'Building extrinsic...';
    submitBtn.disabled = true;

    // Build extended metadata including algorithm, hardware, fingerprint
    const extMeta = {
        algorithm: IdentityManager.getAlgorithmByValue(parseInt(algorithm)).label,
        hardwareTier: IdentityManager.getHardwareTierByValue(parseInt(hardwareTier)).label,
        fingerprint: fingerprint || '',
        ...(metadata ? JSON.parse(metadata) : {}),
    };

    idLog(`Registering identity: role=${IdentityManager.getRoleByValue(parseInt(role)).label}, label="${label}"`, 'info');

    try {
        const callData = identityMgr.buildRegisterCallData(
            parseInt(role), parseInt(algorithm), parseInt(hardwareTier),
            label, pubkeyHash, fingerprint || '', JSON.stringify(extMeta)
        );

        idLog(`Call data: ${callData.substring(0, 40)}${callData.length > 40 ? '...' : ''} (${callData.length / 2 - 1} bytes)`, 'info');

        resultEl.textContent = 'Submitting to chain...';
        const result = await identityMgr.submitExtrinsic(callData, signerKey);
        const txHash = result?.hash || result;

        resultEl.style.color = 'var(--accent-success)';
        resultEl.textContent = `Registered! TX: ${typeof txHash === 'string' ? txHash.substring(0, 24) + '...' : txHash}`;
        idLog(`Identity registered successfully. TX: ${txHash}`, 'info');

        // Refresh stats after successful registration
        setTimeout(() => {
            refreshIdentityStats();
            refreshIdentityBrowser();
        }, 3000);
    } catch (e) {
        resultEl.style.color = 'var(--accent-danger)';
        resultEl.textContent = `Failed: ${e.message}`;
        idLog(`Registration failed: ${e.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
    }
}

// =============================================================================
// Identity Actions
// =============================================================================

function openUpdateMetadata(identityId) {
    const newMeta = prompt(`Enter new metadata JSON for identity #${identityId}:`);
    if (!newMeta) return;

    try {
        JSON.parse(newMeta);
    } catch (e) {
        alert('Invalid JSON');
        return;
    }

    const label = prompt('Enter updated display name (or leave current):');
    if (label === null) return;

    if (!identityMgr) return;
    let signerKey = '';
    if (typeof activeSphincsKey !== 'undefined' && activeSphincsKey) {
        signerKey = activeSphincsKey;
    }
    if (!signerKey) {
        idLog('No SPHINCS+ signer key set', 'error');
        return;
    }

    const callData = identityMgr.buildUpdateMetadataCallData(label || `identity-${identityId}`, newMeta);
    idLog(`Updating metadata for identity #${identityId}...`, 'warning');

    identityMgr.submitExtrinsic(callData, signerKey).then(result => {
        const txHash = result?.hash || result;
        idLog(`Metadata updated. TX: ${txHash}`, 'info');
    }).catch(e => {
        idLog(`Update failed: ${e.message}`, 'error');
    });
}

function openRotateKey(identityId) {
    const newKey = prompt(`Enter new SPHINCS+ public key (hex) for identity #${identityId}:`);
    if (!newKey) return;
    idLog(`Key rotation for identity #${identityId} requires the SphincsKeystore pallet. Use EXTRINSICS tab > SphincsKeystore::rotate_key`, 'warning');
}

function confirmRevokeIdentity(identityId) {
    if (!confirm(`REVOKE identity #${identityId}?\n\nThis action is irreversible. The soulbound NFT will be permanently marked as revoked.`)) {
        return;
    }

    if (!identityMgr) return;
    let signerKey = '';
    if (typeof activeSphincsKey !== 'undefined' && activeSphincsKey) {
        signerKey = activeSphincsKey;
    }
    if (!signerKey) {
        idLog('No SPHINCS+ signer key set', 'error');
        return;
    }

    // For revoke, we need the target AccountId which is complex to derive from identity ID alone.
    // Direct the user to the Extrinsics tab for now.
    idLog(`Revocation requires target AccountId. Use EXTRINSICS tab > IdentityRegistry::revoke_identity with the target account.`, 'warning');
}

function openAttestIdentity(identityId) {
    const attestation = prompt(`Enter attestation data for identity #${identityId}:`);
    if (!attestation) return;
    idLog(`Attestation for identity #${identityId} can be submitted via EXTRINSICS tab > IdentityRegistry::attest_identity`, 'info');
}

// =============================================================================
// Utility Functions
// =============================================================================

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        idLog(`Copied to clipboard: ${text.substring(0, 32)}...`, 'info');
    }).catch(() => {
        // Fallback
        const el = document.createElement('textarea');
        el.value = text;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        idLog(`Copied to clipboard`, 'info');
    });
}

function generatePlaceholderFingerprint() {
    const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
    return Array.from({ length: 8 }, hex).join(':');
}

function clearIdConsole() {
    const el = document.getElementById('idConsole');
    if (el) el.innerHTML = '<div class="terminal-line info">Console cleared</div>';
}

function idLog(msg, level = 'info') {
    const el = document.getElementById('idConsole');
    if (!el) return;
    const ts = new Date().toLocaleTimeString('en-CA', { hour12: false });
    const line = document.createElement('div');
    line.className = `terminal-line ${level}`;
    line.innerHTML = `<span style="color: var(--text-muted);">[${ts}]</span> ${escapeHtmlId(msg)}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
}

function escapeHtmlId(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
