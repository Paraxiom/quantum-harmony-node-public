# Devonomics: Gamified Validator Onboarding

**Version:** 1.0
**Status:** Design Document
**Date:** 2026-01-22

---

## Overview

Devonomics is a gamified onboarding and engagement system for QuantumHarmony validators. It rewards operators with QMHY tokens for completing setup tasks and proving feature functionality.

### Goals

1. **Zero-friction onboarding** - No manual faucet requests
2. **Feature verification** - Operators prove features work by using them
3. **Network growth** - Incentivize complete, tested validator setups
4. **Engagement** - Ongoing rewards for network participation

---

## Quest System

### Tier 1: Genesis Quests (One-time)

| Quest ID | Name | Trigger | Reward | Verification |
|----------|------|---------|--------|--------------|
| G001 | **Genesis** | Node syncs to network | 100 QMHY | `system_health` returns synced |
| G002 | **Identity** | Session keys generated | 50 QMHY | `author_hasSessionKeys` returns true |
| G003 | **Registered** | Account created | 25 QMHY | Account exists on-chain |
| G004 | **Connected** | 3+ peers connected | 50 QMHY | `system_peers` >= 3 |
| G005 | **Voice** | First forum post | 25 QMHY | `forum_getMessages` includes sender |

**Total Tier 1:** 250 QMHY

### Tier 2: Validator Quests (One-time)

| Quest ID | Name | Trigger | Reward | Verification |
|----------|------|---------|--------|--------------|
| V001 | **Candidate** | Added to validator set | 100 QMHY | In `validators()` list |
| V002 | **Producer** | First block authored | 200 QMHY | Block has validator signature |
| V003 | **Finalizer** | Block finalized | 100 QMHY | GRANDPA finality proof |
| V004 | **Uptime** | 24h continuous operation | 150 QMHY | No missed blocks in window |

**Total Tier 2:** 550 QMHY

### Tier 3: Feature Quests (One-time)

| Quest ID | Name | Trigger | Reward | Verification |
|----------|------|---------|--------|--------------|
| F001 | **Quantum** | Use QRNG entropy | 100 QMHY | Crypto4A entropy fetched (DOM or localStorage) |
| F002 | **Notary** | Compute document hash | 75 QMHY | `proofDocHash` element populated |
| F003 | **Governor** | Vote on proposal | 50 QMHY | `devonomics_voted` localStorage flag |
| F004 | **Transfer** | Send tokens | 25 QMHY | `system_accountNextIndex` nonce > 0 |

**Total Tier 3:** 250 QMHY

### Tier 4: Ongoing Rewards (Recurring)

| Quest ID | Name | Trigger | Reward | Frequency |
|----------|------|---------|--------|-----------|
| R001 | **Daily Active** | Any on-chain activity | 10 QMHY | Daily cap |
| R002 | **Block Reward** | Author a block | 5 QMHY | Per block |
| R003 | **Forum Active** | Post to forum | 2 QMHY | Per post (max 10/day) |
| R004 | **Attestation** | Process attestation | 10 QMHY | Per attestation |

---

## Implementation Architecture

### Option A: Pallet-Based (Recommended)

```
pallet-devonomics/
├── src/
│   ├── lib.rs           # Main pallet logic
│   ├── quests.rs        # Quest definitions
│   ├── rewards.rs       # Reward distribution
│   └── verification.rs  # Proof verification
├── Cargo.toml
└── README.md
```

**Pros:**
- Fully on-chain, transparent
- Rewards are trustless
- Integrated with runtime

**Cons:**
- Requires runtime upgrade
- More complex to modify

### Option B: Off-Chain Worker + Oracle

```
devonomics-oracle/
├── src/
│   ├── main.rs          # Oracle service
│   ├── monitors.rs      # Event monitors
│   └── rewards.rs       # Reward submission
└── Cargo.toml
```

**Pros:**
- No runtime upgrade needed
- Easier to iterate
- Can monitor external events

**Cons:**
- Requires trusted oracle
- Centralized reward distribution

### Option C: Hybrid (Recommended for MVP)

- **On-chain:** Quest registry, reward claims
- **Off-chain:** Event monitoring, proof collection
- **Dashboard:** Progress visualization

---

## Technical Specification

### Quest Registry (On-Chain Storage)

```rust
#[pallet::storage]
pub type QuestDefinitions<T> = StorageMap<
    _,
    Blake2_128Concat,
    QuestId,
    QuestInfo,
>;

#[pallet::storage]
pub type OperatorProgress<T: Config> = StorageDoubleMap<
    _,
    Blake2_128Concat,
    T::AccountId,      // Operator
    Blake2_128Concat,
    QuestId,           // Quest
    QuestStatus,       // Completed/Pending/Claimed
>;

#[pallet::storage]
pub type Leaderboard<T: Config> = StorageMap<
    _,
    Blake2_128Concat,
    T::AccountId,
    LeaderboardEntry,
>;
```

### Quest Completion Flow

```
1. Operator performs action (e.g., posts to forum)
         │
         ▼
2. Event emitted: ForumPostCreated { sender, content }
         │
         ▼
3. Devonomics pallet receives event hook
         │
         ▼
4. Check: Has operator completed quest F001?
         │
    ┌────┴────┐
    │ No      │ Yes
    ▼         ▼
5. Mark      Skip
   complete
         │
         ▼
6. Emit: QuestCompleted { operator, quest_id, reward }
         │
         ▼
7. Auto-transfer reward OR operator claims manually
```

### Dashboard Integration

The Node Operator dashboard will show:

```
┌─────────────────────────────────────────────┐
│  DEVONOMICS                    Score: 450   │
├─────────────────────────────────────────────┤
│                                             │
│  ✓ Genesis          100 QMHY    [CLAIMED]   │
│  ✓ Identity          50 QMHY    [CLAIMED]   │
│  ✓ Connected         50 QMHY    [CLAIMED]   │
│  ○ Voice             25 QMHY    [POST NOW]  │
│  ○ Producer         200 QMHY    [PENDING]   │
│  ○ Quantum          100 QMHY    [LOCKED]    │
│                                             │
│  Progress: ████████░░░░ 45%                 │
│                                             │
│  [VIEW LEADERBOARD]  [CLAIM ALL]            │
│                                             │
└─────────────────────────────────────────────┘
```

---

## Auto-Airdrop on Node Start

### Mechanism

When a new node starts and syncs:

1. **Node registers with network** via `system_localPeerId`
2. **First sync complete** triggers genesis quest
3. **Auto-account creation** (optional):
   - Node generates keypair on first start
   - Submits registration extrinsic
   - Receives genesis airdrop

### Implementation

```rust
// In node startup (service.rs)
async fn on_sync_complete(client: &Client) {
    // Check if this is first sync (no local quest data)
    if !quest_storage_exists() {
        // Auto-register for devonomics
        let account = get_or_create_operator_account();
        submit_genesis_claim(account).await;
    }
}
```

### Security Considerations

- **Sybil resistance:** Limit one genesis reward per unique node key
- **Rate limiting:** Cooldown between quest completions
- **Verification:** On-chain proof required for each quest
- **Caps:** Daily/weekly reward caps to prevent abuse

---

## Leaderboard

### On-Chain Leaderboard

```rust
pub struct LeaderboardEntry {
    pub account: AccountId,
    pub total_score: u128,
    pub quests_completed: u32,
    pub tier: ValidatorTier,
    pub joined_block: BlockNumber,
}
```

### Tiers

| Tier | Score Required | Benefits |
|------|----------------|----------|
| Bronze | 0-249 | Basic validator |
| Silver | 250-549 | Priority in validator selection |
| Gold | 550-999 | Governance weight bonus |
| Platinum | 1000+ | Featured on network dashboard |

---

## Rollout Plan

### Phase 1: MVP (Week 1)
- [x] Document system (this file)
- [x] Add DEVONOMICS tab to dashboard
- [x] Manual quest tracking (off-chain)
- [x] Faucet auto-drip on account creation

### Phase 2: Basic Automation (Week 2)
- [x] Event monitoring for quest completion (RPC-based checks for all 14 quests)
- [x] Auto-reward distribution via sudo (localStorage score tracking)
- [x] Leaderboard display (live validator data from chain)
- [x] Tier unlock logic (Tier 1 → Tier 2 → Tier 3 gating)
- [x] Uptime tracker auto-start on page load

### Phase 3: Full On-Chain (Week 3-4)
- [ ] `pallet-devonomics` implementation
- [ ] Runtime upgrade
- [ ] Remove manual/sudo dependencies

### Phase 4: Advanced Features (Future)
- [x] Tier 4 ongoing rewards (R001–R004 recurring quests)
- [ ] NFT badges for achievements
- [ ] Referral rewards
- [ ] Seasonal quests
- [ ] Team competitions

---

## Token Economics

### Initial Supply Allocation

| Purpose | Allocation | Notes |
|---------|------------|-------|
| Devonomics Rewards Pool | 10% | For quest rewards |
| Validator Rewards | 30% | Block production |
| Treasury | 20% | Governance controlled |
| Team | 15% | Vested over 2 years |
| Community | 25% | Airdrops, grants |

### Reward Sustainability

- **Diminishing rewards:** Early completers get full rewards
- **Halving schedule:** Quest rewards halve every 6 months
- **Cap:** Maximum 1000 QMHY per operator from quests

---

## API Reference

### RPC Methods

```
devonomics_getQuests() -> Vec<QuestInfo>
devonomics_getProgress(account) -> Vec<QuestProgress>
devonomics_getLeaderboard(limit) -> Vec<LeaderboardEntry>
devonomics_claimReward(quest_id) -> TxHash
```

### Events

```
QuestCompleted { operator, quest_id, reward }
RewardClaimed { operator, quest_id, amount }
TierAdvanced { operator, old_tier, new_tier }
```

---

## Success Metrics

1. **Onboarding completion rate:** % of new operators completing Tier 1
2. **Feature adoption:** % of operators completing each feature quest
3. **Retention:** Operators active after 7/30/90 days
4. **Network growth:** New validators per week

---

## Appendix: Quest Verification Methods

### G001 Genesis - Node Synced
```javascript
const health = await rpc('system_health');
return health.isSyncing === false && health.peers >= 1;
```

### G002 Identity - Keys Generated
```javascript
const keys = await rpc('author_hasSessionKeys', [sessionKeys]);
return keys === true;
```

### G005 Voice - Forum Post
```javascript
const messages = await rpc('forum_getMessages', [100, 0]);
return messages.some(m => m.sender === operatorAccount);
```

### V002 Producer - Block Authored
```javascript
// Check block author matches operator
const header = await rpc('chain_getHeader', [blockHash]);
// Verify AURA seal has operator's signature
```

---

*"The game begins when your node syncs."*
