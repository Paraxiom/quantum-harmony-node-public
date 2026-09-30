# Level 1 release checklist

## 0. ✅ DONE 2026-09-30 — the correct chainspec is published

Served at `https://paraxiom.org/chainspec.json` and `https://validateurs.paraxiom.org/join/quantumharmony-chainspec.json`, sha256 `4f468f15…`. Verified before publishing: its `genesis` section is identical to the chainspec the live Carleton node runs on (genesis `0x67a63ee1…`), and its three bootnode ids match `system_localPeerId` on Alice and Bob and Alice's view of Charlie. The previous file is kept on Alice as `/var/www/paraxiom-public/chainspec.json.bak-2026-09-30-v37`. What follows is the record of the problem.

### (history) PUBLISH THE CORRECT CHAINSPEC

**Measured 2026-09-26.** The file served at `https://paraxiom.org/chainspec.json` is the wrong
chain. It is an older spec named "QuantumHarmony PQBFT Network v37", sha256 `a7e699e6…`, and a node
started from it builds genesis:

```
published chainspec  0x842a1ed2e2cd10e984ce8df8a8ba7cb33da272bdbc990c60b709157d0f6ca7ff
live network         0x67a63ee15ecd67f1bcf8437b31800ddd76274db3f06fe6b0c3cf0a9235604008
```

**A host who runs `join.sh` today can never peer with the fleet**, however good the snapshot and
the image are. It also carries a stale Charlie bootnode (`12D3KooWHHix…`) and a stale Alice
bootnode (`12D3KooWD3EP…`).

The correct file is already on disk:

```
~/paraxiom/qh-transparence/web/validateurs/join/quantumharmony-chainspec.json
sha256  4f468f152ff4a0e33fa8322ac7cfc6b69a7d527c438d69faa0d440f65630e271
name    QuantumHarmony PQBFT v45 (recovery 2026-07-03)
id      dev3        protocolId  quantumharmony
genesis 0x67a63ee1…  (verified by starting a node on it)
bootNodes  Alice 12D3KooWMRy2…   Bob 12D3KooWBu3Y…   Charlie 12D3KooWSCuf…   (all three correct)
```

**Action: serve that file at `https://paraxiom.org/chainspec.json`.** `join.sh` already pins
`4f468f15…`, so it will keep refusing to run until this is done — which is the intended behaviour,
not a bug. Do not change the pin back.

⚠️ There are at least five mutually incompatible chainspecs on disk, each building a different
genesis (`0x842a1ed2…`, `0x79afca55…`, `0x8b8de379…`, `0xc18cc638…`, and the correct
`0x67a63ee1…`). Verify by genesis hash, never by filename.

# Level 1 kit: what must be published before a host gets the link

Written 2026-09-25. The kit (`docker-compose.yml`, `join.sh`, `verify.sh`, the two runbooks) is complete on paper and blocked on four release artefacts that only the chain operations side can produce. Verified against the live network on 2026-09-25 through the public gateway (`system_version` = `0.1.0-87e178d`, `specVersion` 45).

| # | Item | Why | State 2026-09-25 |
|---|---|---|---|
| 1 | **Publish the validators' image** to Docker Hub as `sylvaincormier/quantumharmony-node:v45-doorfix-87e178d` (the build the three validators run) | `docker-compose.yml` pins that tag; a host must run what the validators run | **Done 2026-09-30** (18:01Z, digest `6d8d2c74…`). Binary reports `0.1.0-unknown` (no `.git` in the build context); code is 87e178d. |
| 2 | **Publish a signed snapshot** at `https://paraxiom.org/snapshots/level1-latest.tar.gz` with `.sha256` and a detached `.asc` signature | No sync from genesis; the snapshot is the only way in. `join.sh` verifies signature and sha256 before extracting | `https://paraxiom.org/snapshots/chaindata-latest.tar.gz` returns 404. Nothing published. |
| 3 | **Snapshot layout and signing key** | `join.sh` extracts into `/data/chains/<chainspec id>/` (id is read from the chainspec, today `dev3`); the archive must contain the `db` directory of a paritydb full node, taken with the node stopped and all Alice automations disarmed (prune cron, qh-watchdog, quantumharmony-agent). Sign with the Paraxiom APT key `F138C1E15C0C364B0F94155A3191BE373AA98E2F` (public at paraxiom.github.io/apt/paraxiom.gpg) or publish a dedicated release key and update `join.sh`. | The old `start.sh` extracted to `/data/chains/quantumharmony_prod`, which no longer matches the served chainspec id. |
| 4 | **Fix Charlie's bootnode peer id** in the served chainspec and in `docker-compose.operator.yml` | Both carry `12D3KooWHHix…`; the id observed live from Alice on 2026-09-25 is `12D3KooWSCufgHzV4fCwRijfH2k3abrpAJxTKxEvN1FDuRXA2U9x`. Alice: the compose file says `12D3KooWFZUz…`, the served chainspec and the README say `12D3KooWD3EP…`; the kit uses the chainspec's. | Kit uses the observed ids; confirm from Charlie's own log line "Local node identity is". |
| 5 | **Chainspec sha256** | `join.sh` pins `a7e699e6a8295a45a0a8eb55a6527d4ca6784e8b4d9205d738f08c1263c49ac4` (served 2026-09-25). `start.sh` still pins `dc35f7…` and therefore rejects the served file. Update `start.sh` or retire it. | Mismatch present today. |
| 6 | **One install by a stranger** from the runbook alone, before any institution is asked | The kit's only test that counts | Candidates: Frédéric Viel (SPGQ), a Carleton student, Edwin Afful. |

Not blocking, to fix in the same pass: full nodes finalize unverified gossip (P1 of the 2026-09-15 code reading); acceptable for a copy, not for a node anyone relies on for verification claims.

Do not run any of the above from this laptop against Alice. Chain operations go through `qh-op --confirm` by the session that owns the chain.
