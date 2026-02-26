# QuantumHarmony Testnet

## Operator Participation Guidelines (Non-Legal)

**Status:** Production Testnet (Alpha)
**Scope:** Infrastructure validation only — no economic finality

These guidelines define expectations for operators participating in the QuantumHarmony production testnet. This is not a legal contract, but a shared understanding to ensure the testnet remains stable, credible, and useful for research and engineering.

---

## 1. Purpose of the Testnet

The QuantumHarmony testnet exists to validate:

- Long-running validator infrastructure
- Post-quantum cryptographic primitives (SPHINCS+)
- Experimental coherence-based validator selection
- Operational behavior under realistic network conditions

There are no tokens, rewards, or economic guarantees at this stage.

---

## 2. Operator Expectations

By running a node, operators agree to:

- Run the node continuously (best effort uptime)
- Monitor logs and basic health metrics
- Apply upgrades when announced
- Report bugs, failures, or unexpected behavior honestly
- Avoid modifying consensus-critical code without coordination
- Treat this as engineering infrastructure, not a marketing or investment opportunity

Operators remain fully autonomous and may leave the testnet at any time.

---

## 3. What Data Is Collected

The project intentionally collects minimal, non-personal data.

**Collected:**

- Validator public keys
- Node peer IDs
- Block production and participation metrics
- Uptime / liveness signals
- Consensus-level events (missed blocks, equivocations, etc.)
- Software version and protocol compatibility

**Not collected:**

- Personal identity information
- Wallet balances
- IP addresses (beyond what the P2P protocol inherently exposes)
- Off-chain system telemetry
- Private keys or secrets

All data collected is used solely for protocol evaluation, debugging, and research analysis.

---

## 4. Communications

- Coordination occurs via GitHub issues and a small private operator channel
- No obligation to participate in public discussions
- No marketing or promotion expected or requested

---

## 5. Testnet Lifecycle & Freeze

Operator recruitment is intentionally limited.

The testnet will be considered frozen when:

- 3–5 independent operators are active
- The network has run stably for a sustained period
- Sufficient operational data has been collected

After freeze:

- No new operators are added
- Focus shifts to analysis, documentation, and next-phase design

---

## 6. Mainnet Recognition (Non-Binding)

While this testnet has no economic rewards, early operators may be eligible for recognition in a future mainnet, subject to:

- Demonstrated uptime and participation
- Adherence to these guidelines
- Contribution quality (issues, fixes, operational feedback)

Any future mainnet token allocation, if it exists, would be:

- Discretionary, not automatic
- Based on documented testnet participation
- Defined only at mainnet design time

**There is no promise, guarantee, or obligation of future compensation.**

---

## 7. Independence & IP

- Operators retain full ownership of their infrastructure
- Running a node does not transfer IP, rights, or exclusivity
- All protocol code is open source under its stated license

---

## 8. Spirit of Participation

This testnet is built on:

- Technical honesty
- Mutual respect
- Low ego, high signal
- Shared curiosity

If this aligns with how you operate, you're welcome here.

---

**Contact:**
Sylvain Cormier
Paraxiom Research
sylvain@paraxiom.org
