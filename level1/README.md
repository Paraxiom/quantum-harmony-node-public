# Host a copy of the registry (level 1 node)

Version française : [LISEZMOI.md](LISEZMOI.md)

A level 1 node is a complete copy of the QuantumHarmony public registry on your own machine, on your own network. It verifies every new block it receives. It signs nothing, holds no validator key, earns nothing, and costs nothing beyond the machine. Its purpose is that the registry is not kept by one party. `verify.sh` compares your last finalized block with the public gateway's.

## What you need

- One machine, physical or virtual, **x86_64 (amd64)**: 4 vCPU, 8 GB RAM, SSD. The node image is built for amd64 only; on an Apple Silicon Mac or another ARM machine it would run under emulation, which has not been tested.
- Disk: the chain was about 116 GB on 2 October 2026 and grows about 1.3 GB a day; plan 500 GB. The first install needs about 240 GB free at once with the 30 September snapshot (the download, then its extraction), and more with later snapshots. On Docker Desktop, raise the disk usage limit first (Settings > Resources); the default is 64 GB.
- The download is the signed snapshot, about 116 GB for the 30 September one: hours on a home connection. If it stops, run `./join.sh` again and it resumes.
- Linux with Docker and Docker Compose v2 (`docker compose version`). Also `curl`, `gpg`, `python3`.
- On Windows, use a Linux virtual machine (Hyper-V, VMware or a cloud provider). WSL2 with Docker Desktop should also work, but it has not been tested yet.
- Outbound TCP to port 30333 of the three validators (51.79.26.123, 51.79.26.168, 209.38.225.4). No inbound port. No firewall change.
- About 2 h 15 in all, measured on a test machine on a home connection on 12 October 2026: 1 h 04 to download the snapshot, 31 min to check it against the signed checksum, 38 min to extract it. Most of it runs on its own.

## Steps

```bash
git clone https://github.com/Paraxiom/quantum-harmony-node-public.git
cd quantum-harmony-node-public/level1
NODE_NAME=your-institution ./join.sh      # chainspec, signed snapshot, start
./verify.sh --status                       # a few minutes later
```

`join.sh` fetches the chainspec and checks its sha256 and its chain id, fetches Paraxiom's signing key and checks its fingerprint, downloads the snapshot and verifies its GPG signature and sha256, puts it in a Docker volume, starts the node, and then checks the genesis block your node actually built. That last check matters: a matching file hash only proves the bytes are the ones we expected, not that they build the network you meant to join. `verify.sh` checks genesis first, then takes your node's last finalized block and asks the public gateway for its hash at the same height. `MATCH` means your copy agrees with the network. `DIVERGENCE` means it does not at that height, and that is a finding: keep the data and write to us. `WRONG CHAIN` means your node is not on this network at all, usually a stale chainspec; re-run `join.sh` and tell us if it persists.

After a reboot or an image update: `./join.sh --start`.

## Use the registry: check a document

Once your node is up to date:

```sh
./verifier.sh
```

The "Vérifier un document" page opens in your browser. Drop a file: its fingerprint is computed on your machine, the file goes nowhere, and your own node answers whether it was recorded, by which account, and when.

To try it: drop `verifier/exemples/proces-verbal-exemple.txt`, recorded by Paraxiom (demonstration). The page says "Inscrit". Then drop `proces-verbal-exemple-modifie.txt`, where one amount differs: "Aucune inscription pour ce fichier exact". The registry keeps each document's fingerprint, with a short label, not the document itself.

Recording your own documents would be done with the reporter, a tool in development.

## What the node does and does not do

- It keeps a full copy and verifies SPHINCS+ block seals and SPHINCS+ finality votes. The Falcon-512 signatures on entries are stored, not verified.
- It does not produce blocks, does not vote, has no validator key and no account. There is nothing to steal on it.
- Its RPC answers on 127.0.0.1:9944 only, safe methods only. Nothing is exposed to the internet.
- The registry carries fingerprints of documents with a short label, not the documents. No personal data is recorded in it today, but the label is free text: the chain does not enforce it.
- It sends no telemetry.

## Honest state of the network, October 2026

Test network. Three validators, all operated by Paraxiom. Runtime version 51 has been live since 9 October. A finality correction was deployed on 22 September and has not yet been independently tested. A new node cannot yet synchronize from the genesis block, which is why you start from a signed snapshot. Validator to validator transport is classical today; the post quantum relay is not yet in service. Six chain divergences occurred in 2026, each diagnosed. None of this changes what a level 1 node is: a verified copy, and a witness.

## Level 2, later

A validator seat (co-signing blocks and finality) could be offered by cohort, once validator registration is fully gated by the runtime and the fourth validator has run for a quarter. Holding a level 1 node would be the precondition.

## Stop, update, remove

```bash
docker compose -f docker-compose.yml down          # stop
docker compose -f docker-compose.yml pull && ./join.sh --start   # update the image
docker volume rm level1_qh-level1-data             # remove the data (irreversible)
```

## Contact

Sylvain Cormier, Paraxiom Technologies inc., sylvain@paraxiom.org, 514 804-8434.
Public read gateway used by `verify.sh`: https://validateurs.paraxiom.org/rpc.
