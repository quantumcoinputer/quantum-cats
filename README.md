# Quantum Cats

A 10,000-supply ERC-721 collection on Robinhood Chain in which every trait of
every token, including the fringe pattern of its background, derives from a
measurement of a 38-qubit circuit executed on IBM Quantum hardware. Art and
metadata are generated entirely on-chain. Verification requires an RPC
endpoint and the hash-bound public archive.

[ARCHITECTURE.md](ARCHITECTURE.md) contains the complete technical
description: circuit, derivation rule, contracts, receipt, oracle,
verification, trust model, and evidence. [CHANGELOG.md](CHANGELOG.md) records
the mechanism's evolution through five external review rounds.

## The mechanism in one paragraph

Minting transfers 100,000 units of a configured ERC20 to the `0xdEaD` sink
address. Every 30 minutes the oracle seals all pending mints into one
contiguous batch on-chain before any job exists, fixing each token's shot
assignment and the circuit's identity hash. It then submits a single
38-qubit job (25 trait qubits, a 5-qubit Schrodinger cat state, and an
8-qubit interference register) to IBM Quantum and binds the job id. When
results arrive, the batch resolves with the sha256 of a canonical archive
containing every ordered shot, and each token reveals with the 38-bit
measurement at its pre-assigned shot index. The renderer draws the cat
(traits, cat-state skeleton check, interference fringes) entirely on-chain
from that number.

## Verify a token

```bash
node verify.mjs <tokenId>                    # uses local archive/job-<jobId>.json
node verify.mjs <tokenId> --archive f.json   # explicit archive file
node verify.mjs <tokenId> --ibm              # adds a live IBM cross-check
                                             # (requires instance access)
```

Download the archive from the published location into `archive/`, or pass its
local filename with `--archive`. The verifier currently reads local files; it
displays the on-chain archive pointer without downloading it automatically.
Archive verification needs no IBM credentials. Its circuit checks also require
the Python/Qiskit dependencies listed below.
Seven explicit checks, each with its own verdict: archive integrity, DNA at
the assigned shot, backend, published circuit descriptor (byte-hashed and
rebuilt independently from `traits.config.json`), execution ordering against
the on-chain bind, submitted-circuit equivalence (the ISA payload IBM
reports having received must prepare the same ideal state as the published
experiment), and an optional live retrieval diff.

## Setup

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
npm install
pip3 install qiskit qiskit-ibm-runtime
cp .env.example .env      # fill in keys; MINT_TOKEN_CA can wait

forge test                # 28 tests, no network needed
npm run gen:data          # regenerate CatData.sol; diff must be clean
python3 quantum/submit_job.py --dry-run     # circuit builds, configHash prints
```

## Run the whole thing

```bash
# local chain plus a real IBM job plus the verifier, one command:
bash script/rehearsal.sh

# the same against Robinhood testnet (chain 46630; fund the EOA first):
bash script/testnet-rehearsal.sh

# production oracle (30-minute batch cadence):
npm run oracle
```

Deploy with `forge script script/Deploy.s.sol --rpc-url $RPC_URL
--broadcast`. When the ERC20 exists, run the single configuration call
`cast send $CONTRACT 'setMintToken(address)' <CA>`, and call
`freezeRenderer()` when the art is final. The full mainnet checklist is in
ARCHITECTURE section 13.

## Changing art or rarity before launch

Edit `script/gen-cat-data.cjs` (art) or `traits.config.json` (curves and bit
layout), then run `npm run gen:data && forge test`. The circuit, the oracle
decoder, and the Solidity tables all derive from the same config; the
verifier's circuit checks fail loudly if anything drifts.

## Evidence

Live testnet rehearsal (Robinhood testnet): contract
[`0xc6b3eafeb626662f6e6353441bce232419d58747`](https://explorer.testnet.chain.robinhood.com/address/0xc6b3eafeb626662f6e6353441bce232419d58747),
two tokens revealed from IBM job `daeinh642tqs73aupkm0` on `ibm_marrakesh`,
seven-check verification passing, records in [`archive/`](archive/).

## Public archives and independent verification

Batch records are published in this repository's `archive/` directory. With
`ARCHIVE_GITHUB_PUBLISH=1`, the daemon resolves a batch on-chain, uploads its
canonical archive through GitHub's Contents API, then reveals the cats.
Each new file receives its own commit. Existing identical files are accepted;
existing different files are never overwritten. Publication failure retries the
same batch and archive, without submitting another IBM job. Persistent failures
park the batch for operator attention. Reveal waits for publication.

Install and authenticate GitHub CLI on the oracle host. The publishing identity
needs repository contents-write access. The publisher sends only the selected
`archive/job-<jobId>.json` file; it does not commit the working tree or Git index.
The exact embedded experiment descriptor travels inside that archive.

```bash
npm run test:oracle
npm run archive:publish -- <batchId> --dry-run   # checks local bytes against chain
npm run archive:publish -- <batchId>             # publish or retry one batch
```

Any holder can compare the public file's SHA-256 with the on-chain hash, check
the fixed shot assignment, and reproduce the DNA-to-trait mapping. This detects
changes to the file after commitment. A fabricated record committed from the
outset could still pass archive-only checks.

To establish agreement with IBM's records, use `node verify.mjs <tokenId> --ibm`
with an IBM account granted Reader access to the instance that ran the job.
This compares every ordered shot, job ID, backend, execution timestamps, submitted
ISA circuit and execution options with a fresh IBM retrieval. A job ID alone
provides no anonymous access to IBM's job details or results. Independent
reviewers can use their own IBM credentials; sharing the operator's key is
unnecessary. Reader access can expose other jobs in the same instance, so a
collection-specific instance is appropriate for this arrangement.

The verifier reports published-record consistency separately from live IBM
agreement. Exit code 0 means all required checks for the selected mode completed;
1 means disagreement; 2 means incomplete verification, including an unavailable
IBM check requested with `--ibm`. Differences in Qiskit QASM serialization may
require investigation when comparing submitted circuit records. Neither mode
establishes an IBM digital signature or independently certifies QPU physics.

IBM references: [job-detail and result authorization](https://quantum.cloud.ibm.com/docs/en/api/qiskit-runtime-rest/tags/jobs)
and [Reader access](https://quantum.cloud.ibm.com/docs/en/guides/access-groups).
