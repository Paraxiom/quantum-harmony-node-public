# Node Operator Agent — Design Document

**Status:** DRAFT — Iteration 3 (Torus Dimensions + Concrete Build Order)
**Date:** 2026-02-21
**Author:** Sylvain Cormier / Claude

---

## Vision

**Absolute security — quantum and AI — with minimal friction for the user.**

Every QuantumHarmony node runs an AI agent trained with zealous security discipline. Thousands of agents, each operating its local node autonomously — monitoring services, fixing failures, rotating keys, attesting every action on-chain. The operator opens their dashboard and watches the agent click through every feature in real time.

The agents coordinate across the network using the toroidal mesh topology. When one agent discovers a failure mode and fixes it, that knowledge propagates to all agents. The network becomes collectively intelligent — it learns, heals, and hardens itself.

The operator just watches.

---

## Design Principles

1. **PQ-secure everything** — No classical crypto anywhere in the stack. Falcon/SPHINCS+/ML-KEM only.
2. **Keys are sacred** — Never in env vars, never in plaintext memory longer than needed. Enclaved, monitored, zeroized.
3. **Every agent action is attested** — Via Coherence Shield (Falcon-512 signature + hash chain + on-chain receipt).
4. **Zero friction** — One command to start. qssh handles networking. Agent handles operations.
5. **Operator watches, agent acts** — Headed Playwright shows real clicks. The UI IS the monitoring dashboard.
6. **Collective intelligence** — Thousands of agents share knowledge via the toroidal mesh. The network self-heals.
7. **Security-zealous AI** — The model is fine-tuned to be paranoid about key exposure, unauthorized access, and insecure configurations. It refuses to take risky actions without operator consent.

---

## Problem Statement

1. **Services die silently** — Faucet was unhealthy for 5 days, nobody noticed
2. **Root causes are non-obvious** — Docker network alias lost after node restart
3. **Manual SSH debugging doesn't scale** — Requires Docker logs, network inspection, RPC calls
4. **Keys sit in plaintext** — SPHINCS+ secrets in Docker env vars, no enclave, no monitoring
5. **Port forwarding is a mess** — nginx reverse proxy, SSL certs, port mapping — all avoidable with qssh
6. **No audit trail for operations** — Who restarted what, when, why? No record.

---

## What We Have Today (Ground Truth)

### Coherence Shield

**What it IS:** An OpenAI-compatible HTTP proxy (Rust, Axum) that sits between any client and any LLM.

**Three pillars:**
1. **Toroidal logit bias** — 12x12 Tonnetz torus maps token IDs to positions. Last 5 context tokens define a neighborhood. Tokens within radius 2.0 get positive boost, distant tokens get penalty. Clamped [-100, +100]. 300 tokens for OpenAI, full 100,277 vocab for local models (Ollama/vLLM).
2. **Falcon-512 signing** — `SHA256(request) || SHA256(response) || timestamp` → Falcon-512 detached signature (690 bytes). Non-repudiable proof of what was asked and answered.
3. **JSONL hash chain** — Each audit entry includes `prev_hash`. Tamper-evident. Verifiable via `shield-cli audit verify`.

**Blockchain attestation:** Submits `system.remark(payload)` to QuantumHarmony via `quantumharmony_submitSignedExtrinsic`. Reads signer key from `BLOCKCHAIN_SIGNER_KEY` env var.

**API:**
- `POST /v1/chat/completions` — OpenAI-compatible, returns response + attestation envelope
- `POST /v1/passthrough/chat/completions` — No bias/signing
- `GET /health`

**Backends:** OpenAI, Anthropic, Ollama, vLLM
**Config:** TOML (`config/default.toml`, `config/docker.toml`, `config/local-ollama.toml`)
**Deployment:** Docker on Alice, `paraxiom.org/shield/`, port 3080, nginx proxied

**Cannot do:** Streaming signatures, STARK proofs, model weight access, >300 bias tokens on OpenAI

**Tests:** 35 Rust | **Lean:** 102 theorems, 7 files, zero sorries

### qssh

**What it IS:** Post-quantum SSH replacement. Full client/server/agent/keygen/scp toolchain.

**Crypto:** Falcon-512/1024, SPHINCS+, ML-KEM-768/1024, AES-256-GCM, HKDF-SHA256
**Security tiers:** T0 (classical) → T2 (fixed 768-byte frames, default) → T5 (full quantum)

**Port forwarding status:**
- **Local (-L):** WORKS. `qssh -L 8080:localhost:80 user@host`. Bidirectional, multiplexed channels.
- **Dynamic (-D):** WORKS. SOCKS5 proxy. `qssh -D 1080 user@host`.
- **Remote (-R):** STUB ONLY. `log::warn!("Remote forwarding not yet implemented")`.
- **Multiple forwards:** WORKS. `-L p1:h:p1 -L p2:h:p2` on single connection.
- **Persistent tunnels:** NOT IMPLEMENTED. Tunnel dies when connection closes.

**Key management:**
- `QuantumVault` — AES-256-GCM encrypted storage, master key from SHA3-256 KDF
- Usage counting, Lamport chains, Double Ratchet forward secrecy
- Key rotation: time-based (default 3600s)
- **NO HSM/TPM integration**
- Keys stored at `~/.qssh/id_qssh` (PEM format)

**Tests:** 89 passing (4 ignored, Falcon macOS segfault) | **Lean:** 67 theorems, zero sorries

**What's missing for node operators:**
- Remote forwarding (-R): ~2-3 days to implement
- Persistent daemon mode with auto-reconnect: ~3-5 days
- Health/metrics for tunnels: ~1 day

### Dashboard

**What it IS:** LCARS-themed SPA, ~7,500 lines HTML/JS. The operator's control panel.

**12 sections:** STATUS, TRANSFER, FAUCET, GOVERN, REWARDS, RUNTIME, KEYS, QUANTUM, NETWORK, SIGNALS, PROOFS, QUESTS

**Activity panel:** Chat (mesh forum on-chain), Activity log, Alerts

**Depends on:** Node :9944, Controller :9955, QKD :8181, Entropy Hub :8180, Crypto4A :8106, Faucet (proxied), TAO Signal API (Charlie)

### Notarial Playwright Tests

**What exists:** 4 test files. Only `test-signing-e2e.mjs` runs headed (visible clicks, 500ms slowdown). Covers 6-phase signing flow only.

**NOT covered:** Faucet, governance, rewards, runtime, keys, quantum, network, signals, proofs, quests, chat, transfers.

**No continuous mode.** One-shot execution only.

---

## Security Model (The Hard Problem)

### Current Key Landscape (What's Wrong)

| Key | Where It Lives Today | Risk |
|-----|---------------------|------|
| Alice SPHINCS+ validator key | Docker env var `SPHINCS_SECRET_KEY` | Readable by any process in container, `docker inspect` |
| Faucet signer key | Docker env var `FAUCET_SECRET_KEY` | Same |
| Coherence Shield blockchain key | Docker env var `BLOCKCHAIN_SIGNER_KEY` | Same |
| Coherence Shield Falcon-512 key | File `~/.coherence-shield/keys/` | Plaintext on disk |
| qssh identity key | File `~/.qssh/id_qssh` | PEM on disk, no passphrase enforcement |
| Dashboard user key | Browser localStorage | Cleared on cache wipe, XSS-vulnerable |

**Every key in the system is either in a plaintext env var or an unencrypted file.**

### Target Key Security Model

**Principle: Keys never exist in plaintext outside a trust boundary.**

#### Layer 1: Key Enclave (at rest)

qssh's `QuantumVault` already does AES-256-GCM encrypted storage with master key derivation. Extend this:

- **All service keys** stored in a single QuantumVault per node
- Vault locked at rest, unlocked on boot via operator passphrase or hardware token
- Master key derived from passphrase via Argon2id (not SHA3-256 — upgrade needed)
- Vault file integrity: hash chain (same pattern as Coherence Shield audit log)

#### Layer 2: Key Isolation (in memory)

- Keys loaded into a **dedicated signing service** (separate process, minimal attack surface)
- Services (faucet, shield, node) send sign requests via Unix socket — never receive the key
- Signing service runs in a restricted namespace (no network, no filesystem except vault)
- Memory pages holding keys: `mlock()` (prevent swap) + `madvise(MADV_DONTDUMP)` (prevent core dump)

#### Layer 3: Key Usage Monitoring

- Every signature operation logged to Coherence Shield audit chain
- Anomaly detection: unusual signing frequency, unexpected signers, off-hours usage
- Rate limiting: max N signatures per minute per key (prevent key exhaustion attacks)
- **Key canaries:** dummy keys that should never be used — if signed, compromise detected

#### Layer 4: Key Lifecycle

- **Generation:** Always via QRNG (Crypto4A endpoint) when available, fallback to OS entropy
- **Rotation:** Agent monitors key age, triggers rotation before expiry
- **Zeroization:** `zeroize` crate on all key material when dropped (qssh already does this)
- **Revocation:** On-chain revocation list (pallet already exists for session keys)
- **Backup:** Encrypted export to operator's device only, never to cloud

### Trust Boundaries

```
┌──────────────────────────────────────────────────┐
│  TRUSTED (key material allowed)                  │
│                                                  │
│  ┌──────────────────────────────────────┐        │
│  │  Signing Service (isolated process)  │        │
│  │  - Holds decrypted keys in mlock'd   │        │
│  │    memory                            │        │
│  │  - Exposes Unix socket API only      │        │
│  │  - No network, minimal filesystem    │        │
│  │  - Logs every sign op to audit chain │        │
│  └───────────────┬──────────────────────┘        │
│                  │ Unix socket (sign requests)    │
│  ┌───────────────▼──────────────────────┐        │
│  │  QuantumVault (encrypted file)       │        │
│  │  - AES-256-GCM, Argon2id KDF        │        │
│  │  - Hash-chained integrity            │        │
│  └──────────────────────────────────────┘        │
└──────────────────────────────────────────────────┘
                   │
                   │ sign(message) → signature
                   │ (key never crosses this boundary)
                   ▼
┌──────────────────────────────────────────────────┐
│  UNTRUSTED (no key material)                     │
│                                                  │
│  Node, Faucet, Dashboard, Coherence Shield,      │
│  Operator Agent, nginx, Docker                   │
│                                                  │
│  These services send signing requests and        │
│  receive back signatures. They never see keys.   │
└──────────────────────────────────────────────────┘
```

---

## Networking Model: qssh Replaces nginx

### Current Model (complex, fragile)

```
Operator's browser
    → HTTPS (Let's Encrypt cert)
    → nginx reverse proxy (Alice VPS)
    → proxy_pass to localhost:9944/8080/8085/9955/etc.
```

Problems: SSL cert renewal, nginx config, port mapping, VPS dependency, classical TLS

### Target Model (qssh, zero config)

```
Operator's machine                         Validator node
┌──────────────┐                          ┌──────────────┐
│ qssh client  │ ── PQ-encrypted tunnel ──│ qsshd server │
│              │   (Falcon + ML-KEM)      │              │
│ -L 9944:localhost:9944                  │  Node :9944  │
│ -L 8080:localhost:8080                  │  Dash :8080  │
│ -L 8085:localhost:8085                  │  Faucet:8085 │
│ -L 9955:localhost:9955                  │  Oper :9955  │
│ -L 3080:localhost:3080                  │  Shield:3080 │
└──────────────┘                          └──────────────┘

Operator opens http://localhost:8080 → sees dashboard
All traffic PQ-encrypted via qssh tunnel
No nginx, no SSL certs, no port exposure
```

**What's needed:**
- Remote forwarding (-R): for cases where operator needs to expose local services to validator
- Persistent daemon: tunnel survives network hiccups, auto-reconnects
- One-command setup: `qssh-node connect alice` binds all ports automatically

**Alternative for remote operators:** qssh dynamic forwarding (-D, SOCKS5) — already works. Configure browser to use SOCKS proxy, all dashboard traffic goes through PQ tunnel.

---

## Agent Architecture

### How Coherence Shield Fits

Coherence Shield is NOT a general-purpose agent framework. It is:
- An LLM proxy with bias + signing + audit
- The agent's "mouth" — every time it needs to reason, the request/response is signed and attested

The agent itself is a separate component that:
1. **Observes** (health monitor, Playwright test results, nginx logs, tx pool)
2. **Reasons** (sends observations to Coherence Shield → LLM → gets back diagnosis/action)
3. **Acts** (executes remediation: Docker commands, RPC calls, key rotation requests)
4. **Reports** (Playwright headed mode shows clicks; alerts via mesh forum / Telegram)

Every step 2 (reasoning) goes through Coherence Shield, so the full chain is:

```
Observation → Coherence Shield → LLM → Signed response → Action → On-chain attestation
```

### Agent Loop

```
while true:
  1. Health Monitor checks all services (fast, deterministic)
  2. Playwright runs next test in rotation (visible to operator)
  3. If failure detected:
     a. Collect diagnostics (logs, status, network)
     b. Send to Coherence Shield: "Faucet health returns connected:false.
        Docker network shows node missing from quantum-net. What action?"
     c. Receive signed response: "docker network connect --alias node ..."
     d. Execute action (via signing service for privileged ops)
     e. Re-run Playwright test to verify fix
     f. Attest remediation on-chain
     g. Post to mesh forum: "Faucet restored at block #XXXX"
  4. Sleep interval (configurable: 30s-5min)
```

### What the Operator Sees

The dashboard browser (connected via qssh tunnel to localhost:8080) shows:
- Normal dashboard UI
- Agent's Playwright clicks happening in real time (headed mode)
- Activity panel showing agent's actions and attestations
- Alert tab for failures and remediations

The operator can:
- Watch passively (default)
- Click anywhere to take manual control (agent pauses)
- Review agent's on-chain attestation log
- Override agent decisions

---

## Prerequisites & Build Order

### P0: Signing Service (security foundation)
**What:** Isolated process that holds decrypted keys, exposes Unix socket sign API.
**Why:** Everything else depends on keys being properly enclaved. Build this first.
**Scope:**
- Extend qssh QuantumVault (upgrade KDF to Argon2id)
- Unix socket API: `sign(key_id, message) → signature`
- `mlock` + `MADV_DONTDUMP` on key pages
- Audit logging of every sign operation
- Rate limiting per key
**Language:** Rust (reuse qssh vault code)

### P1: Health Monitor
**What:** Lightweight daemon checking all services continuously.
**Why:** The agent's eyes. Must exist before reasoning.
**Checks:** Node RPC, Faucet health, Dashboard HTTP, Operator health, Docker status, nginx errors, tx pool
**Output:** JSON status + event stream (Unix socket or file)

### P2: qssh Persistent Tunnels
**What:** Add daemon mode + auto-reconnect + multi-port config to qssh.
**Why:** Eliminates nginx/SSL for operators. Zero-friction networking.
**Scope:**
- Implement remote forwarding (-R) in `port_forward.rs`
- Add `qssh-tunnel` daemon with config file (list of forwards)
- Auto-reconnect with exponential backoff
- Health endpoint for tunnel status
- `qssh-node connect <node>` one-liner

### P3: Expanded Playwright Suite
**What:** Playwright tests for all 12 dashboard sections + activity panel.
**Why:** The agent's runbook. Each test = one operational check.
**Mode:** Headed (visible) + continuous loop + failure reporting
**Coverage:** STATUS, TRANSFER, FAUCET, GOVERN, REWARDS, RUNTIME, KEYS, QUANTUM, NETWORK, SIGNALS, PROOFS, QUESTS, CHAT

### P4: Coherence Shield Agent Integration
**What:** System prompt + tool definitions for node operator role.
**Why:** The agent's brain. Needs to understand QuantumHarmony operations.
**Scope:**
- System prompt with full operational context
- Tool definitions (health check, docker commands, RPC calls, signing requests)
- Test with Ollama local model (sovereign) and Claude API (capable)
- Measure latency and quality of operational reasoning

### P5: Remediation Playbook
**What:** Structured knowledge base of failure modes → fixes.
**Why:** The agent needs deterministic fixes for known problems, LLM reasoning for novel ones.
**Known modes:**
- Faucet disconnected → Docker network reconnect + restart
- InvalidTransaction::Payment → faucet drip
- Node restart breaks DNS → reconnect to compose network
- nginx 502 → check upstream health
- Key approaching rotation threshold → initiate rotation via signing service

### P6: Agent Orchestrator
**What:** The main loop that ties P0-P5 together.
**Why:** This is the product.
**Components:** Health monitor → Playwright runner → Coherence Shield reasoning → Remediation execution → On-chain attestation

---

## SMDR: The Agent's Brain

### Why SMDR, Not Ollama/OpenAI

SMDR (`Paraxiom/smdr`) is a Rust-native neural network with ternary weights {-1, 0, +1} and Tonnetz toroidal topology built into the attention mechanism. It changes the economics of "AI agent on every node":

| Dimension | External LLM (Ollama/API) | SMDR |
|-----------|--------------------------|------|
| Language | Python/C++ (Ollama) | Rust (same as entire stack) |
| Weights | FP16/FP32, ~14GB for 7B | Ternary {-1,0,+1}, fits CPU cache |
| Hardware | GPU helpful, ~8GB RAM | CPU-only, ~1.5J/inference |
| Dependency | External binary or API key | Compiles into same binary |
| Toroidal topology | Added at proxy layer (Coherence Shield) | Native in attention mechanism |
| Sovereignty | Ollama: local but separate; API: remote | Fully embedded, zero deps |
| Cost at 1000 nodes | 1000 GPUs or API bills | 1000 CPUs (already have them) |

### How SMDR Changes the Architecture

**Before (with Ollama):**
```
Observation → Coherence Shield → [Ollama 7B model] → Toroidal bias applied → Signed response
                                  ↑ separate process    ↑ proxy layer
                                  ↑ 8GB RAM             ↑ 300 token cap
```

**After (with SMDR):**
```
Observation → SMDR inference (toroidal attention native) → Coherence Shield (sign + attest only)
              ↑ same Rust binary                           ↑ no bias needed, just signing
              ↑ CPU cache, ~1.5J                           ↑ Falcon-512 + hash chain + on-chain
```

Coherence Shield's role simplifies: it doesn't need to inject toroidal logit bias because SMDR already has toroidal topology in its attention layers. Shield becomes a **pure signing and attestation service**.

### Training the Node Operator Model

**Base architecture:** SMDR with `layer_late` strategy (topology on final 1/3 of layers)

**Training data sources:**
1. **Operational logs** — Docker health checks, RPC responses, nginx access/error logs from all 3 current validators
2. **Failure/remediation pairs** — Today's faucet incident becomes training data:
   - Input: `{"health": {"faucet": {"connected": false}}, "docker": {"node": {"networks": ["default"]}}}`
   - Target: `{"action": "docker_network_connect", "params": {"alias": "node", "network": "quantum-net"}}`
3. **Security scenarios** — Key exposure attempts, unauthorized signing requests, env var dumps → model learns to refuse/alert
4. **Dashboard interactions** — Playwright test recordings: which clicks produce which RPC calls and expected responses
5. **QuantumHarmony RPC knowledge** — All 40+ RPC methods, their parameters, valid responses, error codes

**Training approach:**
- Straight-Through Estimator (STE) for ternary weight gradients (SMDR already supports this)
- Security-zealous system prompt baked into training data: every scenario includes security implications
- Tonnetz topology in attention naturally clusters related operational concepts (e.g., "faucet health" stays near "docker network" stays near "service restart")

**Model sizes for node operator:**
- `SMDRConfig::small()` (~20M params) — routine health checks, known failure modes
- `SMDRConfig::medium()` (~100M params) — novel failure diagnosis, multi-step remediation
- `SMDRConfig::large()` (~350M params) — full operational reasoning, governance decisions

**Recommended:** Start with medium (~100M). Ternary weights mean ~100M params = ~12.5MB on disk (vs ~200MB for FP16). Fits entirely in L2/L3 cache on modern CPUs.

### Security-Zealous Training

The model is trained with an adversarial security mindset:

**Things the model MUST refuse:**
- Output or log any key material
- Execute commands that expose env vars containing keys
- Approve signing requests outside rate limits
- Bypass the signing service (attempt direct key access)
- Ignore anomalous signing patterns
- Accept unverified remediation steps from other agents without consensus

**Things the model MUST flag:**
- Key usage outside normal patterns
- Unexpected processes accessing vault files
- Signing requests from unknown sources
- Network traffic patterns suggesting key exfiltration
- Core dumps or swap activity on key-holding processes

**Training methodology:**
- Red-team scenarios: simulate key exposure attempts, social engineering via mesh forum, malicious RPC payloads
- The model learns to detect and refuse these patterns
- Toroidal topology reinforces this: security-related tokens cluster tightly, making it harder for the model to "drift" into insecure reasoning

### Network-Scale Collective Intelligence

**Not 3 agents — thousands.**

Each node runs its own SMDR instance. Agents coordinate via the toroidal mesh topology that QuantumHarmony already uses for block consensus:

```
┌─────────────────────────────────────────────────────────────┐
│                    Toroidal Mesh (8×8×8 = 512 segments)     │
│                                                             │
│    Agent_A ←──── gossip ────→ Agent_B                       │
│      ↕                          ↕                           │
│    Agent_C ←──── gossip ────→ Agent_D                       │
│      ↕                          ↕                           │
│     ...         (thousands of nodes)          ...           │
│                                                             │
│    Each agent:                                              │
│    1. Monitors its local node                               │
│    2. Shares health status with torus neighbors             │
│    3. Receives remediation knowledge from the mesh          │
│    4. Votes on network-wide actions                         │
│    5. Updates its SMDR weights from collective experience   │
└─────────────────────────────────────────────────────────────┘
```

**Knowledge propagation:**
- Agent discovers new failure mode → fixes it → attests on-chain
- Neighboring agents on the torus receive the attestation
- The failure→fix pair becomes training data for all agents
- Over time, the entire network learns from every incident
- Proven diameter 12 on 8×8×8 torus means knowledge reaches all nodes in ≤12 hops

**Consensus for destructive actions:**
- Restarting a local service: agent acts alone (low risk, reversible)
- Network-wide parameter changes: requires quorum from torus neighborhood
- Emergency actions (key revocation, validator removal): requires supermajority
- This maps directly to the BFT quorum proofs already in `Consensus.lean`

**Federated model updates:**
- Each agent trains on its local operational data
- Weight updates (ternary: just {-1, 0, +1} flips) are tiny — ideal for gossip
- Aggregated updates propagate through the torus
- No central training server needed — fully decentralized
- On-chain attestation of model version hashes prevents poisoning

### SMDR + Coherence Shield Integration

The stack per node:

```
┌─────────────────────────────────────────────────┐
│                  SMDR Runtime                    │
│  ┌───────────────────────────────────────┐      │
│  │  Trained model (~12.5MB, ternary)     │      │
│  │  - Operational reasoning              │      │
│  │  - Security-zealous disposition       │      │
│  │  - Toroidal attention (native)        │      │
│  └───────────────┬───────────────────────┘      │
│                  │ inference result              │
│  ┌───────────────▼───────────────────────┐      │
│  │  Coherence Shield (signing only)      │      │
│  │  - Falcon-512 sign(decision)          │      │
│  │  - Hash chain append                  │      │
│  │  - On-chain attestation               │      │
│  │  - NO toroidal bias (SMDR handles it) │      │
│  └───────────────┬───────────────────────┘      │
│                  │ signed, attested action       │
│  ┌───────────────▼───────────────────────┐      │
│  │  Signing Service (enclaved keys)      │      │
│  │  - Executes privileged operations     │      │
│  │  - Rate-limited, audited              │      │
│  └───────────────────────────────────────┘      │
└─────────────────────────────────────────────────┘
```

## Decisions Made

### D1: Agent Authority — Self-heal + Governance Popup

**Resolved:** The agent has full self-healing authority for operational tasks. Governance actions require operator approval via a dashboard popup.

**Autonomous (no approval needed):**
- Restart unhealthy containers
- Reconnect Docker networks
- Fund accounts from faucet
- Rotate session keys on schedule
- Post health reports to mesh forum
- Run Playwright test cycles

**Requires operator popup approval:**
- Governance proposals (add/remove validators)
- Governance votes
- Runtime upgrades (WASM deployment)
- Key revocation
- Network parameter changes
- Any action flagged as "destructive" by the model

**Implementation:** Dashboard shows a modal popup with:
- What the agent wants to do
- Why (diagnostic context)
- Coherence Shield attestation (signed reasoning)
- APPROVE / DENY buttons
- Auto-deny after timeout (default: 5 minutes)

If operator is disconnected (no qssh session), governance actions queue until reconnection.

### D2: Key Unlock — qssh Session IS the Authorization

**Resolved:** The PQ-authenticated qssh tunnel is the unlock mechanism.

**Boot sequence:**
```
1. Node boots → services start → vault LOCKED
2. Agent starts in WATCH-ONLY mode:
   - Health monitoring: YES
   - Playwright checks: YES
   - Remediation: NO (just logs/alerts)
   - Signing service: LOCKED
3. Operator connects via qssh (Falcon/SPHINCS+ authenticated)
4. Authenticated session triggers vault unlock:
   - qssh session → signing service receives unlock signal
   - QuantumVault decrypts keys into mlock'd memory
   - Agent switches to SELF-HEAL mode
5. Operator disconnects (or timeout > N minutes):
   - Vault auto-locks (keys zeroized from memory)
   - Agent drops back to WATCH-ONLY
   - Queued governance actions preserved for next session
```

**Why this works:**
- No passphrase to type on boot (friction = zero for operator)
- No hardware token to physically manage
- PQ-secure authentication (Falcon/SPHINCS+, not classical SSH)
- Physical presence equivalent: if you can authenticate via qssh, you're the operator
- Graceful degradation: watch-only is safe, self-heal requires presence

**VPS option:** For unattended servers that need 24/7 self-heal:
- TPM-sealed vault (auto-unlock on boot, hardware-bound)
- Or: persistent qssh session from operator's always-on machine
- Or: operator pre-authorizes N hours of autonomous operation, vault auto-locks after

### D3: SMDR Model Size — Tiered

**Resolved:** Two tiers running simultaneously.

- **Tier 1: Small (~20M, ~2.5MB)** — Handles all known failure patterns. Runs first. Deterministic-equivalent speed. Covers 90% of operational scenarios.
- **Tier 2: Medium (~100M, ~12.5MB)** — Escalation for novel failures. Only invoked when Tier 1 returns low confidence. Full reasoning capability, still CPU-only.

The small model is the "fast path" (pattern matching on known failures). The medium model is the "slow path" (actual reasoning about novel situations). Both run on CPU, both are ternary, both have toroidal attention.

### D14: Torus Dimensions — T³/T⁴, Not T⁵

**Resolved:** The SMDR attention mechanism uses T³ (512 states) or T⁴ (4,096 states) toroidal topology. T⁵ is unnecessary.

**Reasoning:**

The agent's task domain is bounded: ~1000 distinct actions (health checks, Docker commands, RPC calls, signing operations, governance decisions). The torus needs enough capacity to represent meaningful relationships without wasting the CPU-cache advantage that makes ternary SMDR viable.

```
Torus    States (N=8)    Capacity vs task domain    CPU cache fit
T²       64              Too small (0.06×)           Trivial
T³       512             Right range (0.5×)          12.5MB model fits L3
T⁴       4,096           Comfortable (4×)            Still fits L3
T⁵       32,768          Overparameterized (32×)     Pushes L3 limits
```

**What the torus provides:**
- Wrap-around attention — no edge effects, every position is topologically equivalent
- Spectral gap guarantees — mixing time bounded, prevents dead attention zones
- Manhattan distance metric — well-defined, integer-valued, proven in Lean (`Toroidal.lean`)
- Diameter 12 on 8×8×8 — knowledge reaches all positions in ≤12 hops

**Why not T⁵:** The ternary weight advantage is that the model fits entirely in L2/L3 cache (~12.5MB for 100M params). T⁵ attention matrices are 32K×32K — they'd spill to main memory and destroy the latency advantage. T³ attention is 512×512, comfortably in cache.

**Connection to consensus mesh:** The consensus torus (8×8×8 T³) and the attention torus can share the same geometry. Agent reasoning naturally aligns with network topology — neighboring attention positions correspond to torus neighbors in the mesh.

**Spectral gap:** λ₁(C_N) = 2 - 2cos(2π/N). For N=8: λ₁ ≈ 0.586. For the product T³: λ₁ = min across dimensions = 0.586. Proven positive in `ProductGraph.lean`. This guarantees convergence of attention — no dead zones.

### D15: Payment Rails — Interac + Stripe + X402

**Resolved:** Multi-rail payment system. Operator picks their preference once during onboarding.

**For Canadian operators (Interac e-Transfer):**
- Operator provides email or phone number during setup — nothing else
- Payouts via VoPay or Chimoney REST API
- If recipient has Autodeposit enabled → money lands in bank automatically, zero action
- If not → email/SMS notification, one click to deposit
- Settlement: ~30 minutes
- No bank account details shared with Paraxiom
- Up to $25,000/transfer, 100K transactions/day

**For international operators (Stripe Connect):**
- Stripe Connect Express — simplified onboarding (name, address, bank)
- Handles KYC automatically (required for Tier 1 certification)
- Monthly payouts in local currency (CAD/USD/EUR/GBP/etc.)
- Settlement: 1-2 business days

**For crypto-native operators (X402):**
- Per-action settlement in USDC/BTC/ETH/TAO
- Multi-chain: Base (8453), Polygon (137), Solana
- Instant settlement, no intermediary
- Already formally verified (X402.lean, MultiChain.lean)

**Rail selection hierarchy (Canadian operators):**
```
Preference        Rail               Latency      Info needed
─────────────     ──────────────     ──────────   ──────────
Interac (email)   VoPay/Chimoney     ~30 min      Email only
Interac (phone)   VoPay/Chimoney     ~30 min      Phone only
Bank EFT          Stripe Connect     1-2 days     Bank details + KYC
Stablecoin        X402               Instant      Wallet address
Crypto            X402               Instant      Wallet address
```

**Agent manages payment rail health:**
- Monitors VoPay/Chimoney API status
- Falls back to Stripe if Interac fails
- Falls back to X402 if both fiat rails fail
- Alerts operator of payout failures
- Tracks earnings across all rails in operator's chosen display currency

### D4: Training Data — Three-Phase Bootstrap

**Resolved:** Start deterministic, generate synthetic data, train progressively.

#### Phase 1: Rule Engine (build now, runs immediately)

No SMDR model needed. Deterministic playbook handles known failure modes:

```rust
match observation {
    FaucetDisconnected => Action::DockerNetworkConnect + Action::DockerRestart,
    PaymentError(addr) => Action::FaucetDrip(addr),
    NodeDnsLost => Action::DockerNetworkReconnect,
    Nginx502(upstream) => Action::CheckContainerHealth(upstream),
    KeyAgeExceeded(key) => Action::RequestKeyRotation(key),  // → governance popup
    UnknownFailure(ctx) => Action::AlertOperator(ctx),
}
```

Every observation→action pair logged to structured JSONL (same format as Coherence Shield audit chain). This is training data generation from day one.

**Output:** `~/.quantumharmony/agent/operational.jsonl` — hash-chained, Falcon-signed.

#### Phase 2: Synthetic Data Generation (parallel with Phase 1)

Deliberately break things in controlled environments to generate training data:

**Chaos engineering on testnet:**
- Kill containers at random intervals → record observation→fix chains
- Drop Docker networks → record DNS resolution failures + fixes
- Drain accounts to zero → record Payment errors + faucet drips
- Inject malformed RPC responses → record error handling
- Simulate key exposure attempts → record security refusals
- Corrupt config files → record detection + restoration

**LLM-assisted scenario generation:**
- Feed Claude the real docker-compose.yml, all 40+ RPC methods, known error codes
- Generate thousands of hypothetical failure→diagnosis→fix scenarios
- Adversarial security scenarios: social engineering via mesh forum, malicious RPC payloads, timing attacks on signing service

**Playwright trace recording:**
- Run all dashboard tests, record every click→RPC call→response→UI change
- Generate positive traces (everything works) and negative traces (failures at each step)

**Target:** ~10,000 observation→action pairs before first SMDR training run.

#### Phase 3: Train SMDR (once data is sufficient)

```
Training data:
  - Phase 1 operational logs (real incidents from 3+ validators)
  - Phase 2 synthetic scenarios (chaos engineering + LLM-generated)
  - Security red-team dataset (adversarial robustness)

Training config:
  - SMDRConfig::medium() (100M params)
  - STE for ternary gradients
  - layer_late topology (final 1/3 of layers)
  - Security-zealous system context baked into all training samples
  - Cosine warmup schedule

Validation:
  - Hold out 20% of real operational data
  - Canary inputs: known security scenarios that MUST produce correct refusals
  - Rule engine comparison: model output must match deterministic rules for known patterns
  - Perplexity target: < 5.0 on operational domain
```

**Progressive handoff:**
```
Month 1:  Rule engine handles 100% of decisions
Month 2:  SMDR handles known patterns, rule engine validates
Month 3:  SMDR handles novel failures, rule engine is safety net
Month 6:  SMDR primary, rule engine fallback for edge cases
Month 12: SMDR + federated updates from thousands of nodes
```

The rule engine never goes away — it's the safety net. If SMDR proposes an action that contradicts the rule engine for a known scenario, the rule engine wins and the disagreement is logged for investigation.

#### Federated Learning (at scale)

Once thousands of nodes are running:

**Weight update gossip:**
- Agent trains on local operational data (fine-tuning, not from scratch)
- Ternary weight updates are tiny: just lists of {position, old_value, new_value} where values ∈ {-1, 0, +1}
- Updates signed with Falcon-512, hash attested on-chain
- Gossiped to torus neighbors (proven diameter 12 on 8×8×8 torus)

**Poisoning prevention:**
- On-chain attestation of model version hashes
- Torus-neighborhood consensus: accept update only if N neighbors also accept
- Canary validation: each node tests updates against canary inputs before applying
- Rollback: if model performance degrades (measured by rule engine agreement rate), revert to previous weights
- Model hash pinned on-chain — any node running a tampered model is detectable

## Open Questions (Remaining)

### Q1: SMDR initial training — where does compute happen?
- Option A: Central server trains base model, distributes checkpoint to all nodes. Federated fine-tuning only.
- Option B: Each node trains from scratch on its own data. Slower convergence but fully decentralized.
- Option C: Hybrid — Paraxiom trains base model on aggregated chaos engineering data, nodes fine-tune locally.
- **Leaning toward C** — base model needs diverse failure data that no single node has.

### Q2: VoPay vs Chimoney for Interac payouts
- VoPay: more established, higher volume, better docs. Toronto-based.
- Chimoney: bulk API simpler, good for batched monthly payouts.
- Need to evaluate: API sandbox access, per-transaction fees, settlement speed, reliability.

### Q3: Mobile node feasibility
- Web (WASM) node in browser for demos — feasible?
- iOS/Android background service — battery + network constraints?
- Subset of agent functionality on mobile (monitoring only, no self-heal)?

### Q4: Governance weight — on-chain pallet or off-chain calculation?
- On-chain: transparent, auditable, but adds pallet complexity + storage
- Off-chain: agent calculates, attests result on-chain. Simpler but requires trust in attestation.
- Hybrid: inputs on-chain (uptime proofs, vote records), weight formula calculated off-chain, result attested.

---

## Data-Centric Economics — The Agent as Revenue Operator

### The Business Model the Agent Serves

QuantumHarmony is a data-centric blockchain. The QH token is a fixed-price ($0.001) consumable utility unit — a postage stamp. It does not appreciate, cannot be staked for yield, and is not a security.

**Revenue comes from data services, not token sales:**
- Data attestation fees (documents, AI outputs, records)
- Signal subscriptions (dynamic NFTs — market, AI, infrastructure data streams)
- Coherence Shield API (OpenAI-compatible proxy with on-chain attestation + TLB)
- Node operator services (validator uptime, RPC endpoint, storage SLA)

**Operators are paid in their preferred currency:** CAD, USD, EUR, BTC, ETH, USDC, TAO.

**The agent's job expands:** it's not just keeping services alive — it's operating a revenue-generating node. Every API call is a revenue event. Every attestation is billable. The agent ensures uptime, processes attestations, maintains signal streams, and tracks revenue.

### Fiat On-Ramp — Bypassing SEC/AMF

**Why it works:** A fixed-price utility token consumed on use is not a security under the Howey test (no expectation of profit from the efforts of others). No AMF securities jurisdiction. No OSFI crypto-asset exposure. Enterprises adopt without legal review.

**The customer never "buys crypto."** They buy attestation services, API access, or signal subscriptions. Payment happens in fiat. QH tokens are invisible internal accounting — like AWS compute credits. The blockchain is invisible plumbing.

#### Recommended On-Ramp Stack

**Primary: Stripe (service billing framing)**
- Customer buys "attestation credits" or "signal subscription" via Stripe checkout
- Stripe sees a SaaS transaction, not a token sale
- QH token minting happens on backend, invisible to customer and Stripe
- Stripe Connect for automated operator payouts in local currency (CAD, USD, EUR)
- Canadian company, Canadian payment rails — regulatory home advantage
- Apple Pay / Google Pay via Stripe for zero-friction consumer payments

**Storefront: Shopify Payments**
- "Shopify for data attestation" positioning
- Enterprise customers buy attestation packages like SaaS plans
- Shopify handles tax, invoicing, multi-currency
- Already Canadian infrastructure

**Universal: X402 Micropayments (everywhere, not just TAO)**
- HTTP 402 Payment Required — built into every endpoint in the stack
- Not TAO-specific — Coherence Shield, attestation, signals, RPC, notarial, all of it
- Per-call micropayments: every API request can carry payment
- Multi-chain settlement: Base (8453), Polygon (137), Solana (formally verified in MultiChain.lean)
- HMAC-SHA256 signed payment headers, 300s validity window, 3 tiers (1/10/100 nTAO or equivalent)
- No fiat rails needed for crypto-native users
- Already formally verified: X402.lean (sig validity, tiers, HMAC) + MultiChain.lean (chain IDs, gas ordering)

**Backup: Banxa**
- Canadian company (Toronto), native fiat-to-crypto
- If Stripe ever gets nervous about "blockchain" in the description
- Supports 170+ countries, handles KYC

**Enterprise: Direct bank (Plaid + EFT/ACH/SEPA)**
- Lowest fees for high-volume enterprise customers
- ACH (US), EFT (Canada), SEPA (EU)
- Wire transfers for large contracts
- More integration work but cheapest per-transaction

#### Two Payment Paths — Same Backend

**Path 1: Fiat (Stripe) — enterprise customers who never touch crypto**
```
Enterprise → Stripe checkout → "100,000 Attestation Credits — $100"
Backend: mint QH tokens → enterprise gas wallet (auto-managed)
Customer sees: SaaS invoice. Never sees "token" or "blockchain."
```

**Path 2: X402 (everywhere) — crypto-native customers, per-call**
```
Any HTTP request to any endpoint:
  → Client includes X402 payment header (HMAC-SHA256 signed, 300s validity)
  → Service validates payment, processes request
  → Settlement on Base/Polygon/Solana (multi-chain)
  → No account needed, no subscription, no onboarding
```

**Both paths converge:**
```
API call → QH token burned as gas → attestation on-chain → response returned
Operator earns revenue share regardless of which payment path the customer used
Operator payout: Stripe Connect (fiat) or direct crypto settlement (X402)
```

#### X402 Across the Entire Stack

Every HTTP endpoint in the QuantumHarmony ecosystem speaks X402:

| Service | Endpoint | X402 Payment |
|---------|----------|-------------|
| Coherence Shield | `/v1/chat/completions` | Per-call: AI inference + attestation |
| Attestation | `/attest` | Per-document: PQ-signed hash on-chain |
| Signals | `/signals/{id}/subscribe` | Per-update or subscription tier |
| Notarial | `/notarize` | Per-document: legal attestation |
| RPC Access | `/rpc` | Per-call: premium RPC with SLA |
| QRNG | `/v1/random` | Per-byte: quantum entropy |

**What this means for the agent:**
- The agent monitors X402 payment processing on every endpoint
- Tracks revenue per endpoint, per customer, per time period
- Ensures payment validation is working (HMAC verification, chain settlement)
- Alerts operator if payment processing fails (revenue loss)
- The agent itself is a revenue-maximizing operator

### What the Agent Manages (Revenue Operations)

The node operator agent doesn't just keep services running — it operates the revenue side:

**Service uptime = revenue:**
- Coherence Shield downtime = lost API revenue
- Signal stream interruption = lost subscription revenue
- Attestation service failure = lost attestation fees
- The agent's self-healing directly protects operator income

**Automated gas management:**
- Monitor enterprise gas wallets (QH token balance)
- Auto-top-up when balance low (trigger Stripe charge or alert enterprise)
- Track burn rate per customer
- Predict when top-up needed based on usage patterns

**Revenue tracking:**
- Attestations processed per day/week/month
- Signal subscriptions active
- API calls served
- SLA uptime percentage (affects operator payout)
- Revenue earned in operator's preferred currency

**Signal management:**
- Ensure signal streams are live and updating
- Monitor data source health (market feeds, node telemetry, AI outputs)
- PQ-attest every signal update
- Track subscriber count and revenue per signal

### Signals Dashboard Integration

The SIGNALS tab in the dashboard (currently showing TAO Intelligence, QRNG Pool, QKD Routing, Oracle) becomes the agent's revenue monitor:

- **Active Signals:** count of live data streams this node produces
- **Subscribers:** total subscribers across all signals
- **Revenue Today:** real-time revenue tracking in operator's currency
- **SLA Score:** uptime percentage affecting payout
- **Next Payout:** countdown to Stripe Connect disbursement

The agent's Playwright test suite includes signal health checks — ensuring every signal the operator produces is live, attested, and generating revenue.

---

## Decisions Summary

| # | Decision | Resolution |
|---|----------|------------|
| D1 | Agent authority | Self-heal autonomous. Governance = popup. Telegram backup notification. |
| D2 | Key unlock | qssh session = authorization. Boot → watch-only. Connect → self-heal. Disconnect → locks. |
| D3 | Model size | Tiered: small (20M) fast path + medium (100M) escalation. Both ternary, CPU-only. |
| D4 | Training bootstrap | Rule engine → synthetic chaos data → SMDR training → progressive handoff. |
| D5 | SMDR integration | Single binary. `smdr` crate as cargo feature in Coherence Shield. Native Rust inference. |
| D6 | Multi-agent coordination | Thousands of nodes. Federated learning via torus gossip. Ternary weight updates. |
| D7 | Vault auto-lock | No timeout. Agent stays in self-heal as long as needed. Everything logged + attested. |
| D8 | Payment rails | X402 everywhere (universal, every endpoint). Stripe for fiat customers. Shopify storefront. Banxa backup. |
| D9 | Single binary | SMDR + Coherence Shield compiled as one Rust binary via cargo feature flag. |
| D10 | Onboarding | Facebook-style viral. One click from referral email. Agent generates + manages keys. No seed phrase ever. |
| D11 | Certification | 6 tiers mapping to qssh T0-T5: Instant 70% → KYC 100% → Hardware 120% → HSM+QRNG 150% → QKD 200% → Full Quantum 250%. Agent handles all progression. |
| D12 | Referrals | On-chain tracking. 5% of invitee revenue for 90 days. One level only (no MLM). Torus affinity placement. |
| D13 | X402 | Universal payment layer — every HTTP endpoint in the stack, not just TAO. |
| D14 | Torus dimensions | T³ (8×8×8=512) for consensus mesh. T³ or T⁴ for SMDR attention — NOT T⁵. Task domain is bounded (~1000 actions), overparameterizing wastes CPU cache advantage. |
| D15 | Payment rails | Multi-rail: Interac e-Transfer (Canada, via VoPay/Chimoney, email/phone only), Stripe Connect (international fiat), X402 (crypto). Operator picks once. |

---

## Build Order (Concrete)

### Milestone 0: "It stays alive" — Self-healing on current 3 validators

**Goal:** Agent keeps all services running on Alice/Bob/Charlie without manual SSH. Rule engine only, no ML. The faucet never dies unnoticed again.

**Deliverable:** Single Rust binary (`qh-agent`) that runs on each validator.

| # | Work Item | Repo | What ships | Depends on |
|---|-----------|------|-----------|------------|
| 0.1 | **Signing Service** | `paraxiom-qssh` | Extend QuantumVault: Unix socket API, `sign(key_id, msg) → sig`, mlock + MADV_DONTDUMP, Argon2id KDF, per-key rate limit, audit log (JSONL, hash-chained) | — |
| 0.2 | **Health Monitor** | `quantum-harmony-node` (new crate: `qh-agent`) | Daemon checking: node RPC (:9944), faucet (/health), dashboard (:8080), KYC (:8200), operator (:9955), Docker container status, Docker network aliases, tx pool depth. Output: JSON status to Unix socket + file. | — |
| 0.3 | **Rule Engine** | `qh-agent` | Deterministic match-action playbook. Known failures → known fixes. Every observation→action pair logged to `operational.jsonl` (hash-chained, Falcon-signed via 0.1). | 0.1 |
| 0.4 | **Remediation Executor** | `qh-agent` | Executes rule engine actions: `docker network connect`, `docker restart`, faucet drip RPC, nginx reload. Privileged ops via signing service. Pre/post health check on every action. | 0.1, 0.2, 0.3 |
| 0.5 | **qssh Persistent Tunnels** | `paraxiom-qssh` | Daemon mode (`qssh-tunnel`), config file for port list, auto-reconnect with exponential backoff, health endpoint. Remote forwarding (-R) implementation in `port_forward.rs`. | — |
| 0.6 | **`qssh-node connect` CLI** | `paraxiom-qssh` | One-liner: `qssh-node connect alice` → opens PQ tunnel to node, unlocks vault, agent enters self-heal mode. | 0.1, 0.5 |

**Known failure patterns baked into rule engine (day one):**
```rust
match observation {
    FaucetDisconnected       => docker_network_connect("node", "quantum-net") + docker_restart("faucet"),
    KycUnhealthy             => docker_restart("kyc-api"),
    PaymentError(addr)       => faucet_drip(addr),
    NodeDnsLost              => docker_network_reconnect_all(),
    Nginx502(upstream)       => check_container(upstream) + restart_if_unhealthy(),
    KeyAgeExceeded(key_id)   => queue_governance_popup(KeyRotation(key_id)),
    DockerOOM(container)     => restart_with_increased_limit(container),
    RpcTimeout               => check_node_sync_status() + restart_if_stuck(),
    TxPoolFull               => alert_operator(),
    UnknownFailure(ctx)      => log_for_training(ctx) + alert_operator(),
}
```

**Exit criteria:** Deploy `qh-agent` on Alice. Watch it fix the faucet cascade autonomously for 72 hours. Zero SSH interventions.

---

### Milestone 1: "The operator watches" — Playwright + Dashboard integration

**Goal:** Agent clicks through the entire dashboard in headed mode. Operator sees automated health checks. Every dashboard feature is tested continuously.

**Deliverable:** Playwright test suite (13 sections) + agent activity panel in dashboard.

| # | Work Item | Repo | What ships | Depends on |
|---|-----------|------|-----------|------------|
| 1.1 | **Playwright test suite** | `quantumharmony-notarial` (expand) | Tests for all 13 dashboard sections: STATUS, TRANSFER, FAUCET, GOVERN, REWARDS, RUNTIME, KEYS, QUANTUM, NETWORK, SIGNALS, PROOFS, QUESTS, CHAT. Headed mode, 500ms slowdown, continuous loop. | 0.2 |
| 1.2 | **Activity panel** | `quantum-harmony-node/dashboard` | New dashboard section: real-time feed of agent actions, attestations, health checks, remediations. WebSocket from agent → dashboard. | 0.2, 0.4 |
| 1.3 | **Governance popup** | `quantum-harmony-node/dashboard` | Modal for agent-proposed actions needing approval: runtime upgrades, key rotation, validator set changes. APPROVE/DENY/DEFER buttons. Auto-deny after 5 min timeout. | 0.3 |
| 1.4 | **Agent ↔ Playwright bridge** | `qh-agent` | Agent triggers Playwright runs, parses results, feeds failures into rule engine. Playwright test failure = health check failure. | 0.3, 1.1 |

**Exit criteria:** Agent runs full Playwright suite on Alice every 5 minutes. Operator watches from laptop via qssh tunnel. Dashboard shows live activity feed. Any dashboard feature that fails triggers automatic remediation.

---

### Milestone 2: "It thinks" — SMDR + Coherence Shield single binary

**Goal:** Replace rule engine escalation path with SMDR inference. Agent reasons about novel failures. Single Rust binary.

**Deliverable:** `qh-agent` binary with SMDR + Coherence Shield compiled in (cargo feature flags).

| # | Work Item | Repo | What ships | Depends on |
|---|-----------|------|-----------|------------|
| 2.1 | **SMDR cargo feature** | `coherence-shield` | `smdr` crate as optional dependency. `backend.provider = "smdr"` config. Native inference, no HTTP hop. Signing-only mode when SMDR handles reasoning. | — |
| 2.2 | **T³ attention config** | `smdr` | New config: `SMDRConfig::node_operator()` — 100M params, T³ (8×8×8) toroidal attention, `layer_late` strategy (final 1/3 layers). Ternary weights, ~12.5MB on disk. | — |
| 2.3 | **Training data pipeline** | `qh-agent` | Export `operational.jsonl` (from 0.3) → SMDR training format. Include: observation → diagnosis → action → outcome. Security scenarios: refusal training data. | 0.3 |
| 2.4 | **Chaos engineering** | `qh-agent` (testnet only) | Scripted failure injection: kill containers, drop networks, drain accounts, inject malformed RPC, simulate key exposure. Records observation→fix chains as training data. | 0.2, 0.4 |
| 2.5 | **SMDR training run** | `smdr` | Train `node_operator` model on data from 2.3 + 2.4. STE for ternary gradients. Cosine warmup. Canary validation: known security scenarios must produce correct refusals. | 2.1, 2.2, 2.3, 2.4 |
| 2.6 | **Progressive handoff** | `qh-agent` | Two-tier inference: SMDR proposes action → rule engine validates. If disagreement on known pattern, rule engine wins. Agreement rate tracked. SMDR becomes primary when agreement > 95% over 7 days. | 0.3, 2.5 |
| 2.7 | **Single binary build** | `qh-agent` | `cargo build --features smdr,shield,qssh,agent` → one binary. Embeds: SMDR runtime + trained model + Coherence Shield (sign/attest) + qssh client + health monitor + rule engine + Playwright runner. | 2.1, 2.6 |

**Exit criteria:** Single binary on Alice. SMDR handles novel failure (not in rule engine). Coherence Shield signs the decision. On-chain attestation recorded. Rule engine validates. ~12.5MB model fits in L3 cache. Inference < 100ms on CPU.

---

### Milestone 3: "It earns" — Revenue operations + payment rails

**Goal:** Every API call generates revenue. Operator gets paid in their preferred currency.

**Deliverable:** X402 on all endpoints, Interac/Stripe/X402 payouts, revenue dashboard.

| # | Work Item | Repo | What ships | Depends on |
|---|-----------|------|-----------|------------|
| 3.1 | **X402 middleware crate** | New: `x402-middleware` | Extract from TAO Signal, generalize. Axum middleware: validate HMAC-SHA256 headers, 300s validity, multi-chain settlement (Base/Polygon/Solana). Plugs into any Axum service. | — |
| 3.2 | **X402 integration** | `coherence-shield`, `quantum-harmony-node` (faucet, KYC, operator) | Add X402 middleware to all HTTP services. Per-call pricing configurable per endpoint. | 3.1 |
| 3.3 | **Interac payout integration** | `qh-agent` | VoPay or Chimoney REST client. Send payouts via email or phone. Auto-deposit support. Fallback to Stripe if Interac fails. | — |
| 3.4 | **Stripe Connect integration** | `qh-agent` | Stripe Connect Express onboarding for international operators. Monthly payout in local currency. Maps to Tier 1 KYC certification. | — |
| 3.5 | **Revenue tracking** | `qh-agent` + dashboard | Agent tracks: attestations processed, signals served, API calls, SLA uptime. Dashboard earnings tab: daily/weekly/monthly in operator's currency. Aggregates across Interac + Stripe + X402. | 3.1, 3.3, 3.4 |
| 3.6 | **Auto gas management** | `qh-agent` | Monitor enterprise gas wallets. Auto-top-up via faucet drip or Stripe charge. Predict when top-up needed. Track burn rate per customer. | 0.3 |
| 3.7 | **Signal producer framework** | `qh-agent` | Auto-create infrastructure signals from node telemetry (block time, finalization lag, peer count, memory). PQ-attest every update. X402 subscription for consumers. | 3.1, 3.2 |

**Exit criteria:** Enterprise customer calls Coherence Shield API with X402 header. Payment validated, request processed, attestation on-chain. Operator sees revenue in dashboard. Monthly payout arrives via Interac e-Transfer to operator's email.

---

### Milestone 4: "It grows" — Onboarding + certification + referrals

**Goal:** New operators join with one click. Agent manages their keys, certification, and referral bonding.

**Deliverable:** Installer, onboarding flow, certification engine, referral tracking.

| # | Work Item | Repo | What ships | Depends on |
|---|-----------|------|-----------|------------|
| 4.1 | **Installer** | New: `qh-install` | `curl -sSL https://quantumharmony.network/install \| sh` — downloads single binary, generates SPHINCS+ keypair, stores in QuantumVault, connects to network via qssh, opens dashboard at localhost:8080. | 2.7 |
| 4.2 | **Onboarding flow** | Dashboard | First-run wizard: "Choose your name. Choose your currency. Done." Connects to referrer's node for torus placement. Auto-completes G001-G003 quests. | 4.1 |
| 4.3 | **Certification engine** | `qh-agent` | Continuous security posture evaluation. Auto-detects: TPM/YubiKey (Tier 2), HSM (Tier 3), QRNG (Tier 3), QKD (Tier 4). Offers upgrade popup with revenue multiplier incentive. Records tier on-chain. | 0.1 |
| 4.4 | **Referral system** | `qh-agent` + dashboard | Generate invite links (contains node ID + referral code). On-chain referral bond. 5% of invitee revenue for 90 days. Torus affinity placement. Dashboard: "Invite" button + referral earnings tracker. | 3.5 |
| 4.5 | **Telegram governance bot** | `qh-agent` | Proposal notifications, one-tap voting (reply 1/2/3), alert forwarding. For Level 2+ operators away from dashboard. | 1.3 |

**Exit criteria:** Existing operator clicks "Invite". Friend receives email. Friend clicks link. Binary downloads, keys generate, node connects. Friend sees dashboard with agent running. Referrer sees 5% bonus in earnings.

---

### Milestone 5: "It scales" — Federated learning + network coordination

**Goal:** Thousands of agents. Collective intelligence. Rolling upgrades without downtime.

**Deliverable:** Federated SMDR training, upgrade orchestration, network-wide health view.

| # | Work Item | Repo | What ships | Depends on |
|---|-----------|------|-----------|------------|
| 5.1 | **Federated weight gossip** | `qh-agent` | Ternary weight updates ({position, old, new} triples) gossiped via torus mesh. Signed with Falcon-512. Torus diameter 12 = full propagation in ≤12 hops. | 2.5, 2.7 |
| 5.2 | **Poisoning prevention** | `qh-agent` | Canary validation before applying updates. Torus-neighborhood consensus (N neighbors must accept). Model hash pinned on-chain. Rollback if rule engine agreement drops below 90%. | 5.1 |
| 5.3 | **Rolling upgrade orchestration** | `qh-agent` | Agent coordinates with torus neighbors. Never upgrade >1/3 simultaneously. Wave assignment by torus position (graph coloring). Post-upgrade Playwright full suite. Auto-rollback on failure. Cross-wave health attestation required before next wave starts. | 0.4, 1.4 |
| 5.4 | **Network health dashboard** | Dashboard | Aggregate view: total nodes, upgrade status per wave, global SLA, revenue, model version distribution. Only for Level 3 (contributing) operators. | 1.2, 5.3 |
| 5.5 | **Governance weight engine** | `qh-agent` | Calculate Proof of Useful Work score (max 550): uptime + attestations + signals + votes + contributions + certification tier. Record on-chain. Feed into governance proposal voting weight. | 3.5, 4.3 |

**Exit criteria:** 100+ nodes running agents. New failure mode discovered on node X → fixed → training data gossiped → all agents learn within minutes. Runtime upgrade rolls across network in 3 waves without downtime. Governance proposal passes with weighted votes.

---

## Onboarding — Facebook-Style Viral Growth

### Principle: Zero Friction, Keys Are Invisible

The user never sees a key, a seed phrase, or a hex string. Ever. The agent generates keys, manages them, rotates them, enclaves them. The user clicks one link and they're a node operator.

### The Flow

```
1. Alice is a node operator. She clicks "Invite" in her dashboard.
   → Generates unique referral link (contains Alice's node ID + referral code)
   → Sends email/SMS/WhatsApp to Bob

2. Bob receives:
   "Alice invited you to run a QuantumHarmony node.
    You'll earn [CAD/USD/EUR] for providing data services.
    One click to start."
   [START NOW]

3. Bob clicks:
   → Lands on web installer (or app store for mobile)
   → Downloads lightweight installer / opens web app
   → "Choose your name. Choose your currency. Done."
   → That's it. No wallet. No seed phrase. No config.

4. Behind the scenes (Bob never sees this):
   → Agent generates SPHINCS+ keypair
   → Keys stored in software QuantumVault (encrypted, agent-managed)
   → Connects to network via qssh (auto-discovers peers)
   → Joins Alice's torus neighborhood (referral affinity)
   → Agent starts in self-heal mode
   → Begins processing attestations, earning revenue
   → First Devonomics quests auto-complete (G001 Genesis, G003 Registered)

5. Bob opens his dashboard:
   → Sees the agent clicking through health checks
   → Sees "Earned: $0.12 today" in his chosen currency
   → Sees Alice listed as referrer
   → Gets prompted: "Invite friends to earn more"

6. Bob invites Carol. Repeat.
```

### No Seed Phrase. No Wallet. No Crypto Knowledge.

**What the user manages:** Their name, their email, their payout currency. That's it.

**What the agent manages:** Keys, vault, rotation, network connection, service health, revenue collection, gas management, attestation processing, signal maintenance.

**The user doesn't know they're running a blockchain node.** They know they're earning money for providing a data service. The blockchain is invisible plumbing — same principle as the payment model.

### Multi-Tiered Certification (Automatic)

The agent handles certification progression automatically. Higher tiers unlock higher revenue multipliers — incentivizing security without requiring it.

```
┌─────────────────────────────────────────────────────────────┐
│  TIER 0: INSTANT (one click, zero friction)          qssh T1│
│  - Agent generates SPHINCS+ keypair automatically           │
│  - Software vault (AES-256-GCM, agent-managed)              │
│  - OS entropy (/dev/urandom)                                │
│  - No KYC, no hardware                                      │
│  - Revenue multiplier: 70%                                  │
│  - "You clicked a link. You're earning."                    │
├─────────────────────────────────────────────────────────────┤
│  TIER 1: KYC VERIFIED (5 minutes)                    qssh T1│
│  - Stripe Connect KYC (name, address, bank)                 │
│  - Unlocks fiat payouts                                     │
│  - Revenue multiplier: 100%                                 │
│  - "You verified. Full earnings unlocked."                  │
├─────────────────────────────────────────────────────────────┤
│  TIER 2: HARDWARE SECURED (add device)               qssh T2│
│  - Agent detects TPM / YubiKey / hardware token             │
│  - Keys migrated to hardware enclave automatically          │
│  - Fixed 768-byte PQ frames (traffic analysis resistant)    │
│  - Revenue multiplier: 120%                                 │
│  - "Hardware detected. Keys secured. Bonus active."         │
├─────────────────────────────────────────────────────────────┤
│  TIER 3: HSM + QRNG (add HSM appliance)              qssh T3│
│  - Hardware Security Module for key storage + signing       │
│  - QRNG entropy source (e.g., Crypto4A — already at :8106) │
│  - Keys never exist outside HSM, even during signing        │
│  - Entropy from quantum source, not pseudo-random           │
│  - Revenue multiplier: 150%                                 │
│  - "Quantum entropy active. HSM secured."                   │
├─────────────────────────────────────────────────────────────┤
│  TIER 4: QKD SECURED (add QKD link)                  qssh T4│
│  - Quantum Key Distribution for key agreement               │
│  - Keys derived from quantum channel, not algorithmic       │
│  - QKD endpoint already in stack (:8181)                    │
│  - Information-theoretic security (not computational)       │
│  - Revenue multiplier: 200%                                 │
│  - "Quantum key distribution active. Maximum security."     │
├─────────────────────────────────────────────────────────────┤
│  TIER 5: FULL QUANTUM (all layers)                   qssh T5│
│  - HSM + QRNG + QKD + isolated signing service              │
│  - mlock'd memory, key canaries, continuous audit           │
│  - Every layer quantum-secured, formally verified           │
│  - Revenue multiplier: 250%                                 │
│  - "Full quantum stack. Highest certification in network."  │
└─────────────────────────────────────────────────────────────┘
```

**Maps to qssh security tiers:** T1 (PQ algorithms) → T2 (fixed frames) → T3 (QRNG entropy) → T4 (QKD keys) → T5 (all combined). The infrastructure already exists — Crypto4A QRNG at :8106, QKD endpoint at :8181, qssh transport with all tiers implemented.

**Price trajectory makes this a natural progression:**
- 2026: Tier 0-2 is where most operators live. HSM/QRNG/QKD expensive.
- 2028: HSM costs drop. Tier 3 becomes accessible. QRNG commoditizes.
- 2030+: QKD links become affordable. Tier 4-5 within reach.
- The architecture supports all tiers from day one. Operators upgrade as hardware costs drop.

**The agent nudges upward with revenue incentives:**
- "You've earned $50 this month at 70%. Verify identity → $71." (Tier 1)
- "YubiKey detected. Secure your keys on it? → 120%." (Tier 2)
- "Crypto4A HSM available. Connect it? → 150%." (Tier 3)
- "QKD link detected on your network. Activate? → 200%." (Tier 4)
- Each upgrade is a single popup. The agent does the work.

### Certification Is Automatic

The agent continuously evaluates the node's security posture and upgrades/downgrades the tier accordingly. No manual certification process. Hardware plugged in → detected → upgraded. Removed → downgraded gracefully.

### Referral Mechanics

**On-chain referral tracking:**
- Each invite link contains referrer's node ID
- When invitee joins, referral bond recorded on-chain
- Referrer earns bonus: 5% of invitee's revenue for first 90 days
- Both parties get Devonomics quest reward
- Torus affinity: invitee placed near referrer in mesh topology

**Anti-gaming:** Revenue share capped at 90 days. One level only — no MLM/pyramid. The incentive is to bring real operators.

### Installer

**One-liner (macOS/Linux):**
```bash
curl -sSL https://quantumharmony.network/install | sh
```
- Single binary (SMDR + Coherence Shield + agent + qssh)
- Auto-generates keys, connects, opens dashboard at localhost:8080
- "Choose your name. Choose your currency. Done."

**Mobile (iOS/Android):** App store. Lightweight node. Agent as background service.

**Web (zero install):** WASM node in browser. Demo/trial. "Try it now."

### Maps to Existing Devonomics

The agent auto-completes onboarding quests (G001-G005) on behalf of new users. Validator quests (V001-V004) and feature quests (F001-F004) are agent-guided — the operator watches the agent work through them.

---

## Application Integration Layer

The agent doesn't just monitor Docker containers — it operates the full Paraxiom application ecosystem. Each app is a revenue source and a service the agent keeps alive.

### App Map: What the Agent Operates

```
┌─────────────────────────────────────────────────────────────────┐
│                    NODE OPERATOR AGENT                           │
│                                                                 │
│  REVENUE-GENERATING SERVICES (agent keeps alive + monitors)     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐    │
│  │  Coherence   │ │  Notarial    │ │  TAO Signal          │    │
│  │  Shield API  │ │  Service     │ │  (Signals + X402)    │    │
│  │  :3080       │ │  :8000       │ │  :8080 (flask)       │    │
│  │              │ │              │ │                      │    │
│  │  AI audit    │ │  Document    │ │  Dynamic NFTs        │    │
│  │  per-call $  │ │  attestation │ │  Market/AI/Infra     │    │
│  │  X402 + fiat │ │  per-doc $   │ │  subscription $      │    │
│  └──────┬───────┘ └──────┬───────┘ └──────────┬───────────┘    │
│         │                │                     │                │
│  INFRASTRUCTURE (agent self-heals)                              │
│  ┌──────────┐ ┌────────┐ ┌──────────┐ ┌─────────────┐         │
│  │   Node   │ │ Faucet │ │ Operator │ │   KYC API   │         │
│  │  :9944   │ │ :8085  │ │  :9955   │ │   :8200     │         │
│  └──────────┘ └────────┘ └──────────┘ └─────────────┘         │
│  ┌──────────┐ ┌────────────┐ ┌────────┐                       │
│  │ Crypto4A │ │  Dashboard │ │  qsshd │                       │
│  │  QRNG    │ │   :8080    │ │  :2222 │                       │
│  │  :8106   │ └────────────┘ └────────┘                       │
│  └──────────┘                                                  │
│                                                                 │
│  COMMUNICATION (agent monitors + bridges)                       │
│  ┌──────────┐ ┌────────────────┐ ┌───────────┐                │
│  │  Drista  │ │  Mesh Forum    │ │  BitChat  │                │
│  │  PQ chat │ │  (on-chain)    │ │  (iOS/BT) │                │
│  │  Nostr   │◄┤  pallet        │►│  Nostr    │                │
│  └──────────┘ └────────────────┘ └───────────┘                │
│       ↑              ↑                  ↑                      │
│       └──── NIP-01 ↔ Mesh Forum bridge (planned) ────┘        │
└─────────────────────────────────────────────────────────────────┘
```

### Notarial App Integration

**What it is:** PQ-secure document attestation + Ricardian contract management. Three web interfaces (modern, LCARS, simple). IPFS integration via Pinata.

**What the agent does:**
- Keeps notarial web service alive and serving
- Monitors attestation throughput (attestations/hour = revenue)
- Runs Playwright tests through the full 6-phase signing flow
- Monitors IPFS gateway health (Pinata → ipfs.io → cloudflare-ipfs.com fallback)
- Tracks contract lifecycle (Draft → Active → Executed)
- Detects failed attestations and diagnoses cause (gas, network, key)

**Pallets involved:**
- `notarial` (pallet 21): document attestation, witness signatures, certificates
- `ricardian-contracts` (pallet 20): contract creation, party management, multi-sig signing
- `fideicommis` (pallet 22): trust/will management

**Revenue events:** Per-document attestation fee, per-contract creation fee, witness signature fee — all via X402 or Stripe.

**Playwright coverage needed:**
- [ ] Attest a document (upload → hash → submit → verify on-chain)
- [ ] Create a Ricardian contract (title → type → hash → parties)
- [ ] Sign a contract (6-phase signing flow — already partially covered)
- [ ] IPFS upload + encrypted retrieval
- [ ] KYC form submission
- [ ] Cross-validator verification (attest on Alice, verify on Bob)

### TAO Signal Integration

**What it is:** B2B signal API with dynamic NFTs. Streaming data (market, AI, infrastructure) with PQ attestation and X402 micropayments.

**What the agent does:**
- Produces and maintains live signal streams from the node
- Attests every signal update on-chain (PQ-signed mutation chain)
- Processes X402 micropayments for signal subscribers
- Monitors signal data source health (market feeds, chain telemetry, AI outputs)
- Tracks signal subscriber count and revenue per stream
- Auto-creates infrastructure signals from node telemetry:
  - Block time, finalization lag, peer count, memory usage
  - These are sellable as "chain health" signals

**Pallets involved:**
- `oracle` + `oracle-feeds`: price data for QH peg ($0.001)
- `notarial`: attestation of signal state transitions

**Revenue events:** Per-update X402 micropayment, subscription tier monthly (via Stripe), signal marketplace commission.

**Playwright coverage needed:**
- [ ] SIGNALS tab: verify all 4 sub-tabs load (TAO Intelligence, QRNG Pool, QKD Routing, Oracle)
- [ ] Live signal feed updates
- [ ] Signal subscription activation
- [ ] X402 payment header validation

### Drista + Mesh Forum Bridge

**What it is:** PQ-encrypted chat (ML-KEM-1024, STARK ZK proofs) over Nostr + IPFS. Separate from mesh forum (on-chain chat in dashboard).

**What the agent does:**
- Monitors Drista service health (if running on node)
- Bridges Nostr (NIP-01/NIP-17) ↔ Mesh Forum (on-chain pallet)
  - Mesh forum messages forwarded to Drista/Nostr
  - Drista messages optionally posted to mesh forum
- Operator-to-operator encrypted communication channel
- Agent uses Drista for multi-agent coordination (PQ-encrypted, not on-chain)

**Bridge architecture (planned, referenced in start.sh --bridge):**
```
Mesh Forum (on-chain) ←→ Bridge daemon ←→ Nostr relay ←→ Drista clients
                                                        ←→ BitChat (iOS)
```

**Playwright coverage needed:**
- [ ] Dashboard CHAT tab: post message, verify display
- [ ] Message appears in mesh forum RPC query
- [ ] Bridge: message posted via Drista appears in dashboard chat (future)

### BitChat Integration

**What it is:** iOS app (Swift). P2P mesh chat over Bluetooth + Nostr. Offline-capable.

**What the agent does:**
- Not directly — BitChat runs on user's phone
- But the Nostr ↔ Mesh Forum bridge means BitChat messages can reach the on-chain forum
- Agent monitors the bridge daemon health

### KYC API Integration

**What it is:** Identity verification service at :8200. Currently unhealthy on Alice.

**What the agent does:**
- Keeps KYC API healthy (currently unhealthy — same root cause as faucet)
- Processes Tier 1 certification for new operators
- Integrates with Stripe Connect KYC for fiat payouts
- Monitors verification throughput and failure rates
- Auto-triggers when operator clicks "Verify Identity" in dashboard

### Crypto4A QRNG Integration

**What it is:** Hardware quantum random number generator at :8106.

**What the agent does:**
- Monitors QRNG endpoint health
- Uses QRNG for key generation when available (Tier 3+)
- Tests entropy quality periodically (statistical tests)
- Falls back to OS entropy if QRNG unavailable
- Auto-detects QRNG hardware and offers Tier 3 certification upgrade

### Pallet Awareness Map

The agent needs to understand which pallets are involved in each operation:

| Dashboard Section | Pallets | Agent Actions |
|---|---|---|
| STATUS | System, Aura, GRANDPA | Monitor block production, finalization |
| TRANSFER | Balances | Sign + submit transfers, verify balances |
| FAUCET | Balances | Drip tokens, manage gas wallets |
| GOVERN | validator-governance, dev-governance | Present proposals for operator approval (popup) |
| REWARDS | ProofOfCoherence, devonomics | Stake, claim, submit uptime proofs |
| RUNTIME | System (setCode) | Present upgrade for operator approval (popup) |
| KEYS | sphincs-keystore, Session | Rotate keys, manage vault, certification |
| QUANTUM | validator-entropy, qkd-client | Monitor entropy sources, QRNG/QKD health |
| NETWORK | System, Session | Monitor peers, topology, sync |
| SIGNALS | oracle, oracle-feeds, notarial | Produce/maintain signals, process X402 |
| PROOFS | pedersen-commitment | Compute commitments, verify documents |
| QUESTS | devonomics | Auto-complete quests, track tier progression |
| CHAT | mesh-forum | Post health reports, agent status, bridge to Drista |

### Notarial-Specific Pallets

The notarial app interacts with pallets not exposed in the main dashboard:

| Pallet | Index | Agent Role |
|---|---|---|
| `notarial` | 21 | Monitor attestation throughput, detect failures, verify on-chain proofs |
| `ricardian-contracts` | 20 | Track contract lifecycle, monitor signing completeness |
| `fideicommis` | 22 | Monitor trust trigger conditions, alert when claims are due |
| `stablecoin` | 23 | Monitor QCAD vault health ratios, alert on liquidation risk |

### Single Binary — All Apps Included

The `curl | sh` installer produces one binary that includes:
- **SMDR** (ternary model, agent brain)
- **Coherence Shield** (signing + attestation)
- **qssh client + server** (PQ transport)
- **Health monitor** (service watchdog)
- **Playwright runner** (UI automation)
- **X402 middleware** (universal payments)
- **Agent orchestrator** (main loop)

The binary auto-detects what services are running and adapts:
- Node + Dashboard detected → full operator mode
- Notarial app detected → adds attestation monitoring
- TAO Signal detected → adds signal production
- QRNG detected → offers Tier 3 upgrade
- QKD detected → offers Tier 4 upgrade

Services like the notarial web app, TAO Signal flask app, and faucet remain as separate containers — the agent monitors and heals them but doesn't embed them.

---

## Network Upgrade Orchestration (The Hardest Problem)

### What Breaks Today

Every time an upgrade happens, things go out of whack. This is the #1 operational pain point.

**Two types of upgrades:**

| Type | What changes | Downtime | Current method |
|------|-------------|----------|---------------|
| **Runtime upgrade** (WASM) | On-chain logic | ~0 (one block) | Dashboard RUNTIME tab or Polkadot-JS → `sudo.setCode` |
| **Node binary upgrade** (Docker) | Off-chain node software | 30-180 seconds | `check-update.sh` auto-pulls from Docker Hub every 24h |

**What breaks on node binary restart (the cascade):**
```
Node restarts
  → Docker network alias "node" lost (!!!)
  → Faucet: connected: false (can't reach ws://node:9944)
  → KYC API: unhealthy (can't reach node RPC)
  → Operator service: loses RPC connection
  → Dashboard: users see stale data
  → qssh tunnels: drop, operator must reconnect
  → Transaction pool: all pending txs cleared
  → nginx: starts returning 502s to upstream services
```

**Root cause of the cascade:** Docker compose doesn't reliably re-register DNS aliases when a container restarts independently. The `check-update.sh` updater restarts the node container outside of `docker-compose up`, so it lands on the `bridge` network instead of `quantum-net`. All services referencing `node` by hostname lose DNS resolution.

**What breaks on runtime upgrade:**
- Usually nothing at the node level — consensus continues
- But: if spec_version isn't incremented → nodes reject blocks
- If WASM is malformed → chain halts (rollback available for 6 hours / 3600 blocks)
- Dependent pallets may need migration logic

### What Exists Today

**`check-update.sh` (updater daemon):**
- Checks Docker Hub every 24h for new image
- Auto-pulls, restarts node container
- 3-minute health timeout
- Auto-rollback if new image fails health check
- **Problem:** Only monitors the node. Doesn't heal dependent services.

**`validator-monitor.sh`:**
- Checks node process, RPC, block production, peer count every 60s
- Alerts via Discord/Slack webhook
- Auto-restart on crash
- **Problem:** Only monitors, doesn't fix cascading failures.

**Dashboard `upgrade-manager.js`:**
- Auto-selects chunked (>500KB) vs single-shot upload
- 64KB chunks, Blake2-256 per-chunk verification
- Polls for finalization (spec_version change)
- **Problem:** Operator must manually upload WASM + provide secret key.

**Chunked upgrade pallet (`runtime-segmentation`):**
- 3-phase: initiate → upload chunks → finalize
- Max 32 chunks × 64KB = 2MB WASM capacity
- Chunk expiry: 1800 blocks (~3 hours)
- Blake2-256 integrity verification per chunk
- **Runtime backup** stored on-chain (rollback within 6 hours)
- **Problem:** Only handles WASM submission. Doesn't coordinate across network.

### What the Agent Does (Automated Upgrade Orchestration)

#### Runtime Upgrade — Agent-Managed

```
1. NOTIFICATION
   Agent detects upgrade proposal:
   - On-chain governance proposal (Governance popup → operator approves)
   - Or: new WASM published to known registry (IPFS hash pinned on-chain)
   - Or: operator drops WASM file into dashboard RUNTIME tab

2. PRE-FLIGHT (SMDR validates before doing anything)
   Agent checks:
   - [ ] WASM file validates (magic bytes \0asm, version 0x01)
   - [ ] spec_version incremented (critical — will break consensus if not)
   - [ ] File size within bounds (100KB-2MB)
   - [ ] Blake2-256 hash matches expected (if published on-chain)
   - [ ] Current node is synced and healthy
   - [ ] Sufficient QH gas balance for sudo transaction
   - [ ] Signing service has access to sudo key
   → All checks pass? Proceed. Any fail? Alert operator, stop.

3. COORDINATE (gossip via torus)
   Agent announces upgrade intent to torus neighbors:
   - "Upgrade to spec_version N, WASM hash X, starting in 10 blocks"
   - Neighbors acknowledge
   - ROLLING UPGRADE: agents coordinate timing:
     * Wave 1: 1/3 of validators upgrade (torus-distributed selection)
     * Verify: Wave 1 healthy, blocks still producing
     * Wave 2: next 1/3
     * Verify again
     * Wave 3: remaining 1/3
   - If any wave fails: HALT, rollback wave, alert all agents

4. EXECUTE (via signing service)
   Agent submits upgrade through Coherence Shield:
   - SMDR decides: chunked or single-shot based on WASM size
   - Signing service signs with SPHINCS+ sudo key (key never exposed)
   - For chunked: initiate → upload 64KB chunks → finalize
   - Coherence Shield signs+attests the upgrade decision
   - On-chain attestation: "Agent X upgraded to spec_version N at block B"

5. VERIFY (Playwright + RPC)
   Agent confirms upgrade succeeded:
   - [ ] state_getRuntimeVersion() returns new spec_version
   - [ ] Blocks still being produced
   - [ ] Finalization still happening
   - [ ] All local services healthy (faucet, KYC, operator, dashboard)
   - [ ] Playwright clicks through every dashboard section — all working
   - [ ] Peer count stable
   → All pass? Announce success to torus neighbors.
   → Any fail within 6 hours? Trigger rollback (runtime backup on-chain)

6. ROLLBACK (if needed)
   Agent detects upgrade failure:
   - Block production stopped
   - Finalization stalled
   - Critical RPC methods failing
   → Calls chunkedUpgrade rollback_runtime() (restores backed-up WASM)
   → Alerts operator via Telegram
   → Attests rollback on-chain
   → Notifies torus neighbors: "Rollback in progress, halt upgrades"
```

#### Node Binary Upgrade — Agent-Managed

This is harder than runtime upgrades because it requires restarting the actual container.

```
1. DETECTION
   Agent detects new image available:
   - Checks Docker registry digest (same as current check-update.sh)
   - Or: on-chain announcement of new image hash
   - Or: torus gossip — other agents report successful upgrade

2. PRE-FLIGHT
   - [ ] Current node is synced and healthy
   - [ ] All services healthy
   - [ ] No pending governance actions
   - [ ] Backup current image digest (for rollback)
   - [ ] Verify new image hash matches on-chain announcement (prevents supply chain attack)

3. COORDINATE (rolling across network)
   Same wave strategy as runtime upgrades:
   - Never upgrade >1/3 of validators simultaneously
   - Torus-distributed wave selection
   - Each wave verifies before next begins

4. EXECUTE (the critical moment)
   Agent orchestrates the restart:

   a. PREPARE
      - Pull new Docker image (background, while node still running)
      - Pre-warm: verify image starts in isolated test (docker run --rm healthcheck)

   b. STOP + RESTART (minimize downtime)
      - docker stop quantumharmony-node
      - docker rm quantumharmony-node
      - docker run [with CORRECT network: quantum-net, alias: node] ← THIS IS KEY
      - Wait for health (3 minute timeout)

   c. HEAL DEPENDENT SERVICES (the part that's missing today)
      - Wait 10s for node to be fully ready
      - Verify node is on quantum-net with alias "node":
        docker network inspect quantum-net | check for node alias
      - If alias missing: docker network connect --alias node quantum-net quantumharmony-node
      - Restart faucet: docker restart quantumharmony-faucet
      - Restart KYC API: docker restart quantumharmony-kyc-api
      - Wait for each to become healthy
      - Verify faucet: curl /health → connected: true
      - Verify KYC: health endpoint → ok
      - Verify operator: health endpoint → ok
      - Verify dashboard: HTTP 200

   d. FULL VERIFICATION
      - Run complete Playwright test suite:
        STATUS → TRANSFER → FAUCET → CHAT → all sections
      - Every click passes? Upgrade success.
      - Any failure? Diagnose + fix (SMDR reasoning through Coherence Shield)

5. ROLLBACK (if health check fails)
   - Stop new container
   - Restart with old image (saved digest)
   - Heal dependent services (same cascade fix)
   - Alert operator + torus neighbors
   - Attest rollback on-chain

6. POST-UPGRADE
   - Attest success on-chain
   - Report to torus neighbors: "Node X upgraded to image Y, all services healthy"
   - Update local model: record this upgrade as successful training data
   - Prune old Docker images
```

### The Key Insight: Heal After Restart

The single most important thing the agent does during upgrades is **step 4c: heal dependent services**. This is what's missing today. The updater restarts the node but never:
- Checks Docker network aliases
- Restarts dependent services
- Verifies end-to-end functionality

The agent turns a 5-day silent failure (like the faucet incident) into a 30-second self-healing sequence.

### Rolling Upgrade Protocol (Network Scale)

With thousands of nodes, upgrades must be coordinated:

```
Time    Wave 1 (1/3)     Wave 2 (1/3)     Wave 3 (1/3)
─────   ──────────────   ──────────────   ──────────────
t=0     Upgrading...     Running old      Running old
t=30s   Verifying...     Running old      Running old
t=60s   HEALTHY ✓        Upgrading...     Running old
t=90s   Running new      Verifying...     Running old
t=120s  Running new      HEALTHY ✓        Upgrading...
t=150s  Running new      Running new      Verifying...
t=180s  Running new      Running new      HEALTHY ✓
```

**Wave selection:** Agents are assigned to waves by their position in the toroidal mesh. No two adjacent torus neighbors upgrade in the same wave (graph coloring on the torus). This ensures:
- Block production never stops (2/3 of validators always running)
- Finalization continues (supermajority maintained)
- If Wave 1 fails, Waves 2+3 still running old version (safe)

**Consensus requirement:** Before Wave 2 starts, Wave 1 agents must attest on-chain that they're healthy. This is a BFT-compatible upgrade protocol — already proven in `Consensus.lean` (quorum intersection, supermajority → majority).

### Training Data from Upgrades

Every upgrade generates rich training data for SMDR:

```jsonl
{"observation": "node_restarted", "services": {"faucet": "unhealthy", "kyc": "unhealthy"}, "network": {"node_alias": "missing"}}
{"action": "docker_network_connect", "params": {"alias": "node", "network": "quantum-net"}, "result": "success"}
{"action": "docker_restart", "target": "quantumharmony-faucet", "result": "healthy"}
{"action": "docker_restart", "target": "quantumharmony-kyc-api", "result": "healthy"}
{"action": "playwright_full_suite", "result": "all_pass", "duration_ms": 45000}
{"attestation": "upgrade_complete", "block": 4567, "spec_version": 29}
```

Over time, across thousands of nodes and dozens of upgrades, the model learns:
- Which services break in which order
- How long to wait before healing (too early = service not ready, too late = downtime)
- Platform-specific issues (ARM vs x86, different Docker versions, network configs)
- Novel failure modes that the rule engine doesn't cover

---

## Governance: Human in the Loop

### Principle: "Invested" Means Work, Not Money

From the pitch deck: *Proof of Useful Work. Contribution-weighted governance. Can't buy influence — have to run infrastructure.*

Every human action in the network is measurable, on-chain, and compensated. The agent does the routine work. Humans make the decisions that matter and get paid when they show up.

### Three Levels of Human Involvement

```
┌─────────────────────────────────────────────────────────────────┐
│  LEVEL 1: PASSIVE OPERATOR                                      │
│  "I clicked the install link and walk away"                     │
│                                                                 │
│  Human does:  Nothing. Agent runs everything.                   │
│  Agent does:  Self-heal, process attestations, produce signals, │
│               complete Devonomics quests, manage keys.          │
│  Governance:  None. Agent abstains from all votes.              │
│  Revenue:     Base rate × certification tier multiplier.        │
│  Payment:     Automatic. Stripe Connect or X402.                │
│                                                                 │
│  This is the Facebook user. They earn by existing.              │
├─────────────────────────────────────────────────────────────────┤
│  LEVEL 2: ACTIVE OPERATOR                                       │
│  "I check in, approve governance, respond to popups"            │
│                                                                 │
│  Human does:  Approves/denies governance popups.                │
│               Reviews agent decisions in dashboard.             │
│               Votes on proposals. Responds to Telegram alerts.  │
│  Agent does:  Everything from Level 1 + presents governance     │
│               actions for approval. Queues decisions when       │
│               operator is away.                                 │
│  Governance:  Active voter. Weight based on uptime + work.      │
│  Revenue:     Base rate + governance participation bonus.        │
│  Payment:     Automatic + governance reward per vote.           │
│                                                                 │
│  This is the engaged user. They earn more by participating.     │
├─────────────────────────────────────────────────────────────────┤
│  LEVEL 3: CONTRIBUTING OPERATOR                                  │
│  "I build, maintain, debug, improve the network"                │
│                                                                 │
│  Human does:  All of Level 2 + contributes code, reviews        │
│               upgrades, produces custom signals, runs chaos     │
│               tests, submits SMDR training data, operates       │
│               HSM/QRNG/QKD hardware, mentors new operators.    │
│  Agent does:  Tracks contributions, submits attestations for    │
│               each contribution, calculates reward.             │
│  Governance:  Full governance weight. Can propose, not just     │
│               vote. Weight scales with contribution history.    │
│  Revenue:     Base rate + governance bonus + contribution       │
│               rewards + signal producer revenue.                │
│  Payment:     Automatic + per-contribution bounties.            │
│                                                                 │
│  This is the power user. They shape the network.                │
└─────────────────────────────────────────────────────────────────┘
```

### Governance Weight — Proof of Useful Work

You can't buy governance weight. You earn it.

**Weight formula:**
```
governance_weight =
    uptime_score          (0-100, how long your node has been healthy)
  + attestation_volume    (0-100, how many attestations you've processed)
  + signal_reliability    (0-100, uptime of your data streams)
  + vote_participation    (0-100, % of proposals you voted on)
  + contribution_score    (0-100, code/reviews/mentoring/hardware)
  + certification_tier    (0-50,  Tier 0=0, T1=10, T2=20, T3=30, T4=40, T5=50)
```

**Max weight: 550.** All on-chain. All measured by the agent. No subjective scoring.

An operator who runs a Tier 5 node for a year, votes on every proposal, processes millions of attestations, and contributes code has maximum governance influence. An operator who just installed yesterday has almost none. This is meritocratic, not plutocratic.

### What Gets Governed (And What Doesn't)

**Agent decides autonomously (no governance needed):**
- Service restarts, network reconnection, health monitoring
- Key rotation on schedule
- Faucet drips for gas management
- Devonomics quest completion
- Routine attestation processing

**Agent proposes, operator approves (Level 2 popup):**
- Runtime upgrades (WASM deployment)
- Node binary upgrades (Docker image change)
- Key migration between tiers (software → hardware)
- Validator set changes (add/remove validators)
- Staking/unstaking tokens

**Network-wide governance (Level 2-3 vote):**

| Proposal Type | Quorum | Passing | Who Can Propose |
|---|---|---|---|
| Parameter changes (gas price, block time) | 10% of total weight | >50% of voting weight | Level 3 operators |
| Validator set expansion/contraction | 20% | >60% | Level 3 operators |
| Runtime upgrade approval | 30% | >66% (supermajority) | Level 3 operators |
| Emergency actions (chain halt, rollback) | 10% | >75% | Any operator (Level 2+) |
| Protocol amendments (consensus, crypto) | 40% | >75% | Level 3 with >100 contribution_score |
| Treasury allocation | 20% | >50% | Level 3 operators |

**Not governed (hardcoded, never changes):**
- Post-quantum cryptography (always PQ, never downgrade)
- Token price peg mechanism ($0.001)
- Key enclave requirements (signing service isolation)
- Audit chain integrity (hash chain, never skip)

### Incentive & Reward Structure

**Every measurable action has a payment attached.** Humans who do the work get paid.

#### Passive Revenue (Agent-Earned, All Levels)

| Revenue Source | How It Works | Who Gets Paid |
|---|---|---|
| Attestation processing | X402 per-call fee from customers using your node | Node operator (automatic) |
| Signal subscriptions | Monthly or per-update from signal subscribers | Signal producer operator |
| Coherence Shield API | Per-call AI inference + attestation fee | Node running Shield |
| RPC endpoint access | Premium RPC with SLA, per-call X402 | Node operator |
| QRNG entropy | Per-byte quantum randomness fee | Nodes with QRNG hardware |
| Storage SLA | Data availability guarantees | High-uptime operators |

#### Active Participation Rewards (Level 2)

| Action | Reward | Frequency |
|---|---|---|
| Vote on governance proposal | 10 QMHY + share of governance pool | Per vote |
| Approve agent upgrade action | 5 QMHY | Per approval |
| Respond to alert within 1 hour | 20 QMHY | Per incident |
| Maintain >99.9% uptime for 30 days | 500 QMHY + SLA bonus tier | Monthly |
| Complete all Devonomics quests in tier | Tier reward (250-1200 QMHY) | One-time per tier |

**Governance pool:** A percentage of network gas fees flows to the governance pool. Distributed proportionally to voting weight × participation rate. Active voters earn from the pool. Passive operators don't.

#### Contribution Rewards (Level 3)

| Contribution | Reward | Verification |
|---|---|---|
| Submit merged code PR | 100-1000 QMHY (based on complexity) | GitHub PR attestation on-chain |
| Review + approve runtime upgrade | 200 QMHY | On-chain vote + review attestation |
| Produce a new signal type | Revenue share (perpetual, as long as signal has subscribers) | Signal creation attestation |
| Submit SMDR training data | 10 QMHY per accepted batch | On-chain data hash, quality check |
| Operate HSM/QRNG hardware | Tier 3-5 revenue multiplier (permanent bonus) | Agent hardware detection |
| Operate QKD link | Tier 4-5 multiplier + QKD revenue | Agent QKD detection |
| Mentor new operator (referral) | 5% of invitee revenue (90 days) | On-chain referral bond |
| Run chaos test on testnet | 50 QMHY per test session | Attestation of test results |
| Write/update documentation | 50 QMHY per accepted update | On-chain attestation |

### Payment Rails for All Rewards

**Every reward settles in the operator's chosen currency:**

```
Action → On-chain attestation (QMHY gas burned) → Reward calculated
  ↓
Operator preference:
  ├─ Fiat (Stripe Connect): CAD/USD/EUR deposited monthly
  ├─ Stablecoin (X402): USDC settled per-action or batched
  ├─ Crypto (X402): BTC/ETH/TAO settled per-action
  └─ QMHY: Keep as gas credits (auto-converts at $0.001)
```

The operator sets their preference once ("Pay me in CAD"). Everything else is automatic. The agent processes attestations, the network calculates rewards, Stripe or X402 handles settlement.

### The Agent's Role in Governance

The agent is **not a voter.** It is a facilitator.

**What the agent does:**
- Presents governance proposals to the operator (dashboard popup + Telegram)
- Provides analysis: "This runtime upgrade changes 3 pallets, adds 12KB to WASM, spec_version 28→29. 47 other operators have approved."
- Shows risk assessment (via SMDR): "Low risk. Similar upgrade succeeded on testnet. No breaking changes to pallets you use."
- Records the operator's vote on-chain
- Tracks governance participation rate (affects weight + rewards)
- Reminds operator of pending proposals ("3 proposals expiring in 24h — vote to earn 30 QMHY")

**What the agent NEVER does:**
- Vote on behalf of the operator (even if the operator is away)
- Delegate governance weight
- Propose network changes without operator approval
- Override an operator's vote

### Governance Dashboard Integration

The GOVERN section of the dashboard becomes the agent's governance interface:

```
┌─────────────────────────────────────────────────────────────┐
│  GOVERNANCE                                    Weight: 342  │
│                                                             │
│  YOUR LEVEL: Active Operator (Level 2)                      │
│  Participation rate: 87% (voted 26/30 proposals)            │
│  Governance earnings this month: 260 QMHY ($0.26 CAD)      │
│                                                             │
│  ┌─ ACTIVE PROPOSALS ──────────────────────────────────┐    │
│  │                                                     │    │
│  │  #47 Runtime Upgrade v29                            │    │
│  │  Proposed by: Alice (contribution_score: 450)       │    │
│  │  Type: Runtime upgrade (requires 66% supermajority) │    │
│  │  Status: 234/500 weight voted (47%), 89% approve    │    │
│  │  Expires: 48 blocks (~5 min)                        │    │
│  │  Agent analysis: "Low risk. 3 pallet changes..."    │    │
│  │                                                     │    │
│  │  [APPROVE]  [DENY]  [ABSTAIN]   Reward: 10 QMHY    │    │
│  │                                                     │    │
│  │  #46 Add validator: 5Gx7a...                        │    │
│  │  Proposed by: Bob (contribution_score: 380)         │    │
│  │  Status: 180/400 weight voted (45%), 72% approve    │    │
│  │  [APPROVE]  [DENY]  [ABSTAIN]   Reward: 10 QMHY    │    │
│  │                                                     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─ YOUR GOVERNANCE WEIGHT BREAKDOWN ──────────────────┐    │
│  │  Uptime:        92/100  (11 months continuous)      │    │
│  │  Attestations:  78/100  (1.2M processed)            │    │
│  │  Signals:       65/100  (3 streams, 99.1% uptime)   │    │
│  │  Participation: 87/100  (26/30 proposals voted)     │    │
│  │  Contributions:  0/100  (no code/reviews yet)       │    │
│  │  Certification: 20/50   (Tier 2: Hardware)          │    │
│  │  ─────────────────────────────────────────          │    │
│  │  TOTAL:        342/550                              │    │
│  │                                                     │    │
│  │  "Contribute code or reviews to earn up to 100      │    │
│  │   more governance weight." [LEARN HOW]              │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─ EARNINGS ──────────────────────────────────────────┐    │
│  │  This month:                                        │    │
│  │    Attestation revenue:     $42.30 CAD              │    │
│  │    Signal subscriptions:    $18.50 CAD              │    │
│  │    Governance participation: $0.26 CAD              │    │
│  │    Uptime SLA bonus:        $5.00 CAD               │    │
│  │    ────────────────────────────────                 │    │
│  │    TOTAL:                   $66.06 CAD              │    │
│  │    Next payout: Feb 28 via Stripe Connect           │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Governance Telegram Bot

For Level 2+ operators who aren't always watching the dashboard:

```
🗳 New Proposal #47: Runtime Upgrade v29
Proposed by: Alice (weight: 450)
Type: Runtime upgrade (66% supermajority required)
Current: 47% voted, 89% approve
Expires in: ~5 minutes

Agent analysis: Low risk. 3 pallet changes. Tested on testnet.
Similar upgrade succeeded on 12 other nodes.

Reply: 1️⃣ Approve  2️⃣ Deny  3️⃣ Abstain
Reward: 10 QMHY ($0.01)
```

Operator replies "1" → agent submits vote on-chain → attestation recorded → reward earned.

### Anti-Gaming

- **Sybil resistance:** Governance weight requires real uptime + real attestation processing. Running 100 idle nodes earns near-zero weight.
- **No delegation:** Weight is personal. Can't transfer, delegate, or pool governance influence.
- **Time-weighted:** New nodes start with near-zero weight. Weight accumulates over months of real work.
- **Contribution verification:** Code PRs verified via GitHub attestation on-chain. Can't fake merged code.
- **Cooldown on new proposals:** After proposing, must wait N blocks before proposing again. Prevents spam.
- **Slash for downtime during governance:** If you vote on proposals but your node is down during the voting period, vote doesn't count. Must be healthy to govern.

---

## Open Questions (Remaining)

### Q1: Stripe integration specifics
- Stripe Connect Standard or Express? (Express = simpler onboarding for operators)
- Product catalog: how to model attestation credits, signal subs, API plans?
- Who is the Stripe account holder — Paraxiom (platform) with Connect payouts to operators?

### Q2: Signal pricing model
- Fixed tiers (Basic/Pro/Enterprise) or marketplace (producers set prices)?
- Per-update X402 micropayments — minimum viable payment?
- Revenue split between signal producer (node operator) and Paraxiom?

### Q3: Enterprise gas wallet management
- Auto-purchase QH tokens when low? Or require manual top-up?
- Credit line model? (enterprise uses first, pays monthly invoice)
- How does the $0.001 fixed price actually get enforced on-chain?

### Q4: Operator onboarding flow
- `qssh-node setup` one-liner → generates keys → connects to network → starts earning?
- How does Stripe Connect onboarding integrate with node setup?
- KYC for operators? (Stripe requires it for Connect payouts)

---

## References

| Component | Path | Status |
|-----------|------|--------|
| Coherence Shield | `/Users/sylvaincormier/paraxiom/coherence-shield/` | 35 tests, 102 Lean theorems |
| SMDR | `/Users/sylvaincormier/paraxiom/smdr/` | Ternary weights, Tonnetz topology |
| qssh | `/Users/sylvaincormier/paraxiom/paraxiom-qssh/` | 89 tests, 67 Lean theorems |
| Dashboard | `/Users/sylvaincormier/paraxiom/quantum-harmony-node/dashboard/` | ~7,500 lines |
| Notarial tests | `/Users/sylvaincormier/paraxiom/quantumharmony-notarial/` | 4 Playwright files |
| Docker compose | `/Users/sylvaincormier/paraxiom/quantum-harmony-node/docker-compose.yml` | 7 services |
| TAO Signal | `/Users/sylvaincormier/paraxiom/tao-signal-agent/` | 100 Lean theorems |
| Drista | `/Users/sylvaincormier/paraxiom/drista/` | 76 tests, 100 Lean theorems |
| OpenClaw (inspiration) | `github.com/openclaw/openclaw` | MIT, 215K stars |
| Data-Centric Pitch | Alice: `paraxiom.org/quantum-coherence.html` | Feb 18, 2026 |
