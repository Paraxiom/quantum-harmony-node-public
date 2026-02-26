-- QuantumHarmony KYC Database Schema
-- Stores encrypted passport images and biometric helper data
-- All sensitive data is encrypted client-side before storage

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- KYC Documents Table
-- Stores encrypted passport/ID images
-- =====================================================
CREATE TABLE kyc_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_address VARCHAR(48) NOT NULL,
    document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('passport', 'id_card', 'drivers_license', 'biometric')),

    -- Encrypted document data (AES-256-GCM encrypted client-side)
    encrypted_blob BYTEA NOT NULL,

    -- Hash of encryption key (to verify correct key used during retrieval)
    encryption_key_hash BYTEA NOT NULL,

    -- IPFS backup (optional)
    ipfs_cid VARCHAR(64),

    -- Document hash (SHA-256 of original unencrypted document)
    document_hash BYTEA NOT NULL,

    -- Metadata
    file_name VARCHAR(255),
    file_size_bytes INTEGER,
    mime_type VARCHAR(100),

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Verification status
    verified_at TIMESTAMPTZ,
    verified_by VARCHAR(48),  -- Validator address who verified
    verification_tx_hash VARCHAR(66),  -- On-chain verification transaction
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected', 'expired')),
    rejection_reason TEXT,

    -- Indexes for common queries
    CONSTRAINT unique_account_document UNIQUE (account_address, document_type)
);

CREATE INDEX idx_kyc_account ON kyc_documents(account_address);
CREATE INDEX idx_kyc_status ON kyc_documents(status);
CREATE INDEX idx_kyc_document_hash ON kyc_documents(document_hash);
CREATE INDEX idx_kyc_created ON kyc_documents(created_at DESC);

-- =====================================================
-- Biometric Helper Data Table
-- Stores fuzzy commitment data for biometric key recovery
-- =====================================================
CREATE TABLE biometric_helper_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_address VARCHAR(48) NOT NULL UNIQUE,

    -- Helper data (XOR of biometric template and QRNG entropy)
    -- Safe to store - reveals nothing without the biometric
    helper_data BYTEA NOT NULL,

    -- Encrypted QRNG backup (encrypted with user's password)
    encrypted_qrng BYTEA NOT NULL,

    -- Hash of biometric template (for verification during recovery)
    bio_template_hash BYTEA NOT NULL,

    -- IPFS backup of helper data
    ipfs_cid VARCHAR(64),

    -- QRNG source information
    qrng_source VARCHAR(50) DEFAULT 'crypto4a',
    qrng_timestamp TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_recovery_attempt TIMESTAMPTZ,
    recovery_attempts INTEGER DEFAULT 0
);

CREATE INDEX idx_bio_account ON biometric_helper_data(account_address);
CREATE INDEX idx_bio_template_hash ON biometric_helper_data(bio_template_hash);

-- =====================================================
-- KYC Verification Requests Table
-- Tracks verification workflow
-- =====================================================
CREATE TABLE kyc_verification_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_address VARCHAR(48) NOT NULL,

    -- Document references
    passport_doc_id UUID REFERENCES kyc_documents(id),
    biometric_doc_id UUID REFERENCES kyc_documents(id),

    -- On-chain hashes
    biometric_hash BYTEA,
    passport_hash BYTEA,

    -- Verification tier requested
    tier_requested VARCHAR(20) NOT NULL CHECK (tier_requested IN ('basic', 'standard', 'premium')),

    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'approved', 'rejected')),

    -- Validator assignments (for multi-validator verification)
    assigned_validators VARCHAR(48)[],
    approvals INTEGER DEFAULT 0,
    rejections INTEGER DEFAULT 0,
    required_approvals INTEGER DEFAULT 2,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- On-chain reference
    attestation_id BIGINT,
    tx_hash VARCHAR(66)
);

CREATE INDEX idx_kyc_req_account ON kyc_verification_requests(account_address);
CREATE INDEX idx_kyc_req_status ON kyc_verification_requests(status);

-- =====================================================
-- Ricardian Contracts Table
-- Stores encrypted contract terms
-- =====================================================
CREATE TABLE ricardian_contracts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Contract parties
    creator_address VARCHAR(48) NOT NULL,
    counterparty_address VARCHAR(48),

    -- Contract metadata
    title VARCHAR(255) NOT NULL,
    contract_type INTEGER NOT NULL,
    jurisdiction VARCHAR(100),

    -- Contract content (encrypted if private)
    terms_hash BYTEA NOT NULL,  -- SHA-256 of plaintext terms
    encrypted_terms BYTEA,      -- AES-256-GCM encrypted terms (if private)
    is_encrypted BOOLEAN DEFAULT FALSE,

    -- IPFS storage
    ipfs_cid VARCHAR(64),

    -- Signatures
    creator_signature BYTEA,
    counterparty_signature BYTEA,

    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_signature', 'active', 'completed', 'disputed', 'terminated')),

    -- On-chain reference
    on_chain_id BIGINT,
    creation_tx_hash VARCHAR(66),

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    signed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
);

CREATE INDEX idx_contract_creator ON ricardian_contracts(creator_address);
CREATE INDEX idx_contract_counterparty ON ricardian_contracts(counterparty_address);
CREATE INDEX idx_contract_status ON ricardian_contracts(status);

-- =====================================================
-- Audit Log Table
-- Tracks all sensitive operations
-- =====================================================
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Actor
    account_address VARCHAR(48),
    ip_address INET,

    -- Action
    action VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID,

    -- Details
    details JSONB,

    -- Result
    success BOOLEAN NOT NULL,
    error_message TEXT
);

CREATE INDEX idx_audit_timestamp ON audit_log(timestamp DESC);
CREATE INDEX idx_audit_account ON audit_log(account_address);
CREATE INDEX idx_audit_action ON audit_log(action);

-- =====================================================
-- Replication user (for streaming replication)
-- Created by 00-set-replicator-password.sh using $REPLICATOR_PASSWORD env var
-- =====================================================

-- =====================================================
-- Functions
-- =====================================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER update_kyc_documents_updated_at
    BEFORE UPDATE ON kyc_documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_biometric_helper_data_updated_at
    BEFORE UPDATE ON biometric_helper_data
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Audit logging function
CREATE OR REPLACE FUNCTION log_audit(
    p_account VARCHAR(48),
    p_action VARCHAR(50),
    p_resource_type VARCHAR(50),
    p_resource_id UUID,
    p_details JSONB,
    p_success BOOLEAN,
    p_error TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO audit_log (account_address, action, resource_type, resource_id, details, success, error_message)
    VALUES (p_account, p_action, p_resource_type, p_resource_id, p_details, p_success, p_error);
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Initial data
-- =====================================================

-- Log database creation
INSERT INTO audit_log (action, resource_type, details, success)
VALUES ('database_init', 'system', '{"version": "1.0.0", "created": "2026-01-21"}', true);

COMMENT ON DATABASE quantumharmony IS 'QuantumHarmony KYC and Document Storage - All sensitive data encrypted client-side';
