# QH-Agent: Autonomous Validator Agent Specification

**Version**: 0.1 (Draft)
**Date**: 2026-04-20
**Author**: Sylvain Cormier / Paraxiom
**Status**: Requirements — not yet implemented

---

## 1. Problem Statement

Operating a post-quantum blockchain validator requires constant manual intervention:
- Monitoring node health (disk, peers, sync, block production)
- Managing SPHINCS+ keystores (rotation, backup, recovery)
- Coordinating runtime upgrades across multiple validators
- Diagnosing and fixing chain-level issues (session rotation, sudo key, pallet encoding)
- Submitting governance votes on upgrade proposals

During the week of 2026-04-14 to 2026-04-20, the QuantumHarmony chain experienced:
- Sudo key loss (no recovery mechanism, blocked all runtime upgrades)
- Session rotation failure (validators couldn't produce blocks)
- Validator key mismatch (Edwin's disk died, keys rotated, session not updated)
- 12+ hours of manual debugging for issues an automated system would catch in minutes

**The solution**: Each validator operator runs a QH-Agent — an AI-powered autonomous agent that manages their node, participates in governance, and coordinates with other validators' agents.

---

## 2. Design Principles

1. **Decentralized**: No single privileged agent. Each validator runs their own. No agent can act unilaterally.
2. **Safe by default**: Agents propose, validators (human or agent) vote, chain executes. The proof harness gates every upgrade.
3. **Transparent**: Every action is logged on-chain with full audit trail. Code changes are diffed and explained in plain language.
4. **Operator-friendly**: Validators don't need to understand Rust, SCALE encoding, or Substrate internals. The agent explains everything in plain language and handles the complexity.
5. **Fail-safe**: If the agent crashes, the node continues running. The agent is advisory, not load-bearing. Manual override is always available.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Validator Operator (Human)                    │
│         Dashboard / Mobile alerts / Plain-language logs          │
└──────────────────────────┬──────────────────────────────────────┘
                           │ reviews / overrides
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      QH-Agent (per validator)                    │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │
│  │ Monitor  │  │  Coder   │  │ Builder  │  │  Governance  │    │
│  │          │  │          │  │          │  │   Voter      │    │
│  │ - health │  │ - reads  │  │ - cargo  │  │ - receives   │    │
│  │ - disk   │  │   source │  │   build  │  │   proposals  │    │
│  │ - peers  │  │ - writes │  │ - proof  │  │ - verifies   │    │
│  │ - blocks │  │   fixes  │  │   harness│  │ - votes      │    │
│  │ - keys   │  │ - diffs  │  │ - WASM   │  │ - explains   │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘    │
│                                                                  │
│  ┌──────────┐  ┌──────────────────────────────────────────┐     │
│  │ Deployer │  │          Key Manager                     │     │
│  │          │  │                                          │     │
│  │ - binary │  │ - keystore backup (encrypted)            │     │
│  │   swap   │  │ - session key rotation                   │     │
│  │ - coord  │  │ - sudo key monitoring                    │     │
│  │   multi  │  │ - recovery from backup                   │     │
│  │   node   │  │ - never stores keys in plain text        │     │
│  └──────────┘  └──────────────────────────────────────────┘     │
└──────────────────────────┬──────────────────────────────────────┘
                           │ RPC / SSH / P2P
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   QuantumHarmony Node                            │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐  │
│  │ Standard RPCs   │  │ Agent RPCs      │  │ Runtime        │  │
│  │                 │  │ (new)           │  │                │  │
│  │ author_*        │  │ qh_diagnose     │  │ pallet-upgrade │  │
│  │ chain_*         │  │ qh_prepUpgrade  │  │ -governance    │  │
│  │ state_*         │  │ qh_healthReport │  │                │  │
│  │ system_*        │  │ qh_coordSwap    │  │ pallet-chain   │  │
│  │                 │  │                 │  │ -health        │  │
│  └─────────────────┘  └─────────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Components

### 4.1 Monitor

Runs continuously. Checks node health every 30 seconds.

**Checks:**
| Check | Threshold | Action on failure |
|-------|-----------|-------------------|
| Disk usage | > 80% | Rotate logs, alert operator |
| Disk usage | > 95% | Emergency log truncation, alert CRITICAL |
| Peer count | < 2 | Alert, attempt bootnode reconnection |
| Block production | Own slot skipped | Check keystore, alert operator |
| Sync lag | > 10 blocks behind | Alert, check if node stalled |
| Session rotation | CurrentIndex unchanged for > 2 periods | Alert, diagnose |
| Sudo key | Storage empty | Alert CRITICAL, propose governance fix |
| Validator set | Mismatch with active authorities | Alert, explain what changed |
| Memory usage | > 90% | Alert, suggest restart |
| WASM vs native | spec_version mismatch | Inform operator |

**Output**: Structured JSON log + operator alerts (email/Slack/push notification).

**Example alert:**
```
WARN  [qh-agent] Disk usage at 82% (78.7GB / 96GB)
      Action: Rotated container logs, freed 4.2GB
      Current: 77% (74.5GB / 96GB)
      Recommendation: None needed, will monitor
```

### 4.2 Coder

AI-powered code generation module. Invoked when Monitor detects an issue that requires a code change, or when operator requests a feature.

**Capabilities:**
- Read all runtime source files (lib.rs, pallets, chain_spec)
- Read chain state via RPC (storage keys, authorities, balances)
- Read runtime metadata (pallet indices, call signatures, storage maps)
- Generate Rust code: migrations, pallet hooks, config changes
- Generate Python scripts: SPHINCS+ signed extrinsic submission
- Diff and explain changes in plain language

**Constraints:**
- Never modifies code without operator approval (unless auto-approve is configured)
- Always runs `cargo check` before proposing
- Always generates a proof harness test for the fix
- Explains the change in plain language alongside the code diff

**Example output:**
```
DIAGNOSIS: Session rotation not advancing
  CurrentIndex: 1 (should be ~20 at block 146,000)
  Period: 7200 blocks
  Root cause: PeriodicSessions::should_end_session returns false

PROPOSED FIX:
  File: runtime/src/lib.rs line 228
  Change: pub const Period: u32 = 6 * HOURS;
      →   pub const Period: u32 = 600; // 30 min

  Explanation: Reduce session period from 6 hours to 30 minutes.
  This forces more frequent rotations, which will pick up
  validator set changes faster.

  Risk: LOW — config constant change only
  Proof harness: session_manager_is_validator_set will verify

  [APPROVE] [REJECT] [MODIFY]
```

### 4.3 Builder

Compiles runtime code and produces WASM + native binary.

**Process:**
1. Apply code changes to a working copy (git worktree)
2. `cargo check` — fast syntax/type validation
3. `cargo build --release` — full optimized build (~13 min on Alice)
4. Extract WASM: `target/release/wbuild/quantumharmony-runtime/quantumharmony_runtime.compact.compressed.wasm`
5. Run proof harness against the new binary
6. Compute WASM hash (Keccak-256) for on-chain verification
7. Stage binary on local disk for deployment

**Output:**
```
BUILD COMPLETE
  WASM: 916,187 bytes (SHA256: 6ab262c1...)
  Binary: quantumharmony-node (x86_64-linux, 127MB)
  Proof harness: 8/10 PASS, 1 SKIP, 1 WARN
  Ready for governance proposal
```

### 4.4 Governance Voter

Handles incoming upgrade proposals from other validators' agents.

**Receive proposal flow:**
1. Download proposed WASM from IPFS (CID in proposal)
2. Verify WASM hash matches proposal
3. Decompile and diff against current runtime (wasm-tools or wasmparser)
4. AI reviews the diff — explains what changed
5. Run proof harness locally against the proposed WASM
6. If all checks pass AND auto-approve is enabled → vote YES
7. If any check fails → vote NO with explanation
8. If auto-approve disabled → present summary to operator for manual vote

**Auto-approve policy (configurable per operator):**
```toml
[governance]
# Automatically approve proposals that:
auto_approve = true
max_risk = "low"           # low | medium | high | manual-only
require_proof_harness = true
require_all_checks_pass = true
notify_on_auto_approve = true

# Always require manual approval for:
manual_approve_patterns = [
    "pallet_sudo",          # Any sudo changes
    "set_code",             # Runtime upgrades
    "validator_set",        # Validator membership
]
```

**Example vote:**
```
PROPOSAL #7 from Alice's agent
  Description: Fix session rotation period
  WASM hash: 6ab262c1...
  Diff: 1 file changed, 1 line modified
    - pub const Period: u32 = 6 * HOURS;
    + pub const Period: u32 = 600;
  Proof harness: 10/10 PASS
  Risk assessment: LOW (config constant only)
  
  [AUTO-APPROVED] Vote YES submitted at block #146,500
  Operator notified via push notification
```

### 4.5 Deployer

Handles coordinated binary deployment across validators.

**Coordinated upgrade flow:**
1. All agents confirm they have the new binary staged
2. Health check: all nodes synced, all peers connected, no pending extrinsics
3. Agree on deployment block (next session boundary)
4. At target block: all agents simultaneously stop node, swap binary, restart
5. Post-deploy: verify all nodes on same spec_version within 60 seconds
6. If any node fails: automatic rollback to previous binary

**P2P coordination protocol:**
- Agents communicate via QuantumHarmony P2P network (separate substream)
- Messages are Falcon-512 signed for authentication
- Upgrade coordination is logged on-chain as AxiomAttestation events

### 4.6 Key Manager

Handles all SPHINCS+ key lifecycle operations.

**Responsibilities:**
- Generate SPHINCS+ keypairs for session rotation
- Encrypt and backup keystores (AES-256-GCM with operator password)
- Monitor keystore integrity (file exists, key matches on-chain authority)
- Automatic session key rotation before expiry
- Recovery: restore from encrypted backup if keystore is lost
- Sudo key monitoring: alert if Sudo.Key storage is empty

**Key storage:**
```
~/.qh-agent/
├── keystores/
│   ├── current/           # Active keystore (mounted into node container)
│   │   └── 61757261...    # Aura key file
│   └── backups/           # Encrypted backups
│       ├── 2026-04-20.enc # Daily encrypted backup
│       └── 2026-04-19.enc
├── config.toml            # Agent configuration
└── logs/                  # Structured JSON logs
```

**Never:**
- Store unencrypted keys outside the keystore directory
- Transmit private keys over the network
- Log private key material
- Delete the only copy of a key without backup verification

---

## 5. On-Chain Components

### 5.1 pallet-upgrade-governance

Replaces `pallet_sudo` for runtime upgrades. Multi-validator approval required.

**Storage:**
- `Proposals`: Map<ProposalId, Proposal>
- `Votes`: Map<(ProposalId, AccountId), bool>
- `ProposalCount`: u64
- `ApprovalThreshold`: Perbill (default: 60% = 3/5)

**Calls:**
- `propose_upgrade(wasm_hash: H256, ipfs_cid: Vec<u8>, description: Vec<u8>)` — any validator
- `vote(proposal_id: u64, approve: bool)` — validators only
- `enact(proposal_id: u64)` — called automatically when threshold reached
- `cancel(proposal_id: u64)` — proposer or supermajority reject
- `set_threshold(new_threshold: Perbill)` — requires current threshold approval

**Events:**
- `ProposalCreated { id, proposer, wasm_hash }`
- `VoteCast { proposal_id, voter, approve }`
- `ProposalEnacted { id, wasm_hash }` — runtime upgrade applied
- `ProposalRejected { id, reason }`

**Lifecycle:**
```
Proposed → Voting (7200 blocks max) → Enacted | Rejected
                                         ↓
                                   system.set_code(wasm)
```

### 5.2 pallet-chain-health

On-chain health monitoring. Emits events that agents watch.

**on_initialize checks (every block):**
1. Session rotation advancing: `CurrentIndex` should increase every `Period` blocks
2. Authority count matches ValidatorSet: `Aura::authorities().len() == ValidatorSet::validators().len()`
3. Sudo key present (until pallet-upgrade-governance is active)
4. No validator has missed > 10 consecutive slots
5. Finalization is advancing (finalized block < best block by less than 100)

**Storage:**
- `LastHealthCheck`: BlockNumber
- `ConsecutiveMisses`: Map<AuthorityIndex, u32>
- `HealthStatus`: enum { Healthy, Degraded, Critical }

**Events:**
- `HealthCheckPassed { block, status: Healthy }`
- `SessionStall { current_index, expected_index }`
- `SudoKeyMissing { block }`
- `ValidatorMissing { authority_index, consecutive_misses }`
- `FinalizationLag { best_block, finalized_block, gap }`
- `AuthorityMismatch { aura_count, validator_set_count }`

### 5.3 Inherent: Emergency Sudo Restore

A special inherent (not an extrinsic — included by block author) that can restore the sudo key.

**Requirements for inclusion:**
- 3/5 validator agents must sign the restore request (off-chain coordination)
- The block author includes the inherent with all 3+ signatures
- Runtime verifies signatures against current ValidatorSet
- Sudo key is written to storage
- Event emitted: `SudoKeyRestored { account, authorized_by: Vec<AccountId> }`

**This is the emergency backdoor** that prevents the lockout we experienced. It requires supermajority of validators, not a single key.

---

## 6. Agent Communication Protocol

Agents communicate over the QuantumHarmony P2P network using a dedicated substream protocol: `/paraxiom/qh-agent/1`.

**Message types:**
```rust
enum AgentMessage {
    // Health
    HealthReport { node_id: PeerId, status: HealthStatus, block: u64 },
    
    // Governance
    UpgradeProposal { id: u64, wasm_hash: H256, ipfs_cid: String, description: String },
    Vote { proposal_id: u64, approve: bool, reason: String },
    
    // Coordination
    BinaryStaged { node_id: PeerId, wasm_hash: H256 },
    ReadyForSwap { node_id: PeerId },
    SwapExecuted { node_id: PeerId, new_spec: u32 },
    
    // Emergency
    SudoRestoreRequest { account: AccountId, signatures: Vec<(PeerId, FalconSignature)> },
}
```

All messages are signed with the validator's Falcon-512 key for authentication.

---

## 7. Operator Interface

### 7.1 CLI

```bash
# Check agent status
qh-agent status

# View recent health checks
qh-agent health

# View pending governance proposals
qh-agent proposals

# Manually vote on a proposal
qh-agent vote 7 --approve
qh-agent vote 7 --reject --reason "Untested migration"

# Trigger manual diagnosis
qh-agent diagnose

# View agent logs
qh-agent logs --follow

# Configure auto-approve policy
qh-agent config set governance.auto_approve true
qh-agent config set governance.max_risk low
```

### 7.2 Dashboard Integration

The QH-Agent exposes a local HTTP API (port 3097) that the Node Operator Dashboard reads:
- `/api/agent/status` — agent health, uptime, last action
- `/api/agent/proposals` — pending governance proposals with AI summaries
- `/api/agent/health` — chain health report
- `/api/agent/keys` — keystore status (no secrets exposed)

### 7.3 Notifications

Configurable notification channels:
- Email (SMTP)
- Slack webhook
- Telegram bot
- Push notification (mobile)
- Webhook (custom URL)

```toml
[notifications]
channels = ["email", "slack"]
email = "edwin@example.com"
slack_webhook = "https://hooks.slack.com/..."

# Notification levels
notify_on = ["critical", "warning", "governance"]
# critical: node down, key lost, disk full
# warning: disk 80%, peer count low, slot missed
# governance: new proposal, vote needed, upgrade enacted
```

---

## 8. Security Model

### 8.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| Compromised agent generates malicious code | Proof harness gates all upgrades. Validators review diffs. Supermajority required. |
| Agent key stolen | Agent keys are separate from validator keys. Agent cannot sign blocks or transfer funds. |
| Malicious upgrade proposal | All agents independently verify WASM. Proof harness must pass on each validator. |
| Agent-to-agent communication intercepted | All messages Falcon-512 signed. P2P encrypted. |
| Rogue validator auto-approves everything | Other validators' agents catch the bad upgrade in their own proof harness. |
| AI model hallucination | cargo check + proof harness + human review for high-risk changes |

### 8.2 Trust Boundaries

```
TRUSTED:
  - Validator operator (can override any agent decision)
  - Validator keystore (hardware or encrypted file)
  - QuantumHarmony consensus (supermajority of validators)

SEMI-TRUSTED:
  - QH-Agent (can propose but not enact alone)
  - AI model (generates code but doesn't deploy without approval)

UNTRUSTED:
  - Network (all P2P messages verified)
  - Other validators' agents (verify everything independently)
  - External APIs (AI model endpoints — responses are validated)
```

### 8.3 Key Separation

```
Validator keys (SPHINCS+):
  - Aura block signing key → keystore, managed by Key Manager
  - Session rotation key → generated by agent, set via extrinsic

Agent keys (Falcon-512):
  - P2P authentication → agent-to-agent communication
  - Governance signing → vote attestation
  - NOT used for block production or fund transfers

Operator keys:
  - Keystore encryption password → human-only, never stored by agent
  - Dashboard login → separate from chain keys
```

---

## 9. Implementation Roadmap

### Phase 1: MVP Script Agent (1-2 weeks)
- Python script running on each validator's server
- Monitors: disk, peers, sync, block production
- Alerts via email/Slack
- Manual upgrade coordination via SSH
- No AI — template-based diagnostics
- No on-chain governance — uses existing sudo (once restored)

### Phase 2: AI-Powered Coder (2-4 weeks)
- Runpod GPU instance running code-capable LLM
- Reads QuantumHarmony codebase (loaded as context)
- Generates Rust code for runtime fixes
- Builds and tests locally
- Still requires manual deployment approval
- Agent-to-agent P2P communication for health sharing

### Phase 3: On-Chain Governance (4-8 weeks)
- pallet-upgrade-governance deployed
- pallet-chain-health deployed
- Agents submit proposals on-chain
- Auto-voting with configurable policy
- Coordinated deployment protocol
- Emergency sudo restore inherent

### Phase 4: Full Autonomy (8-12 weeks)
- Agent handles entire lifecycle: detect → diagnose → code → build → propose → deploy → verify
- Operator only intervenes for high-risk changes
- Multi-chain support (QH + future networks)
- Agent marketplace (share fixes between networks)

---

## 10. Relationship to Existing Components

| Existing | Role with QH-Agent |
|----------|-------------------|
| Coherence Shield | Agent can trigger attestation re-signing if keys rotate |
| QSSH | Agent uses QSSH for PQ-secure SSH to other validators |
| Proof Harness (check_pq.sh) | Agent's acceptance test gate — no upgrade without 10/10 PASS |
| Node Operator Dashboard | Reads agent API for health/governance display |
| Block Explorer | Shows governance proposal events and health alerts |
| axiom-daemon | Evolves into the QH-Agent (same container, expanded scope) |
| Transparence | Agent can anchor governance decisions via QH bridge |

---

## 11. What This Prevents (Never Again List)

| Incident | How agent prevents it |
|----------|----------------------|
| Sudo key loss (2026-04-19) | Key Manager monitors Sudo.Key storage every block. Health pallet emits SudoKeyMissing event. Agent proposes restore via governance. Emergency inherent as last resort. |
| Session rotation stall | Health pallet checks CurrentIndex advancing. Agent detects stall, proposes Period adjustment. |
| Validator key mismatch (Edwin disk failure) | Key Manager keeps encrypted backups. Auto-restores keystore on restart. Submits setKeys automatically. |
| Wrong pallet indices | Coder reads runtime metadata via RPC. Never hardcodes indices. |
| SCALE encoding mismatch | Coder uses substrate-interface compose_call(). Never manual encoding. |
| Chainspec confusion (wrong genesis) | Monitor verifies genesis hash on every restart. Refuses to start with wrong chainspec. |
| Uncoordinated binary swap | Deployer requires all agents to confirm staged binary before any restart. |
| 12-hour manual debugging sessions | Agent diagnoses in seconds, proposes fix in minutes, deploys in the next session rotation. |

---

## 12. Open Questions

1. **Which AI model?** Claude API (best quality, external dependency) vs local LLM on Runpod (full control, needs fine-tuning) vs hybrid (Claude for complex reasoning, local for routine checks)?

2. **Agent identity**: Should each agent have its own on-chain identity (soulbound NFT from IdentityRegistry)? This would create a formal link between the agent and its operator.

3. **Liability**: If an auto-approved upgrade causes a chain halt, who is responsible? The proposing agent's operator? All validators who voted? Need clear policy.

4. **Economics**: Should agents pay gas for governance proposals? Or should governance be fee-exempt for validators?

5. **Upgrade to the upgrade system**: How do we upgrade pallet-upgrade-governance itself? Bootstrap problem. Initial deployment via sudo (one last time), then self-governing.
