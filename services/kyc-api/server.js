/**
 * QuantumHarmony KYC API
 * Handles encrypted KYC document storage and retrieval
 *
 * All documents are encrypted client-side before upload.
 * This service only stores and retrieves encrypted blobs.
 */

const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 8200;

// Database connection
if (!process.env.DATABASE_URL) {
    console.error('FATAL: DATABASE_URL environment variable is required');
    process.exit(1);
}
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '50mb' }));

// API key authentication (skip health check)
app.use((req, res, next) => {
    if (req.path === '/health') return next();

    const apiKey = process.env.KYC_API_KEY;
    if (!apiKey) {
        return res.status(503).json({ error: 'Service not configured' });
    }
    if (req.headers['x-api-key'] !== apiKey) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
});

// Multer for file uploads (in-memory storage)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

// Health check
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({
            status: 'healthy',
            service: 'kyc-api',
            database: 'connected',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('Health check error:', err);
        res.status(500).json({
            status: 'unhealthy',
            service: 'kyc-api',
            database: 'disconnected',
            error: 'Internal server error'
        });
    }
});

// =====================================================
// KYC Document Endpoints
// =====================================================

/**
 * Upload encrypted KYC document
 * POST /api/kyc/document
 */
app.post('/api/kyc/document', upload.single('document'), async (req, res) => {
    try {
        const {
            account_address,
            document_type,
            encryption_key_hash,
            document_hash,
            ipfs_cid,
            file_name,
            mime_type
        } = req.body;

        if (!account_address || !document_type || !req.file) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const encrypted_blob = req.file.buffer;

        const result = await pool.query(`
            INSERT INTO kyc_documents
            (account_address, document_type, encrypted_blob, encryption_key_hash, document_hash, ipfs_cid, file_name, file_size_bytes, mime_type)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (account_address, document_type)
            DO UPDATE SET
                encrypted_blob = EXCLUDED.encrypted_blob,
                encryption_key_hash = EXCLUDED.encryption_key_hash,
                document_hash = EXCLUDED.document_hash,
                ipfs_cid = EXCLUDED.ipfs_cid,
                file_name = EXCLUDED.file_name,
                file_size_bytes = EXCLUDED.file_size_bytes,
                mime_type = EXCLUDED.mime_type,
                updated_at = NOW(),
                status = 'pending'
            RETURNING id, created_at
        `, [
            account_address,
            document_type,
            encrypted_blob,
            Buffer.from(encryption_key_hash || '', 'hex'),
            Buffer.from(document_hash?.replace('0x', '') || '', 'hex'),
            ipfs_cid,
            file_name,
            encrypted_blob.length,
            mime_type
        ]);

        // Log audit
        await pool.query(`SELECT log_audit($1, $2, $3, $4, $5, $6)`, [
            account_address,
            'document_upload',
            'kyc_documents',
            result.rows[0].id,
            JSON.stringify({ document_type, file_size: encrypted_blob.length }),
            true
        ]);

        res.json({
            success: true,
            id: result.rows[0].id,
            created_at: result.rows[0].created_at
        });
    } catch (err) {
        console.error('Document upload error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Get encrypted KYC document
 * GET /api/kyc/document/:account/:type
 */
app.get('/api/kyc/document/:account/:type', async (req, res) => {
    try {
        const { account, type } = req.params;

        const result = await pool.query(`
            SELECT id, encrypted_blob, document_hash, ipfs_cid, file_name, mime_type, status, created_at
            FROM kyc_documents
            WHERE account_address = $1 AND document_type = $2
        `, [account, type]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Document not found' });
        }

        const doc = result.rows[0];

        res.json({
            id: doc.id,
            encrypted_blob: doc.encrypted_blob.toString('base64'),
            document_hash: '0x' + doc.document_hash.toString('hex'),
            ipfs_cid: doc.ipfs_cid,
            file_name: doc.file_name,
            mime_type: doc.mime_type,
            status: doc.status,
            created_at: doc.created_at
        });
    } catch (err) {
        console.error('Document retrieval error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Get KYC status for account
 * GET /api/kyc/status/:account
 */
app.get('/api/kyc/status/:account', async (req, res) => {
    try {
        const { account } = req.params;

        const docs = await pool.query(`
            SELECT document_type, status, verified_at, created_at
            FROM kyc_documents
            WHERE account_address = $1
        `, [account]);

        const request = await pool.query(`
            SELECT status, tier_requested, approvals, required_approvals, created_at
            FROM kyc_verification_requests
            WHERE account_address = $1
            ORDER BY created_at DESC
            LIMIT 1
        `, [account]);

        res.json({
            documents: docs.rows,
            verification_request: request.rows[0] || null,
            kyc_tier: calculateKycTier(docs.rows, request.rows[0])
        });
    } catch (err) {
        console.error('Status check error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

function calculateKycTier(docs, request) {
    if (!request || request.status !== 'approved') {
        return { tier: 'uncertified', multiplier: 0.7 };
    }
    if (request.tier_requested === 'premium') {
        return { tier: 'agent_certified', multiplier: 1.2 };
    }
    return { tier: 'kyc_verified', multiplier: 1.0 };
}

// =====================================================
// Biometric Helper Data Endpoints
// =====================================================

/**
 * Store biometric helper data
 * POST /api/biometric/helper
 */
app.post('/api/biometric/helper', async (req, res) => {
    try {
        const {
            account_address,
            helper_data,
            encrypted_qrng,
            bio_template_hash,
            ipfs_cid
        } = req.body;

        if (!account_address || !helper_data || !encrypted_qrng) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const result = await pool.query(`
            INSERT INTO biometric_helper_data
            (account_address, helper_data, encrypted_qrng, bio_template_hash, ipfs_cid, qrng_timestamp)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (account_address)
            DO UPDATE SET
                helper_data = EXCLUDED.helper_data,
                encrypted_qrng = EXCLUDED.encrypted_qrng,
                bio_template_hash = EXCLUDED.bio_template_hash,
                ipfs_cid = EXCLUDED.ipfs_cid,
                updated_at = NOW()
            RETURNING id, created_at
        `, [
            account_address,
            Buffer.from(helper_data, 'base64'),
            Buffer.from(encrypted_qrng, 'base64'),
            Buffer.from(bio_template_hash?.replace('0x', '') || '', 'hex'),
            ipfs_cid
        ]);

        res.json({
            success: true,
            id: result.rows[0].id,
            created_at: result.rows[0].created_at
        });
    } catch (err) {
        console.error('Helper data storage error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Get biometric helper data for recovery
 * GET /api/biometric/helper/:account
 */
app.get('/api/biometric/helper/:account', async (req, res) => {
    try {
        const { account } = req.params;

        const result = await pool.query(`
            UPDATE biometric_helper_data
            SET last_recovery_attempt = NOW(), recovery_attempts = recovery_attempts + 1
            WHERE account_address = $1
            RETURNING helper_data, encrypted_qrng, bio_template_hash, ipfs_cid
        `, [account]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No biometric data found for this account' });
        }

        const data = result.rows[0];

        res.json({
            helper_data: data.helper_data.toString('base64'),
            encrypted_qrng: data.encrypted_qrng.toString('base64'),
            bio_template_hash: '0x' + data.bio_template_hash.toString('hex'),
            ipfs_cid: data.ipfs_cid
        });
    } catch (err) {
        console.error('Helper data retrieval error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// =====================================================
// Ricardian Contracts Endpoints
// =====================================================

/**
 * Create contract
 * POST /api/contracts
 */
app.post('/api/contracts', async (req, res) => {
    try {
        const {
            creator_address,
            counterparty_address,
            title,
            contract_type,
            jurisdiction,
            terms_hash,
            encrypted_terms,
            is_encrypted,
            ipfs_cid
        } = req.body;

        if (!creator_address || !title || !terms_hash || contract_type === undefined || contract_type === null) {
            return res.status(400).json({ error: 'Missing required fields: creator_address, title, terms_hash, contract_type (integer)' });
        }

        if (typeof contract_type !== 'number' || !Number.isInteger(contract_type)) {
            return res.status(400).json({ error: 'contract_type must be an integer' });
        }

        const result = await pool.query(`
            INSERT INTO ricardian_contracts
            (creator_address, counterparty_address, title, contract_type, jurisdiction, terms_hash, encrypted_terms, is_encrypted, ipfs_cid)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id, created_at
        `, [
            creator_address,
            counterparty_address,
            title,
            contract_type,
            jurisdiction,
            Buffer.from(terms_hash?.replace('0x', '') || '', 'hex'),
            encrypted_terms ? Buffer.from(encrypted_terms, 'base64') : null,
            is_encrypted || false,
            ipfs_cid
        ]);

        res.json({
            success: true,
            id: result.rows[0].id,
            created_at: result.rows[0].created_at
        });
    } catch (err) {
        console.error('Contract creation error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Get contracts for account
 * GET /api/contracts/:account
 */
app.get('/api/contracts/:account', async (req, res) => {
    try {
        const { account } = req.params;

        const result = await pool.query(`
            SELECT id, title, contract_type, jurisdiction, status, counterparty_address, created_at, signed_at
            FROM ricardian_contracts
            WHERE creator_address = $1 OR counterparty_address = $1
            ORDER BY created_at DESC
        `, [account]);

        res.json({ contracts: result.rows });
    } catch (err) {
        console.error('Contract list error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// =====================================================
// Verification Endpoints (for validators)
// =====================================================

/**
 * Submit verification request
 * POST /api/kyc/verify
 */
app.post('/api/kyc/verify', async (req, res) => {
    try {
        const {
            account_address,
            tier_requested,
            biometric_hash,
            passport_hash
        } = req.body;

        // Get document IDs
        const docs = await pool.query(`
            SELECT id, document_type FROM kyc_documents
            WHERE account_address = $1 AND document_type IN ('passport', 'biometric')
        `, [account_address]);

        const docMap = {};
        docs.rows.forEach(d => docMap[d.document_type] = d.id);

        const result = await pool.query(`
            INSERT INTO kyc_verification_requests
            (account_address, tier_requested, passport_doc_id, biometric_doc_id, biometric_hash, passport_hash, submitted_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            RETURNING id
        `, [
            account_address,
            tier_requested || 'standard',
            docMap.passport,
            docMap.biometric,
            biometric_hash ? Buffer.from(biometric_hash.replace('0x', ''), 'hex') : null,
            passport_hash ? Buffer.from(passport_hash.replace('0x', ''), 'hex') : null
        ]);

        res.json({
            success: true,
            request_id: result.rows[0].id
        });
    } catch (err) {
        console.error('Verification request error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`QuantumHarmony KYC API listening on port ${PORT}`);
    console.log('Endpoints:');
    console.log('  GET  /health');
    console.log('  POST /api/kyc/document');
    console.log('  GET  /api/kyc/document/:account/:type');
    console.log('  GET  /api/kyc/status/:account');
    console.log('  POST /api/biometric/helper');
    console.log('  GET  /api/biometric/helper/:account');
    console.log('  POST /api/contracts');
    console.log('  GET  /api/contracts/:account');
    console.log('  POST /api/kyc/verify');
});
