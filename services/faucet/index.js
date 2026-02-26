/**
 * QuantumHarmony Faucet Service - SPHINCS+ Version
 * Uses gateway_submit RPC with SPHINCS+ signing
 */

const express = require('express');
const cors = require('cors');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const PORT = process.env.FAUCET_PORT || 8085;
const RPC_HOST = 'node';
const RPC_PORT = 9944;
const DRIP_AMOUNT = process.env.DRIP_AMOUNT || '100000000000000000000';
const COOLDOWN_MS = process.env.COOLDOWN_MS || 60000;

// SPHINCS+ Alice credentials
const ALICE_ADDRESS = '5HDjAbVHMuJzezSccj6eFrEA6nKjonrFRm8h7aTiJXSHP5Qi';
const ALICE_SECRET = process.env.FAUCET_SECRET_KEY;
if (!ALICE_SECRET) { throw new Error('FAUCET_SECRET_KEY environment variable is required'); }

const recentDrips = new Map();

// RPC helper using http module
function rpcCall(method, params) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method,
            params
        });

        const options = {
            hostname: RPC_HOST,
            port: RPC_PORT,
            path: '/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    if (json.error) reject(new Error(json.error.message));
                    else resolve(json.result);
                } catch (e) {
                    reject(new Error('Invalid JSON response'));
                }
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function getNonce(address) {
    return await rpcCall('gateway_nonce', [address]);
}

async function getGenesisHash() {
    return await rpcCall('gateway_genesisHash', []);
}

async function getBalance(address) {
    return await rpcCall('gateway_balance', [address]);
}

app.get('/health', async (req, res) => {
    try {
        const balance = await getBalance(ALICE_ADDRESS);
        res.json({
            status: 'ok',
            service: 'faucet',
            connected: true,
            faucetAddress: ALICE_ADDRESS,
            balance: balance
        });
    } catch (e) {
        res.json({ status: 'error', service: 'faucet', connected: false, error: e.message });
    }
});

app.post('/drip', async (req, res) => {
    try {
        const { address } = req.body;

        if (!address) {
            return res.status(400).json({ success: false, error: 'Address is required' });
        }

        if (!address.startsWith('5') || address.length < 47 || address.length > 49) {
            return res.status(400).json({ success: false, error: 'Invalid address format' });
        }

        const lastDrip = recentDrips.get(address);
        if (lastDrip && Date.now() - lastDrip < COOLDOWN_MS) {
            const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - lastDrip)) / 1000);
            return res.status(429).json({
                success: false,
                error: 'Please wait ' + remaining + ' seconds before requesting again'
            });
        }

        console.log('Dripping ' + DRIP_AMOUNT + ' to ' + address + '...');

        const nonce = await getNonce(ALICE_ADDRESS);
        const genesisHash = await getGenesisHash();

        const result = await rpcCall('gateway_submit', [{
            from: ALICE_ADDRESS,
            to: address,
            amount: DRIP_AMOUNT,
            nonce: nonce,
            genesisHash: genesisHash,
            secretKey: ALICE_SECRET
        }]);

        recentDrips.set(address, Date.now());

        console.log('Drip successful: ' + result.hash);
        res.json({
            success: true,
            tx_hash: result.hash,
            amount: DRIP_AMOUNT,
            segment: result.segment
        });

    } catch (e) {
        console.error('Drip error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/generate', (req, res) => {
    res.status(501).json({ error: 'Use dashboard for key generation' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('Faucet account: ' + ALICE_ADDRESS);
    console.log('Faucet running on http://0.0.0.0:' + PORT);
    console.log('Drip amount: ' + DRIP_AMOUNT);
    console.log('Cooldown: ' + (COOLDOWN_MS/1000) + ' seconds');
    
    getBalance(ALICE_ADDRESS).then(bal => {
        console.log('Faucet balance: ' + bal);
    }).catch(e => {
        console.error('Could not get balance:', e.message);
    });
});
