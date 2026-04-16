/**
 * QuantumHarmony Extrinsics Manager
 * Handles pallet discovery, extrinsic form generation, and submission
 * via quantumharmony_submitSignedExtrinsic RPC
 */

class ExtrinsicsManager {
    constructor(rpcEndpoint = 'http://127.0.0.1:9944') {
        this.rpcEndpoint = rpcEndpoint;
        this.activePallet = null;
        this.activeCall = null;
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
    // Pallet & Extrinsic Registry (hardcoded from runtime v30)
    // =========================================================================

    getPalletRegistry() {
        return [
            // --- Core ---
            {
                name: 'System', index: 0, category: 'Core',
                description: 'Core system pallet for chain fundamentals',
                calls: [
                    { name: 'remark', index: 0, params: [{ name: 'remark', type: 'Bytes', desc: 'Arbitrary data' }] },
                    { name: 'set_heap_pages', index: 1, params: [{ name: 'pages', type: 'u64', desc: 'Heap pages count' }] },
                    { name: 'set_code', index: 2, params: [{ name: 'code', type: 'Bytes', desc: 'WASM runtime code' }] },
                    { name: 'kill_prefix', index: 6, params: [{ name: 'prefix', type: 'Bytes', desc: 'Storage prefix' }, { name: 'subkeys', type: 'u32', desc: 'Max subkeys' }] },
                    { name: 'remark_with_event', index: 7, params: [{ name: 'remark', type: 'Bytes', desc: 'Arbitrary data (emits event)' }] },
                ],
                storage: ['Account', 'BlockHash', 'Number', 'Events', 'EventCount']
            },
            {
                name: 'Timestamp', index: 1, category: 'Core',
                description: 'On-chain time management',
                calls: [
                    { name: 'set', index: 0, params: [{ name: 'now', type: 'u64', desc: 'Current timestamp (ms)' }] },
                ],
                storage: ['Now', 'DidUpdate']
            },
            {
                name: 'Balances', index: 5, category: 'Core',
                description: 'Native token balances and transfers',
                calls: [
                    { name: 'transfer_allow_death', index: 0, params: [{ name: 'dest', type: 'AccountId', desc: 'Recipient account' }, { name: 'value', type: 'u128', desc: 'Amount in planck' }] },
                    { name: 'force_transfer', index: 2, params: [{ name: 'source', type: 'AccountId', desc: 'Source account' }, { name: 'dest', type: 'AccountId', desc: 'Destination account' }, { name: 'value', type: 'u128', desc: 'Amount' }] },
                    { name: 'transfer_keep_alive', index: 3, params: [{ name: 'dest', type: 'AccountId', desc: 'Recipient account' }, { name: 'value', type: 'u128', desc: 'Amount in planck' }] },
                    { name: 'transfer_all', index: 4, params: [{ name: 'dest', type: 'AccountId', desc: 'Recipient account' }, { name: 'keep_alive', type: 'bool', desc: 'Keep sender alive' }] },
                ],
                storage: ['TotalIssuance', 'Locks', 'Reserves', 'Holds', 'Freezes']
            },
            {
                name: 'Session', index: 3, category: 'Core',
                description: 'Session key management for validators',
                calls: [
                    { name: 'set_keys', index: 0, params: [{ name: 'keys', type: 'Bytes', desc: 'Session keys (SCALE encoded)' }, { name: 'proof', type: 'Bytes', desc: 'Ownership proof' }] },
                    { name: 'purge_keys', index: 1, params: [] },
                ],
                storage: ['Validators', 'CurrentIndex', 'QueuedKeys', 'NextKeys']
            },
            {
                name: 'Sudo', index: 7, category: 'Core',
                description: 'Superuser operations (root-origin calls)',
                calls: [
                    { name: 'sudo', index: 0, params: [{ name: 'call', type: 'Call', desc: 'Encoded call to dispatch as root' }] },
                    { name: 'sudo_unchecked_weight', index: 1, params: [{ name: 'call', type: 'Call', desc: 'Call data' }, { name: 'weight', type: 'u64', desc: 'Weight override' }] },
                    { name: 'set_key', index: 2, params: [{ name: 'new', type: 'AccountId', desc: 'New sudo key' }] },
                    { name: 'sudo_as', index: 3, params: [{ name: 'who', type: 'AccountId', desc: 'Origin to impersonate' }, { name: 'call', type: 'Call', desc: 'Call data' }] },
                ],
                storage: ['Key']
            },

            // --- Transparence Integration ---
            {
                name: 'TransparenceOracle', index: 32, category: 'Transparence Integration',
                description: 'Oracle validation anchoring — 6 CI/CD plugin types',
                calls: [
                    { name: 'submit_validation', index: 0, params: [{ name: 'contract_id', type: 'u64', desc: 'Contract ID' }, { name: 'milestone_id', type: 'u64', desc: 'Milestone ID' }, { name: 'plugin', type: 'u8', desc: '0=Endpoint,1=Coverage,2=CodeAnalysis,3=Deploy,4=Visual,5=Performance' }, { name: 'evidence_hash', type: 'H256', desc: 'SHA-256 of evidence' }, { name: 'verdict', type: 'u8', desc: '0=Pending,1=Pass,2=Fail,3=Error' }, { name: 'score', type: 'u8', desc: 'Quality score 0-100' }, { name: 'ci_commit_hash', type: 'Bytes', desc: 'Git commit SHA (40 chars)' }, { name: 'metadata', type: 'Bytes', desc: 'JSON metadata' }] },
                    { name: 'revoke_validation', index: 1, params: [{ name: 'validation_id', type: 'u64', desc: 'Validation ID to revoke' }] },
                ],
                storage: ['Validations', 'NextValidationId', 'ValidationsByContract', 'ValidationsByMilestone', 'ValidationsInBlock', 'MilestoneStatus']
            },
            {
                name: 'TransparenceTwoManRule', index: 33, category: 'Transparence Integration',
                description: 'Two-Man Rule — Fragment A (human) + Fragment B (machine) for payment',
                calls: [
                    { name: 'initiate_ceremony', index: 0, params: [{ name: 'contract_id', type: 'u64', desc: 'Contract ID' }, { name: 'milestone_id', type: 'u64', desc: 'Milestone ID' }, { name: 'amount_hash', type: 'H256', desc: 'Hash of payment amount' }, { name: 'evidence_hash', type: 'H256', desc: 'Hash of oracle evidence' }] },
                    { name: 'sign_human', index: 1, params: [{ name: 'ceremony_id', type: 'u64', desc: 'Ceremony ID — Fragment A' }] },
                    { name: 'sign_machine', index: 2, params: [{ name: 'ceremony_id', type: 'u64', desc: 'Ceremony ID — Fragment B (oracle only)' }] },
                    { name: 'reject_machine', index: 3, params: [{ name: 'ceremony_id', type: 'u64', desc: 'Ceremony ID — oracle rejects (tests failed)' }] },
                    { name: 'register_oracle', index: 4, params: [{ name: 'oracle_account', type: 'AccountId', desc: 'Account to whitelist as oracle' }] },
                    { name: 'remove_oracle', index: 5, params: [{ name: 'oracle_account', type: 'AccountId', desc: 'Account to remove from oracle whitelist' }] },
                ],
                storage: ['Ceremonies', 'NextCeremonyId', 'CeremoniesByContract', 'AuthorizedOracles']
            },
            {
                name: 'TransparenceDeliverables', index: 34, category: 'Transparence Integration',
                description: 'Contract lifecycle — Draft → Active → InExecution → Completed',
                calls: [
                    { name: 'create_contract', index: 0, params: [{ name: 'title_hash', type: 'H256', desc: 'SHA-256 of contract title' }, { name: 'devis_hash', type: 'H256', desc: 'SHA-256 of devis technique' }, { name: 'supplier', type: 'AccountId', desc: 'Supplier account' }] },
                    { name: 'activate_contract', index: 1, params: [{ name: 'contract_id', type: 'u64', desc: 'Contract ID' }] },
                    { name: 'add_milestone', index: 2, params: [{ name: 'contract_id', type: 'u64', desc: 'Contract ID' }, { name: 'sequence', type: 'u32', desc: 'Milestone sequence number' }, { name: 'description_hash', type: 'H256', desc: 'SHA-256 of milestone description' }] },
                    { name: 'submit_deliverable', index: 3, params: [{ name: 'contract_id', type: 'u64', desc: 'Contract ID' }, { name: 'milestone_id', type: 'u64', desc: 'Milestone ID' }, { name: 'evidence_hash', type: 'H256', desc: 'SHA-256 of deliverable evidence' }] },
                    { name: 'record_validation_result', index: 4, params: [{ name: 'milestone_id', type: 'u64', desc: 'Milestone ID' }, { name: 'passed', type: 'bool', desc: 'Validation passed?' }] },
                    { name: 'record_payment_authorized', index: 5, params: [{ name: 'milestone_id', type: 'u64', desc: 'Milestone ID' }, { name: 'ceremony_id', type: 'u64', desc: 'Two-Man Rule ceremony ID' }] },
                    { name: 'terminate_contract', index: 6, params: [{ name: 'contract_id', type: 'u64', desc: 'Contract ID' }] },
                ],
                storage: ['Contracts', 'NextContractId', 'Milestones', 'NextMilestoneId', 'MilestonesByContract', 'ContractsByOwner', 'ContractsBySupplier']
            },

            // --- Identity ---
            {
                name: 'IdentityRegistry', index: 35, category: 'Identity',
                description: 'PQ soulbound NFT identities — register, reputation, key rotation',
                calls: [
                    { name: 'register_identity', index: 0, params: [{ name: 'role', type: 'u8', desc: '0=Shield,1=Agent,2=OracleReporter,3=Validator,4=Citizen,5=Decideur,6=Fournisseur,7=Service' }, { name: 'algorithm', type: 'u8', desc: '0=Falcon512,1=Falcon1024,2=SphincsPlus,3=MlKem1024' }, { name: 'public_key_hash', type: 'H256', desc: 'SHA-256 of public key' }, { name: 'fingerprint', type: 'Bytes', desc: 'Key fingerprint (e.g. 58:72:ac:47...)' }, { name: 'label', type: 'Bytes', desc: 'Label (e.g. shield-alice-main)' }, { name: 'metadata', type: 'Bytes', desc: 'JSON metadata' }, { name: 'hardware_tier', type: 'u8', desc: '0=Unknown,1=Edge,2=Municipal,3=Enterprise,4=Defence,5=Cloud' }] },
                    { name: 'update_metadata', index: 1, params: [{ name: 'identity_id', type: 'u64', desc: 'Identity ID' }, { name: 'new_metadata', type: 'Bytes', desc: 'New JSON metadata' }] },
                    { name: 'record_activity', index: 2, params: [{ name: 'identity_id', type: 'u64', desc: 'Identity ID' }] },
                    { name: 'update_reputation', index: 3, params: [{ name: 'identity_id', type: 'u64', desc: 'Identity ID' }, { name: 'delta', type: 'u32', desc: 'Reputation change (signed)' }] },
                    { name: 'suspend_identity', index: 4, params: [{ name: 'identity_id', type: 'u64', desc: 'Identity ID' }] },
                    { name: 'reactivate_identity', index: 5, params: [{ name: 'identity_id', type: 'u64', desc: 'Identity ID' }] },
                    { name: 'revoke_identity', index: 6, params: [{ name: 'identity_id', type: 'u64', desc: 'Identity ID (permanent)' }] },
                    { name: 'rotate_key', index: 7, params: [{ name: 'identity_id', type: 'u64', desc: 'Identity ID' }, { name: 'new_public_key_hash', type: 'H256', desc: 'New SHA-256 of public key' }, { name: 'new_fingerprint', type: 'Bytes', desc: 'New key fingerprint' }] },
                ],
                storage: ['Identities', 'NextIdentityId', 'IdentityByFingerprint', 'IdentityByPublicKeyHash', 'IdentitiesByOwner', 'IdentitiesByRole']
            },

            // --- Governance ---
            {
                name: 'DevGovernance', index: 17, category: 'Governance',
                description: 'Developer governance proposals and feature voting',
                calls: [
                    { name: 'propose', index: 0, params: [{ name: 'title', type: 'Bytes', desc: 'Proposal title' }, { name: 'description', type: 'Bytes', desc: 'Proposal description' }, { name: 'category', type: 'u8', desc: '0=Feature, 1=Bug, 2=Enhancement' }] },
                    { name: 'vote', index: 1, params: [{ name: 'proposal_id', type: 'u32', desc: 'Proposal ID' }, { name: 'approve', type: 'bool', desc: 'Vote direction' }] },
                    { name: 'finalize', index: 2, params: [{ name: 'proposal_id', type: 'u32', desc: 'Proposal to finalize' }] },
                ],
                storage: ['Proposals', 'Votes', 'ProposalCount']
            },
            {
                name: 'ValidatorGovernance', index: 18, category: 'Governance',
                description: 'Validator addition/removal governance',
                calls: [
                    { name: 'propose_validator', index: 0, params: [{ name: 'validator', type: 'AccountId', desc: 'Proposed validator account' }] },
                    { name: 'vote', index: 1, params: [{ name: 'proposal_id', type: 'u32', desc: 'Proposal ID' }, { name: 'approve', type: 'bool', desc: 'Vote (true=yes)' }] },
                    { name: 'finalize_proposal', index: 2, params: [{ name: 'proposal_id', type: 'u32', desc: 'Proposal to finalize' }] },
                ],
                storage: ['Proposals', 'ActiveProposals', 'ValidatorCount']
            },
            {
                name: 'MeshForum', index: 24, category: 'Governance',
                description: 'On-chain mesh messaging forum for validators',
                calls: [
                    { name: 'post_message', index: 0, params: [{ name: 'content', type: 'Bytes', desc: 'Message content' }] },
                    { name: 'reply', index: 1, params: [{ name: 'parent_id', type: 'u32', desc: 'Parent message ID' }, { name: 'content', type: 'Bytes', desc: 'Reply content' }] },
                    { name: 'pin_message', index: 2, params: [{ name: 'message_id', type: 'u32', desc: 'Message ID to pin' }] },
                ],
                storage: ['Messages', 'MessageCount', 'PinnedMessages']
            },
            {
                name: 'ValidatorSet', index: 19, category: 'Governance',
                description: 'Validator set management and rotation',
                calls: [
                    { name: 'add_validator', index: 0, params: [{ name: 'validator_id', type: 'AccountId', desc: 'Validator to add' }] },
                    { name: 'remove_validator', index: 1, params: [{ name: 'validator_id', type: 'AccountId', desc: 'Validator to remove' }] },
                ],
                storage: ['Validators', 'ApprovedValidators']
            },

            // --- Attestation ---
            {
                name: 'AxiomAttestation', index: 20, category: 'Attestation',
                description: 'Autonomous agent attestation and audit trail',
                calls: [
                    { name: 'submit_attestation', index: 0, params: [{ name: 'agent_id', type: 'Bytes', desc: 'Agent identifier' }, { name: 'tool_name', type: 'Bytes', desc: 'Tool used' }, { name: 'input_hash', type: 'H256', desc: 'Hash of input' }, { name: 'output_hash', type: 'H256', desc: 'Hash of output' }, { name: 'tier', type: 'u8', desc: '0=Info, 1=Action, 2=Financial, 3=Critical' }] },
                    { name: 'verify_attestation', index: 1, params: [{ name: 'attestation_id', type: 'u32', desc: 'Attestation ID' }] },
                    { name: 'flag_attestation', index: 2, params: [{ name: 'attestation_id', type: 'u32', desc: 'Attestation to flag' }, { name: 'reason', type: 'Bytes', desc: 'Flag reason' }] },
                ],
                storage: ['Attestations', 'AttestationCount', 'AgentAttestations']
            },
            {
                name: 'Notarial', index: 23, category: 'Attestation',
                description: 'Notarial document hashing and verification',
                calls: [
                    { name: 'notarize', index: 0, params: [{ name: 'document_hash', type: 'H256', desc: 'Document hash' }, { name: 'metadata', type: 'Bytes', desc: 'Document metadata' }] },
                    { name: 'verify', index: 1, params: [{ name: 'document_hash', type: 'H256', desc: 'Hash to verify' }] },
                    { name: 'revoke', index: 2, params: [{ name: 'document_hash', type: 'H256', desc: 'Hash to revoke' }] },
                ],
                storage: ['Documents', 'DocumentCount', 'RevokedDocuments']
            },

            // --- Financial ---
            {
                name: 'Fideicommis', index: 25, category: 'Financial',
                description: 'Trust/escrow management with multi-party release',
                calls: [
                    { name: 'create_trust', index: 0, params: [{ name: 'beneficiary', type: 'AccountId', desc: 'Beneficiary account' }, { name: 'amount', type: 'u128', desc: 'Amount to hold' }, { name: 'release_block', type: 'u32', desc: 'Block number for release' }] },
                    { name: 'release_trust', index: 1, params: [{ name: 'trust_id', type: 'u32', desc: 'Trust ID' }] },
                    { name: 'cancel_trust', index: 2, params: [{ name: 'trust_id', type: 'u32', desc: 'Trust to cancel' }] },
                ],
                storage: ['Trusts', 'TrustCount', 'BeneficiaryTrusts']
            },
            {
                name: 'Stablecoin', index: 26, category: 'Financial',
                description: 'Algorithmic stablecoin with oracle-based peg',
                calls: [
                    { name: 'mint', index: 0, params: [{ name: 'amount', type: 'u128', desc: 'Amount to mint' }, { name: 'collateral', type: 'u128', desc: 'Collateral amount' }] },
                    { name: 'burn', index: 1, params: [{ name: 'amount', type: 'u128', desc: 'Amount to burn' }] },
                    { name: 'update_price', index: 2, params: [{ name: 'price', type: 'u128', desc: 'New price (fixed-point)' }] },
                ],
                storage: ['TotalSupply', 'Price', 'CollateralRatio']
            },
            {
                name: 'Devonomics', index: 28, category: 'Financial',
                description: 'Gamified quest and reward system for validators',
                calls: [
                    { name: 'complete_quest', index: 0, params: [{ name: 'quest_id', type: 'u32', desc: 'Quest ID' }] },
                    { name: 'claim_reward', index: 1, params: [{ name: 'quest_id', type: 'u32', desc: 'Quest to claim' }] },
                ],
                storage: ['Quests', 'PlayerScores', 'CompletedQuests']
            },
            {
                name: 'ValidatorRewards', index: 18, category: 'Financial',
                description: 'Validator block reward distribution',
                calls: [
                    { name: 'claim_rewards', index: 0, params: [] },
                    { name: 'set_reward_rate', index: 1, params: [{ name: 'rate', type: 'u128', desc: 'Reward per block' }] },
                ],
                storage: ['PendingRewards', 'RewardRate', 'TotalDistributed']
            },

            // --- Crypto & Network ---
            {
                name: 'QuantumCrypto', index: 14, category: 'Crypto & Network',
                description: 'Quantum-safe cryptographic primitives and entropy',
                calls: [
                    { name: 'submit_entropy', index: 0, params: [{ name: 'entropy', type: 'Bytes', desc: 'Entropy bytes (32+)' }] },
                    { name: 'request_randomness', index: 1, params: [{ name: 'nonce', type: 'u64', desc: 'Request nonce' }] },
                ],
                storage: ['EntropyPool', 'RandomnessRequests', 'LastEntropy']
            },
            {
                name: 'SphincsKeystore', index: 16, category: 'Crypto & Network',
                description: 'SPHINCS+ key registration and management',
                calls: [
                    { name: 'register_key', index: 0, params: [{ name: 'public_key', type: 'Bytes', desc: 'SPHINCS+ public key' }, { name: 'key_type', type: 'Bytes', desc: 'Key type (e.g., aura, gran)' }] },
                    { name: 'rotate_key', index: 1, params: [{ name: 'old_key', type: 'Bytes', desc: 'Old public key' }, { name: 'new_key', type: 'Bytes', desc: 'New public key' }] },
                    { name: 'revoke_key', index: 2, params: [{ name: 'public_key', type: 'Bytes', desc: 'Key to revoke' }] },
                ],
                storage: ['Keys', 'KeyOwners', 'RevokedKeys']
            },
            {
                name: 'RelayCoordination', index: 15, category: 'Crypto & Network',
                description: 'Cross-chain relay and bridge coordination',
                calls: [
                    { name: 'submit_relay_proof', index: 0, params: [{ name: 'chain_id', type: 'u32', desc: 'Source chain ID' }, { name: 'proof', type: 'Bytes', desc: 'Relay proof data' }, { name: 'block_hash', type: 'H256', desc: 'Source block hash' }] },
                    { name: 'register_relay', index: 1, params: [{ name: 'chain_id', type: 'u32', desc: 'Chain to relay' }, { name: 'endpoint', type: 'Bytes', desc: 'Relay endpoint' }] },
                ],
                storage: ['Relays', 'RelayProofs', 'RegisteredChains']
            },

            // --- Other ---
            {
                name: 'Aura', index: 2, category: 'Other',
                description: 'Authority round block production consensus',
                calls: [],
                storage: ['Authorities', 'CurrentSlot']
            },
            {
                name: 'Authorship', index: 4, category: 'Other',
                description: 'Block author tracking',
                calls: [],
                storage: ['Author']
            },
            {
                name: 'TransactionPayment', index: 6, category: 'Other',
                description: 'Transaction fee calculation and payment',
                calls: [],
                storage: ['NextFeeMultiplier', 'StorageVersion']
            },
            {
                name: 'Scheduler', index: 8, category: 'Other',
                description: 'Scheduled call execution at future blocks',
                calls: [
                    { name: 'schedule', index: 0, params: [{ name: 'when', type: 'u32', desc: 'Block number' }, { name: 'priority', type: 'u8', desc: 'Priority (0=highest)' }, { name: 'call', type: 'Call', desc: 'Call to schedule' }] },
                    { name: 'cancel', index: 1, params: [{ name: 'when', type: 'u32', desc: 'Block number' }, { name: 'index', type: 'u32', desc: 'Schedule index' }] },
                ],
                storage: ['Agenda', 'Lookup']
            },
            {
                name: 'Preimage', index: 9, category: 'Other',
                description: 'Preimage storage for democracy proposals',
                calls: [
                    { name: 'note_preimage', index: 0, params: [{ name: 'bytes', type: 'Bytes', desc: 'Preimage bytes' }] },
                    { name: 'unnote_preimage', index: 1, params: [{ name: 'hash', type: 'H256', desc: 'Preimage hash' }] },
                ],
                storage: ['StatusFor', 'PreimageFor']
            },
            {
                name: 'Democracy', index: 10, category: 'Other',
                description: 'On-chain democracy and referenda',
                calls: [
                    { name: 'propose', index: 0, params: [{ name: 'proposal', type: 'Bytes', desc: 'Proposal preimage hash' }, { name: 'value', type: 'u128', desc: 'Deposit amount' }] },
                    { name: 'vote', index: 2, params: [{ name: 'ref_index', type: 'u32', desc: 'Referendum index' }, { name: 'vote', type: 'u8', desc: 'Vote value' }] },
                ],
                storage: ['PublicPropCount', 'ReferendumCount', 'DepositOf']
            },
            {
                name: 'Council', index: 11, category: 'Other',
                description: 'Council collective (Instance 1)',
                calls: [
                    { name: 'propose', index: 2, params: [{ name: 'threshold', type: 'u32', desc: 'Approval threshold' }, { name: 'proposal', type: 'Call', desc: 'Call to propose' }] },
                    { name: 'vote', index: 3, params: [{ name: 'proposal', type: 'H256', desc: 'Proposal hash' }, { name: 'index', type: 'u32', desc: 'Proposal index' }, { name: 'approve', type: 'bool', desc: 'Vote direction' }] },
                ],
                storage: ['Proposals', 'ProposalOf', 'Members']
            },
            {
                name: 'TechnicalCommittee', index: 12, category: 'Other',
                description: 'Technical committee collective (Instance 2)',
                calls: [
                    { name: 'propose', index: 2, params: [{ name: 'threshold', type: 'u32', desc: 'Approval threshold' }, { name: 'proposal', type: 'Call', desc: 'Call to propose' }] },
                    { name: 'vote', index: 3, params: [{ name: 'proposal', type: 'H256', desc: 'Proposal hash' }, { name: 'index', type: 'u32', desc: 'Proposal index' }, { name: 'approve', type: 'bool', desc: 'Vote direction' }] },
                ],
                storage: ['Proposals', 'Members']
            },
            {
                name: 'ProofOfCoherence', index: 15, category: 'Other',
                description: 'Quantum-safe proof of coherence consensus',
                calls: [
                    { name: 'submit_coherence_proof', index: 0, params: [{ name: 'proof', type: 'Bytes', desc: 'Coherence proof data' }] },
                ],
                storage: ['CoherenceScores', 'LastProof']
            },
            {
                name: 'RuntimeSegmentation', index: 16, category: 'Other',
                description: 'Chunked runtime upgrade management',
                calls: [],
                storage: ['UpgradeState', 'ChunkCount']
            },
            {
                name: 'ValidatorEntropy', index: 17, category: 'Other',
                description: 'Validator entropy contribution tracking',
                calls: [
                    { name: 'submit_entropy', index: 0, params: [{ name: 'entropy', type: 'Bytes', desc: 'Entropy contribution' }] },
                ],
                storage: ['Contributions', 'EntropyPool']
            },
            {
                name: 'RicardianContracts', index: 21, category: 'Other',
                description: 'On-chain Ricardian contract management',
                calls: [
                    { name: 'create_contract', index: 0, params: [{ name: 'hash', type: 'H256', desc: 'Contract hash' }, { name: 'metadata', type: 'Bytes', desc: 'Contract metadata' }] },
                    { name: 'sign_contract', index: 1, params: [{ name: 'contract_id', type: 'u32', desc: 'Contract ID' }] },
                ],
                storage: ['Contracts', 'ContractCount', 'Signatures']
            },
            {
                name: 'ConsensusLevel', index: 27, category: 'Other',
                description: 'Adaptive consensus level tracking',
                calls: [
                    { name: 'update_level', index: 0, params: [{ name: 'level', type: 'u8', desc: 'New consensus level' }] },
                ],
                storage: ['CurrentLevel', 'LevelHistory']
            },
            {
                name: 'TopologicalCoherence', index: 29, category: 'Other',
                description: 'Tonnetz torus validation for inference coherence',
                calls: [
                    { name: 'submit_score', index: 0, params: [{ name: 'model_id', type: 'Bytes', desc: 'Model identifier' }, { name: 'score', type: 'u32', desc: 'Coherence score (0-10000)' }, { name: 'proof', type: 'Bytes', desc: 'Score proof' }] },
                ],
                storage: ['Scores', 'ModelRegistry']
            },
        ];
    }

    // =========================================================================
    // Category configuration (colors and order)
    // =========================================================================

    getCategoryConfig() {
        return {
            'Transparence Integration': { color: '#f8a100', icon: 'T', order: 0 },
            'Identity':                 { color: '#22c997', icon: 'I', order: 1 },
            'Governance':               { color: '#5c88da', icon: 'G', order: 2 },
            'Attestation':              { color: '#e066ff', icon: 'A', order: 3 },
            'Financial':                { color: '#ff6b6b', icon: 'F', order: 4 },
            'Crypto & Network':         { color: '#00d4ff', icon: 'C', order: 5 },
            'Core':                     { color: '#ffc044', icon: 'S', order: 6 },
            'Other':                    { color: '#707080', icon: 'O', order: 7 },
        };
    }

    // =========================================================================
    // SCALE Encoding Helpers
    // =========================================================================

    encodeU8(value) {
        return parseInt(value).toString(16).padStart(2, '0');
    }

    encodeU32LE(value) {
        const n = parseInt(value);
        const buf = new ArrayBuffer(4);
        new DataView(buf).setUint32(0, n, true);
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    encodeU64LE(value) {
        const n = BigInt(value);
        let hex = '';
        for (let i = 0; i < 8; i++) {
            hex += ((n >> BigInt(i * 8)) & 0xFFn).toString(16).padStart(2, '0');
        }
        return hex;
    }

    encodeU128LE(value) {
        const n = BigInt(value);
        let hex = '';
        for (let i = 0; i < 16; i++) {
            hex += ((n >> BigInt(i * 8)) & 0xFFn).toString(16).padStart(2, '0');
        }
        return hex;
    }

    encodeBool(value) {
        return value ? '01' : '00';
    }

    encodeBytes(hexOrString) {
        let hex = hexOrString;
        if (hex.startsWith('0x')) {
            hex = hex.substring(2);
        } else {
            // Treat as UTF-8 string, encode to hex
            hex = Array.from(new TextEncoder().encode(hexOrString))
                .map(b => b.toString(16).padStart(2, '0')).join('');
        }
        // Compact length prefix
        const byteLen = hex.length / 2;
        let prefix;
        if (byteLen < 64) {
            prefix = (byteLen << 2).toString(16).padStart(2, '0');
        } else if (byteLen < 16384) {
            const val = (byteLen << 2) | 0x01;
            prefix = this.encodeU16LE(val);
        } else {
            const val = (byteLen << 2) | 0x02;
            prefix = this.encodeU32LE(val);
        }
        return prefix + hex;
    }

    encodeU16LE(value) {
        const n = parseInt(value);
        const buf = new ArrayBuffer(2);
        new DataView(buf).setUint16(0, n, true);
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    encodeAccountId(value) {
        let hex = value;
        if (hex.startsWith('0x')) hex = hex.substring(2);
        if (hex.length !== 64) throw new Error('AccountId must be 32 bytes (64 hex chars)');
        return hex;
    }

    encodeH256(value) {
        let hex = value;
        if (hex.startsWith('0x')) hex = hex.substring(2);
        if (hex.length !== 64) throw new Error('H256 must be 32 bytes (64 hex chars)');
        return hex;
    }

    encodeParam(type, value) {
        switch (type) {
            case 'u8': return this.encodeU8(value);
            case 'u16': return this.encodeU16LE(value);
            case 'u32': return this.encodeU32LE(value);
            case 'u64': return this.encodeU64LE(value);
            case 'u128': return this.encodeU128LE(value);
            case 'bool': return this.encodeBool(value === true || value === 'true' || value === '1');
            case 'Bytes': return this.encodeBytes(value);
            case 'Call': return this.encodeBytes(value);
            case 'AccountId': return this.encodeAccountId(value);
            case 'H256': return this.encodeH256(value);
            default: return this.encodeBytes(value);
        }
    }

    // =========================================================================
    // Build call data
    // =========================================================================

    buildCallData(palletIndex, callIndex, params, paramValues) {
        let data = '';
        data += parseInt(palletIndex).toString(16).padStart(2, '0');
        data += parseInt(callIndex).toString(16).padStart(2, '0');
        for (const param of params) {
            const val = paramValues[param.name];
            if (val === undefined || val === '') {
                throw new Error(`Missing required parameter: ${param.name}`);
            }
            data += this.encodeParam(param.type, val);
        }
        return '0x' + data;
    }

    // =========================================================================
    // Submit extrinsic
    // =========================================================================

    async submitExtrinsic(callData, signerKey) {
        let key = signerKey;
        if (key.startsWith('0x')) key = key.substring(2);
        const result = await this.rpc('quantumharmony_submitSignedExtrinsic', [{
            callData: callData,
            signerKey: key
        }]);
        return result;
    }

    // =========================================================================
    // Fetch live stats
    // =========================================================================

    async fetchStats() {
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
}

// =============================================================================
// Panel Initialization
// =============================================================================

function initExtrinsicsPanel() {
    const panel = document.getElementById('panel-extrinsics');
    if (!panel) return;

    const endpoint = (typeof config !== 'undefined' && config.rpc) ? config.rpc : 'http://127.0.0.1:9944';
    const mgr = new ExtrinsicsManager(endpoint);
    const pallets = mgr.getPalletRegistry();
    const catConfig = mgr.getCategoryConfig();

    // Count totals
    const totalPallets = pallets.length;
    const totalExtrinsics = pallets.reduce((sum, p) => sum + p.calls.length, 0);
    const totalStorage = pallets.reduce((sum, p) => sum + (p.storage ? p.storage.length : 0), 0);

    // Group pallets by category
    const grouped = {};
    for (const p of pallets) {
        if (!grouped[p.category]) grouped[p.category] = [];
        grouped[p.category].push(p);
    }
    const sortedCategories = Object.keys(grouped).sort((a, b) =>
        (catConfig[a]?.order ?? 99) - (catConfig[b]?.order ?? 99)
    );

    // Build HTML
    let html = '';

    // --- Stats Bar ---
    html += `
    <h2 class="panel-title">Extrinsics Manager</h2>
    <div class="stats-grid" id="extrinsicsStatsGrid">
        <div class="stat-card">
            <div class="stat-label">PALLETS</div>
            <div class="stat-value gold" id="extStatPallets">${totalPallets}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">EXTRINSICS</div>
            <div class="stat-value green" id="extStatExtrinsics">${totalExtrinsics}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">STORAGE ITEMS</div>
            <div class="stat-value blue" id="extStatStorage">${totalStorage}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">SPEC VERSION</div>
            <div class="stat-value" id="extStatSpec">--</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">BLOCK</div>
            <div class="stat-value" id="extStatBlock">--</div>
        </div>
    </div>`;

    // --- Identity Registration Shortcut ---
    html += `
    <div style="background: linear-gradient(135deg, rgba(34,201,151,0.12), rgba(92,136,218,0.08)); border: 1px solid var(--accent-success); border-radius: var(--radius-md); padding: var(--space-4); margin-bottom: var(--space-4);">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
            <div style="width: 40px; height: 40px; border-radius: 50%; background: var(--accent-success); display: flex; align-items: center; justify-content: center; font-family: 'Orbitron', monospace; font-weight: 700; color: var(--text-on-color); font-size: 16px;">ID</div>
            <div>
                <div style="font-family: 'Orbitron', monospace; font-size: 14px; font-weight: 600; color: var(--accent-success); letter-spacing: 1px;">QUICK IDENTITY REGISTRATION</div>
                <div style="font-size: 11px; color: var(--text-secondary);">Register a new PQ identity on-chain (Shield, Agent, Validator, etc.)</div>
            </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label">Identity Type</label>
                <select class="form-input" id="quickIdType" style="font-family: 'JetBrains Mono', monospace; font-size: 12px;">
                    <option value="1">1 - Shield (AI Proxy)</option>
                    <option value="0">0 - Human</option>
                    <option value="2">2 - Agent (Autonomous)</option>
                    <option value="3">3 - Validator</option>
                    <option value="4">4 - Oracle</option>
                </select>
            </div>
            <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label">Display Name</label>
                <input type="text" class="form-input" id="quickIdName" placeholder="coherence-shield-alpha" style="font-family: 'JetBrains Mono', monospace; font-size: 12px;">
            </div>
        </div>
        <div class="form-group" style="margin-top: 12px; margin-bottom: 12px;">
            <label class="form-label">SPHINCS+ Public Key (32 bytes)</label>
            <input type="text" class="form-input" id="quickIdPubkey" placeholder="0x..." style="font-family: 'JetBrains Mono', monospace; font-size: 12px;">
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
            <button class="btn btn-success" onclick="submitQuickIdentity()">REGISTER IDENTITY</button>
            <span id="quickIdResult" style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-muted);"></span>
        </div>
    </div>`;

    // --- Pallet Categories ---
    for (const cat of sortedCategories) {
        const cc = catConfig[cat] || { color: '#707080', icon: '?', order: 99 };
        const catPallets = grouped[cat];
        const catExtrinsics = catPallets.reduce((s, p) => s + p.calls.length, 0);

        html += `
        <div class="section-title" style="border-bottom-color: ${cc.color};">
            <span style="display: flex; align-items: center; gap: 8px;">
                <span style="display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px; background: ${cc.color}; color: var(--text-on-color); font-family: 'Orbitron', monospace; font-size: 10px; font-weight: 700;">${cc.icon}</span>
                ${cat}
            </span>
            <span style="font-size: 10px; color: var(--text-muted);">${catPallets.length} pallets / ${catExtrinsics} calls</span>
        </div>`;

        for (const pallet of catPallets) {
            const palletId = `ext-pallet-${pallet.name.replace(/\s/g, '')}`;
            const callCount = pallet.calls.length;
            const storageCount = pallet.storage ? pallet.storage.length : 0;

            html += `
        <div style="background: var(--bg-surface); border-radius: var(--radius-md); padding: var(--space-3); margin-bottom: 8px; border-left: 4px solid ${cc.color};">
            <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="togglePalletExpand('${palletId}')">
                <div>
                    <span style="font-family: 'Orbitron', monospace; font-size: 13px; font-weight: 600; color: var(--text-primary); letter-spacing: 0.5px;">${pallet.name}</span>
                    <span style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text-muted); margin-left: 8px;">idx:${pallet.index}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 10px; color: ${cc.color}; font-weight: 600;">${callCount} calls</span>
                    <span style="font-size: 10px; color: var(--text-muted);">${storageCount} storage</span>
                    <span id="${palletId}-arrow" style="color: var(--text-muted); font-size: 12px; transition: transform 0.2s;">&#9660;</span>
                </div>
            </div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px;">${pallet.description}</div>
            <div id="${palletId}" style="display: none; margin-top: 12px;">`;

            if (callCount === 0) {
                html += `<div style="font-size: 11px; color: var(--text-muted); font-style: italic; padding: 8px 0;">No callable extrinsics (inherents only)</div>`;
            } else {
                for (const call of pallet.calls) {
                    const callId = `ext-call-${pallet.name}-${call.name}`.replace(/\s/g, '');
                    const paramSig = call.params.map(p => `${p.name}: ${p.type}`).join(', ');

                    html += `
                <div style="background: var(--bg-elevated); border-radius: var(--radius-sm); padding: 10px 12px; margin-bottom: 6px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <span style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: ${cc.color}; font-weight: 600;">${pallet.name}::${call.name}</span>
                            <span style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text-muted); margin-left: 6px;">(${paramSig || 'none'})</span>
                        </div>
                        <button class="btn btn-sm" style="background: ${cc.color}; color: var(--text-on-color); font-size: 10px; padding: 3px 10px;" onclick="toggleExtrinsicForm('${callId}')">SUBMIT</button>
                    </div>
                    <div id="${callId}" style="display: none; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--bg-surface);">
                        ${buildExtrinsicForm(pallet, call, callId)}
                    </div>
                </div>`;
                }
            }

            // Storage items display
            if (storageCount > 0) {
                html += `
                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--bg-elevated);">
                    <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">Storage</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 4px;">`;
                for (const s of pallet.storage) {
                    html += `<span style="font-family: 'JetBrains Mono', monospace; font-size: 10px; background: var(--bg-elevated); padding: 2px 8px; border-radius: var(--radius-sm); color: var(--text-secondary);">${s}</span>`;
                }
                html += `</div></div>`;
            }

            html += `
            </div>
        </div>`;
        }
    }

    // --- Console / Result Log ---
    html += `
    <div class="section-title" style="margin-top: var(--space-4);">
        <span>Extrinsic Console</span>
        <button class="btn btn-secondary btn-sm" onclick="clearExtConsole()">CLEAR</button>
    </div>
    <div class="terminal" id="extConsole" style="max-height: 220px;">
        <div class="terminal-line info">Extrinsics manager ready. ${totalPallets} pallets loaded with ${totalExtrinsics} callable extrinsics.</div>
    </div>`;

    panel.innerHTML = html;

    // Fetch live stats
    refreshExtrinsicsStats();
}

// =============================================================================
// Form Builder
// =============================================================================

function buildExtrinsicForm(pallet, call, callId) {
    let formHtml = '';

    for (const param of call.params) {
        const inputId = `${callId}-param-${param.name}`;
        const inputType = getInputType(param.type);

        formHtml += `
        <div class="form-group" style="margin-bottom: 10px;">
            <label class="form-label" style="display: flex; justify-content: space-between;">
                <span>${param.name}</span>
                <span style="color: ${getTypeColor(param.type)}; font-family: 'JetBrains Mono', monospace; text-transform: none; letter-spacing: 0;">${param.type}</span>
            </label>`;

        if (param.type === 'bool') {
            formHtml += `
            <select class="form-input" id="${inputId}" style="font-family: 'JetBrains Mono', monospace; font-size: 12px;">
                <option value="true">true</option>
                <option value="false">false</option>
            </select>`;
        } else if (param.type === 'u8' && param.desc && param.desc.includes('=')) {
            // Render as dropdown with enum-like options
            const opts = param.desc.split(',').map(o => o.trim());
            formHtml += `<select class="form-input" id="${inputId}" style="font-family: 'JetBrains Mono', monospace; font-size: 12px;">`;
            for (const opt of opts) {
                const match = opt.match(/(\d+)\s*[=:]\s*(.*)/);
                if (match) {
                    formHtml += `<option value="${match[1]}">${match[1]} - ${match[2]}</option>`;
                } else {
                    formHtml += `<option value="${opt}">${opt}</option>`;
                }
            }
            formHtml += `</select>`;
        } else {
            formHtml += `
            <input type="${inputType}" class="form-input" id="${inputId}"
                   placeholder="${param.desc || param.type}"
                   style="font-family: 'JetBrains Mono', monospace; font-size: 12px;">`;
        }

        if (param.desc) {
            formHtml += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">${param.desc}</div>`;
        }
        formHtml += `</div>`;
    }

    // Signer key field
    formHtml += `
    <div class="form-group" style="margin-bottom: 10px; padding-top: 8px; border-top: 1px dashed var(--bg-surface);">
        <label class="form-label" style="display: flex; justify-content: space-between;">
            <span>Signer Key</span>
            <span style="color: var(--accent-warning); font-family: 'JetBrains Mono', monospace; text-transform: none; letter-spacing: 0;">SPHINCS+</span>
        </label>
        <div style="display: flex; gap: 8px;">
            <input type="password" class="form-input" id="${callId}-signer"
                   placeholder="SPHINCS+ secret key (hex) or use active key"
                   style="font-family: 'JetBrains Mono', monospace; font-size: 12px; flex: 1;">
            <button class="btn btn-sm" style="background: var(--lcars-gold-dark); color: var(--text-on-color); white-space: nowrap; font-size: 10px;"
                    onclick="useActiveKeyFor('${callId}-signer')">USE ACTIVE</button>
        </div>
        <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">Leave empty to use the active SPHINCS+ key from KEYS tab</div>
    </div>`;

    // Submit + result
    formHtml += `
    <div style="display: flex; align-items: center; gap: 12px; margin-top: 12px;">
        <button class="btn btn-success" id="${callId}-submit-btn"
                onclick="submitExtrinsicFromForm('${pallet.name}', ${pallet.index}, '${call.name}', ${call.index}, '${callId}')">
            SUBMIT EXTRINSIC
        </button>
        <span id="${callId}-status" style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-muted);"></span>
    </div>
    <div id="${callId}-result" style="display: none; margin-top: 10px; padding: 10px; background: var(--bg-void); border-radius: var(--radius-sm); font-family: 'JetBrains Mono', monospace; font-size: 11px; word-break: break-all;"></div>`;

    return formHtml;
}

// =============================================================================
// Input type mapping
// =============================================================================

function getInputType(type) {
    switch (type) {
        case 'u8': case 'u16': case 'u32': case 'u64': case 'u128':
            return 'text'; // Use text to allow big numbers
        case 'bool':
            return 'text';
        default:
            return 'text';
    }
}

function getTypeColor(type) {
    switch (type) {
        case 'AccountId': return '#22c997';
        case 'H256': return '#5c88da';
        case 'Bytes': case 'Call': return '#f8a100';
        case 'bool': return '#e066ff';
        case 'u8': case 'u16': case 'u32': case 'u64': case 'u128': return '#00d4ff';
        default: return 'var(--text-muted)';
    }
}

// =============================================================================
// UI Interaction Handlers
// =============================================================================

function togglePalletExpand(palletId) {
    const el = document.getElementById(palletId);
    const arrow = document.getElementById(palletId + '-arrow');
    if (!el) return;
    const showing = el.style.display === 'none';
    el.style.display = showing ? 'block' : 'none';
    if (arrow) arrow.style.transform = showing ? 'rotate(180deg)' : 'rotate(0deg)';
}

function toggleExtrinsicForm(callId) {
    const el = document.getElementById(callId);
    if (!el) return;
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function useActiveKeyFor(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    // Use the global activeSphincsKey from the dashboard
    if (typeof activeSphincsKey !== 'undefined' && activeSphincsKey) {
        input.type = 'text';
        input.value = activeSphincsKey;
        input.type = 'password';
        extLog('Active SPHINCS+ key loaded into signer field', 'info');
    } else {
        extLog('No active SPHINCS+ key found. Generate or import one in the KEYS tab.', 'warning');
    }
}

function clearExtConsole() {
    const el = document.getElementById('extConsole');
    if (el) el.innerHTML = '<div class="terminal-line info">Console cleared</div>';
}

function extLog(msg, level = 'info') {
    const el = document.getElementById('extConsole');
    if (!el) return;
    const ts = new Date().toLocaleTimeString('en-CA', { hour12: false });
    const line = document.createElement('div');
    line.className = `terminal-line ${level}`;
    line.innerHTML = `<span style="color: var(--text-muted);">[${ts}]</span> ${escapeHtmlExt(msg)}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
}

function escapeHtmlExt(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// =============================================================================
// Extrinsic Submission
// =============================================================================

async function submitExtrinsicFromForm(palletName, palletIndex, callName, callIndex, callId) {
    const endpoint = (typeof config !== 'undefined' && config.rpc) ? config.rpc : 'http://127.0.0.1:9944';
    const mgr = new ExtrinsicsManager(endpoint);
    const registry = mgr.getPalletRegistry();

    // Find pallet and call definition
    const pallet = registry.find(p => p.name === palletName && p.index === palletIndex);
    if (!pallet) {
        extLog(`ERROR: Pallet ${palletName} not found in registry`, 'error');
        return;
    }
    const call = pallet.calls.find(c => c.name === callName && c.index === callIndex);
    if (!call) {
        extLog(`ERROR: Call ${callName} not found in ${palletName}`, 'error');
        return;
    }

    const statusEl = document.getElementById(`${callId}-status`);
    const resultEl = document.getElementById(`${callId}-result`);
    const submitBtn = document.getElementById(`${callId}-submit-btn`);

    // Gather param values
    const paramValues = {};
    for (const param of call.params) {
        const inputId = `${callId}-param-${param.name}`;
        const inputEl = document.getElementById(inputId);
        if (!inputEl) {
            extLog(`ERROR: Input element not found for ${param.name}`, 'error');
            return;
        }
        const val = inputEl.value.trim();
        if (val === '' && param.type !== 'bool') {
            statusEl.style.color = 'var(--accent-danger)';
            statusEl.textContent = `Missing: ${param.name}`;
            extLog(`Missing required parameter: ${param.name}`, 'error');
            return;
        }
        paramValues[param.name] = val;
    }

    // Get signer key
    const signerInput = document.getElementById(`${callId}-signer`);
    let signerKey = signerInput ? signerInput.value.trim() : '';
    if (!signerKey && typeof activeSphincsKey !== 'undefined') {
        signerKey = activeSphincsKey;
    }
    if (!signerKey) {
        statusEl.style.color = 'var(--accent-danger)';
        statusEl.textContent = 'No signer key';
        extLog('No SPHINCS+ signer key provided. Use the KEYS tab to set up a key.', 'error');
        return;
    }

    // Build call data
    statusEl.style.color = 'var(--accent-warning)';
    statusEl.textContent = 'Encoding...';
    submitBtn.disabled = true;
    extLog(`Building call data for ${palletName}::${callName}...`, 'info');

    let callData;
    try {
        callData = mgr.buildCallData(palletIndex, callIndex, call.params, paramValues);
        extLog(`Call data: ${callData.substring(0, 40)}${callData.length > 40 ? '...' : ''} (${callData.length / 2 - 1} bytes)`, 'info');
    } catch (e) {
        statusEl.style.color = 'var(--accent-danger)';
        statusEl.textContent = 'Encoding error';
        extLog(`Encoding error: ${e.message}`, 'error');
        submitBtn.disabled = false;
        return;
    }

    // Submit
    statusEl.textContent = 'Submitting...';
    extLog(`Submitting ${palletName}::${callName} extrinsic...`, 'warning');

    try {
        const result = await mgr.submitExtrinsic(callData, signerKey);
        const txHash = result?.hash || result;

        statusEl.style.color = 'var(--accent-success)';
        statusEl.textContent = 'Submitted!';
        extLog(`SUCCESS: ${palletName}::${callName} submitted. TX: ${txHash}`, 'info');

        if (resultEl) {
            resultEl.style.display = 'block';
            resultEl.innerHTML = `
                <div style="color: var(--accent-success); margin-bottom: 4px;">Transaction Submitted</div>
                <div style="color: var(--text-secondary);">TX Hash: <span style="color: var(--lcars-gold);">${txHash}</span></div>
                ${result?.signer ? `<div style="color: var(--text-muted); margin-top: 4px;">Signer: ${result.signer.substring(0, 20)}...</div>` : ''}
                <div style="color: var(--text-muted); margin-top: 4px; font-size: 10px;">${new Date().toISOString()}</div>
            `;
        }
    } catch (e) {
        statusEl.style.color = 'var(--accent-danger)';
        statusEl.textContent = 'Failed';
        extLog(`FAILED: ${e.message}`, 'error');

        if (resultEl) {
            resultEl.style.display = 'block';
            resultEl.innerHTML = `
                <div style="color: var(--accent-danger); margin-bottom: 4px;">Submission Failed</div>
                <div style="color: var(--text-secondary);">${escapeHtmlExt(e.message)}</div>
                <div style="color: var(--text-muted); margin-top: 4px; font-size: 10px;">${new Date().toISOString()}</div>
            `;
        }
    } finally {
        submitBtn.disabled = false;
    }
}

// =============================================================================
// Quick Identity Registration
// =============================================================================

async function submitQuickIdentity() {
    const idType = document.getElementById('quickIdType')?.value;
    const displayName = document.getElementById('quickIdName')?.value?.trim();
    const pubkey = document.getElementById('quickIdPubkey')?.value?.trim();
    const resultEl = document.getElementById('quickIdResult');

    if (!displayName) {
        resultEl.style.color = 'var(--accent-danger)';
        resultEl.textContent = 'Display name required';
        return;
    }
    if (!pubkey) {
        resultEl.style.color = 'var(--accent-danger)';
        resultEl.textContent = 'Public key required';
        return;
    }

    const endpoint = (typeof config !== 'undefined' && config.rpc) ? config.rpc : 'http://127.0.0.1:9944';
    const mgr = new ExtrinsicsManager(endpoint);

    // IdentityRegistry pallet index 33, register_identity call index 0
    const palletIndex = 33;
    const callIndex = 0;
    const params = [
        { name: 'identity_type', type: 'u8' },
        { name: 'display_name', type: 'Bytes' },
        { name: 'sphincs_public_key', type: 'Bytes' },
    ];
    const paramValues = {
        identity_type: idType,
        display_name: displayName,
        sphincs_public_key: pubkey,
    };

    let signerKey = '';
    if (typeof activeSphincsKey !== 'undefined' && activeSphincsKey) {
        signerKey = activeSphincsKey;
    }
    if (!signerKey) {
        resultEl.style.color = 'var(--accent-danger)';
        resultEl.textContent = 'No active SPHINCS+ key. Set one in KEYS tab.';
        return;
    }

    resultEl.style.color = 'var(--accent-warning)';
    resultEl.textContent = 'Submitting...';
    extLog(`Quick identity registration: type=${idType}, name="${displayName}"`, 'info');

    try {
        const callData = mgr.buildCallData(palletIndex, callIndex, params, paramValues);
        extLog(`Identity call data: ${callData.substring(0, 40)}...`, 'info');

        const result = await mgr.submitExtrinsic(callData, signerKey);
        const txHash = result?.hash || result;

        resultEl.style.color = 'var(--accent-success)';
        resultEl.textContent = `Registered! TX: ${typeof txHash === 'string' ? txHash.substring(0, 24) + '...' : txHash}`;
        extLog(`Identity registered successfully. TX: ${txHash}`, 'info');
    } catch (e) {
        resultEl.style.color = 'var(--accent-danger)';
        resultEl.textContent = `Failed: ${e.message}`;
        extLog(`Identity registration failed: ${e.message}`, 'error');
    }
}

// =============================================================================
// Stats Refresh
// =============================================================================

async function refreshExtrinsicsStats() {
    const endpoint = (typeof config !== 'undefined' && config.rpc) ? config.rpc : 'http://127.0.0.1:9944';
    const mgr = new ExtrinsicsManager(endpoint);

    try {
        const stats = await mgr.fetchStats();
        const specEl = document.getElementById('extStatSpec');
        const blockEl = document.getElementById('extStatBlock');
        if (specEl) {
            specEl.textContent = `v${stats.specVersion}`;
            specEl.style.color = 'var(--lcars-gold-light)';
        }
        if (blockEl) {
            blockEl.textContent = typeof stats.blockNumber === 'number'
                ? stats.blockNumber.toLocaleString()
                : stats.blockNumber;
            blockEl.style.color = 'var(--lcars-blue-light)';
        }
    } catch (e) {
        console.error('Failed to refresh extrinsics stats:', e);
    }
}
