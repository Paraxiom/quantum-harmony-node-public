#!/usr/bin/env node
/**
 * QuantumHarmony Network Health Agent
 *
 * Monitors network health and prevents 2-day recovery cycles by:
 * 1. Continuous block production monitoring
 * 2. Finalization progress tracking
 * 3. Peer connectivity checks
 * 4. Pre-upgrade validation
 * 5. Automatic alerting
 *
 * Usage:
 *   node network-health-agent.js monitor          # Continuous monitoring
 *   node network-health-agent.js check            # Single health check
 *   node network-health-agent.js pre-upgrade      # Pre-upgrade validation
 *   node network-health-agent.js validate-runtime # Validate runtime WASM
 */

const VALIDATORS = {
    alice: { name: 'Alice', ip: '51.79.26.123', rpc: 'http://51.79.26.123:9944' },
    bob: { name: 'Bob', ip: '51.79.26.168', rpc: 'http://51.79.26.168:9944' },
    charlie: { name: 'Charlie', ip: '209.38.225.4', rpc: 'http://209.38.225.4:9944' }
};

const LOCAL_RPC = process.env.RPC_ENDPOINT || 'http://127.0.0.1:9944';
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || '10000'); // 10 seconds
const BLOCK_TIMEOUT = parseInt(process.env.BLOCK_TIMEOUT || '30000'); // 30 seconds max between blocks
const FINALITY_LAG_THRESHOLD = parseInt(process.env.FINALITY_LAG || '100'); // blocks behind

// State tracking
let lastBlock = 0;
let lastBlockTime = Date.now();
let lastFinalized = 0;
let consecutiveFailures = 0;
const MAX_FAILURES = 3;

// ============================================
// RPC HELPERS
// ============================================
async function rpc(endpoint, method, params = []) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            signal: controller.signal
        });
        clearTimeout(timeout);

        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        return data.result;
    } catch (e) {
        return null;
    }
}

async function rpcLocal(method, params = []) {
    return rpc(LOCAL_RPC, method, params);
}

// ============================================
// HEALTH CHECKS
// ============================================
async function checkNodeHealth(name, endpoint) {
    const health = await rpc(endpoint, 'system_health');
    const header = await rpc(endpoint, 'chain_getHeader');
    const finalized = await rpc(endpoint, 'chain_getFinalizedHead');

    if (!health || !header) {
        return { name, status: 'OFFLINE', peers: 0, block: 0, finalized: 0 };
    }

    const finalizedHeader = finalized ? await rpc(endpoint, 'chain_getHeader', [finalized]) : null;
    const blockNum = parseInt(header.number, 16);
    const finalizedNum = finalizedHeader ? parseInt(finalizedHeader.number, 16) : 0;

    return {
        name,
        status: health.isSyncing ? 'SYNCING' : 'HEALTHY',
        peers: health.peers,
        block: blockNum,
        finalized: finalizedNum,
        lag: blockNum - finalizedNum
    };
}

async function checkAllValidators() {
    const results = await Promise.all([
        checkNodeHealth('Alice', VALIDATORS.alice.rpc),
        checkNodeHealth('Bob', VALIDATORS.bob.rpc),
        checkNodeHealth('Charlie', VALIDATORS.charlie.rpc)
    ]);
    return results;
}

async function checkLocalNode() {
    return checkNodeHealth('Local', LOCAL_RPC);
}

// ============================================
// MONITORING
// ============================================
function formatStatus(status) {
    switch(status) {
        case 'HEALTHY': return '\x1b[32mHEALTHY\x1b[0m';
        case 'SYNCING': return '\x1b[33mSYNCING\x1b[0m';
        case 'OFFLINE': return '\x1b[31mOFFLINE\x1b[0m';
        default: return status;
    }
}

function printHealthReport(validators, local) {
    const now = new Date().toISOString();
    console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
    console.log(`║  QUANTUM HARMONY NETWORK HEALTH - ${now.slice(11, 19)}  ║`);
    console.log(`╠═══════════════════════════════════════════════════════════╣`);

    validators.forEach(v => {
        const statusStr = formatStatus(v.status).padEnd(20);
        console.log(`║  ${v.name.padEnd(8)} │ ${statusStr} │ Block: ${String(v.block).padStart(6)} │ Peers: ${v.peers} │ Lag: ${v.lag}`);
    });

    console.log(`╠═══════════════════════════════════════════════════════════╣`);
    console.log(`║  ${local.name.padEnd(8)} │ ${formatStatus(local.status).padEnd(20)} │ Block: ${String(local.block).padStart(6)} │ Peers: ${local.peers} │ Lag: ${local.lag}`);
    console.log(`╚═══════════════════════════════════════════════════════════╝`);

    // Alerts
    const alerts = [];

    // Check for offline validators
    const offline = validators.filter(v => v.status === 'OFFLINE');
    if (offline.length > 0) {
        alerts.push(`⚠️  ALERT: ${offline.length} validator(s) OFFLINE: ${offline.map(v => v.name).join(', ')}`);
    }

    // Check for high finality lag
    const highLag = validators.filter(v => v.lag > FINALITY_LAG_THRESHOLD);
    if (highLag.length > 0) {
        alerts.push(`⚠️  ALERT: High finality lag (>${FINALITY_LAG_THRESHOLD} blocks): ${highLag.map(v => `${v.name}(${v.lag})`).join(', ')}`);
    }

    // Check block production stall
    const maxBlock = Math.max(...validators.map(v => v.block));
    if (maxBlock > lastBlock) {
        lastBlock = maxBlock;
        lastBlockTime = Date.now();
        consecutiveFailures = 0;
    } else {
        const staleTime = Date.now() - lastBlockTime;
        if (staleTime > BLOCK_TIMEOUT) {
            alerts.push(`🚨 CRITICAL: No new blocks for ${Math.round(staleTime/1000)}s!`);
            consecutiveFailures++;
        }
    }

    // Check peer connectivity
    const lowPeers = validators.filter(v => v.status !== 'OFFLINE' && v.peers < 2);
    if (lowPeers.length > 0) {
        alerts.push(`⚠️  ALERT: Low peer count: ${lowPeers.map(v => `${v.name}(${v.peers})`).join(', ')}`);
    }

    if (alerts.length > 0) {
        console.log('\n' + alerts.join('\n'));
    } else {
        console.log('\n✅ All systems nominal');
    }

    return { validators, local, alerts, healthy: alerts.length === 0 };
}

async function runMonitoring() {
    console.log('🔍 Starting QuantumHarmony Network Health Monitor...');
    console.log(`   Checking every ${CHECK_INTERVAL/1000}s`);
    console.log(`   Block timeout: ${BLOCK_TIMEOUT/1000}s`);
    console.log(`   Finality lag threshold: ${FINALITY_LAG_THRESHOLD} blocks`);
    console.log('   Press Ctrl+C to stop\n');

    const check = async () => {
        try {
            const validators = await checkAllValidators();
            const local = await checkLocalNode();
            printHealthReport(validators, local);

            if (consecutiveFailures >= MAX_FAILURES) {
                console.log('\n🚨🚨🚨 CRITICAL: NETWORK MAY BE DOWN! 🚨🚨🚨');
                console.log('Action required: Check validator logs and connectivity');
            }
        } catch (e) {
            console.error('Monitor error:', e.message);
        }
    };

    await check();
    setInterval(check, CHECK_INTERVAL);
}

// ============================================
// PRE-UPGRADE VALIDATION
// ============================================
async function runPreUpgradeValidation() {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║        PRE-UPGRADE VALIDATION CHECKLIST                   ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    let passed = 0;
    let failed = 0;
    const checks = [];

    // 1. All validators online
    console.log('1️⃣  Checking validator connectivity...');
    const validators = await checkAllValidators();
    const allOnline = validators.every(v => v.status !== 'OFFLINE');
    if (allOnline) {
        console.log('   ✅ All 3 validators online');
        passed++;
    } else {
        console.log('   ❌ Some validators offline!');
        validators.filter(v => v.status === 'OFFLINE').forEach(v => {
            console.log(`      - ${v.name} is OFFLINE`);
        });
        failed++;
    }

    // 2. Block production active
    console.log('\n2️⃣  Checking block production...');
    const blocks = validators.map(v => v.block);
    const maxBlock = Math.max(...blocks);
    const minBlock = Math.min(...blocks.filter(b => b > 0));
    const blockDiff = maxBlock - minBlock;
    if (blockDiff < 10) {
        console.log(`   ✅ Validators in sync (diff: ${blockDiff} blocks)`);
        passed++;
    } else {
        console.log(`   ❌ Validators out of sync (diff: ${blockDiff} blocks)`);
        failed++;
    }

    // 3. Finalization progressing
    console.log('\n3️⃣  Checking finalization...');
    const lags = validators.filter(v => v.status !== 'OFFLINE').map(v => v.lag);
    const maxLag = Math.max(...lags);
    if (maxLag < FINALITY_LAG_THRESHOLD) {
        console.log(`   ✅ Finalization healthy (max lag: ${maxLag} blocks)`);
        passed++;
    } else {
        console.log(`   ❌ Finalization lagging (${maxLag} blocks behind)`);
        failed++;
    }

    // 4. Sufficient peer connections
    console.log('\n4️⃣  Checking peer connectivity...');
    const peerCounts = validators.filter(v => v.status !== 'OFFLINE').map(v => v.peers);
    const minPeers = Math.min(...peerCounts);
    if (minPeers >= 2) {
        console.log(`   ✅ All validators have ≥2 peers`);
        passed++;
    } else {
        console.log(`   ❌ Some validators have low peer count`);
        failed++;
    }

    // 5. Check runtime version consistency
    console.log('\n5️⃣  Checking runtime version consistency...');
    const versions = await Promise.all(
        Object.values(VALIDATORS).map(async v => {
            const ver = await rpc(v.rpc, 'state_getRuntimeVersion');
            return { name: v.name, version: ver?.specVersion || 'unknown' };
        })
    );
    const uniqueVersions = [...new Set(versions.map(v => v.version))];
    if (uniqueVersions.length === 1 && uniqueVersions[0] !== 'unknown') {
        console.log(`   ✅ All validators on runtime v${uniqueVersions[0]}`);
        passed++;
    } else {
        console.log(`   ❌ Runtime version mismatch!`);
        versions.forEach(v => console.log(`      - ${v.name}: v${v.version}`));
        failed++;
    }

    // 6. No pending transactions that could interfere
    console.log('\n6️⃣  Checking pending transaction pool...');
    const pending = await rpcLocal('author_pendingExtrinsics');
    if (pending && pending.length === 0) {
        console.log(`   ✅ Transaction pool empty`);
        passed++;
    } else if (pending) {
        console.log(`   ⚠️  ${pending.length} pending transactions`);
        passed++; // Warning but not failure
    } else {
        console.log(`   ⚠️  Could not check transaction pool`);
    }

    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log(`📊 PRE-UPGRADE VALIDATION: ${passed} passed, ${failed} failed`);
    console.log('═'.repeat(60));

    if (failed > 0) {
        console.log('\n❌ DO NOT PROCEED WITH UPGRADE');
        console.log('   Fix the issues above before upgrading.\n');
        return false;
    } else {
        console.log('\n✅ SAFE TO PROCEED WITH UPGRADE');
        console.log('   All pre-flight checks passed.\n');
        return true;
    }
}

// ============================================
// SINGLE HEALTH CHECK
// ============================================
async function runSingleCheck() {
    const validators = await checkAllValidators();
    const local = await checkLocalNode();
    const result = printHealthReport(validators, local);

    // Exit with code based on health
    process.exit(result.healthy ? 0 : 1);
}

// ============================================
// VALIDATE RUNTIME WASM
// ============================================
async function validateRuntime(wasmPath) {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║            RUNTIME WASM VALIDATION                        ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    const fs = await import('fs');
    const path = await import('path');

    // Check file exists
    if (!wasmPath) {
        console.log('Usage: node network-health-agent.js validate-runtime <path-to-wasm>');
        process.exit(1);
    }

    const fullPath = path.resolve(wasmPath);
    if (!fs.existsSync(fullPath)) {
        console.log(`❌ File not found: ${fullPath}`);
        process.exit(1);
    }

    const stats = fs.statSync(fullPath);
    console.log(`📦 WASM file: ${path.basename(fullPath)}`);
    console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    // Read and check WASM magic bytes
    const buffer = fs.readFileSync(fullPath);
    const magic = buffer.slice(0, 4);
    const isValidWasm = magic[0] === 0x00 && magic[1] === 0x61 && magic[2] === 0x73 && magic[3] === 0x6d;

    if (isValidWasm) {
        console.log(`   ✅ Valid WASM magic bytes`);
    } else {
        console.log(`   ❌ Invalid WASM file (bad magic bytes)`);
        process.exit(1);
    }

    // Calculate hash for verification
    const crypto = await import('crypto');
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    console.log(`   SHA256: ${hash.slice(0, 16)}...${hash.slice(-16)}`);

    // Check size is reasonable for a Substrate runtime
    if (stats.size < 100 * 1024) {
        console.log(`   ⚠️  Warning: WASM seems too small for a runtime`);
    } else if (stats.size > 20 * 1024 * 1024) {
        console.log(`   ⚠️  Warning: WASM seems unusually large`);
    } else {
        console.log(`   ✅ Size looks reasonable for a Substrate runtime`);
    }

    // Get current runtime version for comparison
    const currentVersion = await rpcLocal('state_getRuntimeVersion');
    if (currentVersion) {
        console.log(`\n📋 Current runtime: ${currentVersion.specName} v${currentVersion.specVersion}`);
        console.log(`   When upgrading, new specVersion should be > ${currentVersion.specVersion}`);
    }

    console.log('\n✅ WASM validation complete');
    console.log('   Ready for upgrade if pre-upgrade checks pass.\n');
}

// ============================================
// MAIN
// ============================================
const command = process.argv[2] || 'check';

switch (command) {
    case 'monitor':
        runMonitoring();
        break;
    case 'check':
        runSingleCheck();
        break;
    case 'pre-upgrade':
        runPreUpgradeValidation().then(ok => process.exit(ok ? 0 : 1));
        break;
    case 'validate-runtime':
        validateRuntime(process.argv[3]);
        break;
    default:
        console.log(`
QuantumHarmony Network Health Agent

Commands:
  monitor          Continuous health monitoring (Ctrl+C to stop)
  check            Single health check (exit code reflects health)
  pre-upgrade      Pre-upgrade validation checklist
  validate-runtime <wasm>  Validate runtime WASM file

Environment variables:
  RPC_ENDPOINT     Local RPC endpoint (default: http://127.0.0.1:9944)
  CHECK_INTERVAL   Monitoring interval in ms (default: 10000)
  BLOCK_TIMEOUT    Max time between blocks in ms (default: 30000)
  FINALITY_LAG     Max acceptable finality lag in blocks (default: 100)
`);
        process.exit(0);
}
