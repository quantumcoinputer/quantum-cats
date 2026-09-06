# Quantum Cats: Architecture

Quantum Cats is a 10,000-supply ERC-721 collection on Robinhood Chain
(chain-id 4663). Every token's traits and the fringe pattern of its
background derive from a single measurement of a 38-qubit circuit executed
on IBM Quantum hardware. Art and metadata are generated entirely on-chain.

This document describes the mechanism: the quantum circuit, the derivation
rule, the on-chain contracts, the provenance receipt, the oracle, and the
verification tooling. Everything described here has been executed against
real hardware and a live chain; see [Evidence](#12-evidence) and
[CHANGELOG.md](CHANGELOG.md) for the audit trail.

---

## 1. System overview

```
 minter ──mint()──▶ QuantumCats.sol ── 100k ERC20 to 0xdEaD (irrecoverable sink)
                  │      tokenURI ◀── CatRenderer.sol ◀── CatData.sol (generated)
                  │
                  │  sealBatch(startId, endId, configHash)   ◀─┐  1. assignments fixed;
                  │  bindJob(batchId, keccak(jobId))         ◀─┤     no job exists yet
                  │  resolveBatch(jobId, resultsHash,          │  2. job attached after seal
                  │               backend, archiveURI)       ◀─┤  3. results and archive bound
                  │  revealBatch(batchId, dnas[])            ◀─┤  4. one DNA per token
                  └────────────────────────────────────────────┼──────────────────────────
                                            oracle/daemon.mjs ─┴─ submit_job.py ─▶ IBM QPU
                                                 │                            │
                                                 └── fetch_job.py (poll,      │
                                                     archive, derive)   ◀─────┘

 anyone ── verify.mjs <tokenId> [--archive f.json] [--ibm] ──▶ seven explicit checks
```

Token lifecycle: Boxed (mint; art renders as a sealed cardboard box), Sealed
(batch range and circuit identity fixed on-chain before any job exists),
Bound (job attached), Resolved (results hash and archive location bound),
Revealed (38-bit DNA per token; the cat renders).

Every 30 minutes the oracle gathers all unbatched mints into one contiguous
batch and runs one quantum job for all of them. Each token is pre-assigned
`shotIndex = tokenId - batch.startId` at seal time, before the job is
submitted, and receives the measurement at that shot. One shot is one
complete, independently initialized collapse of the circuit. The batch is
the shared experiment run, and the minted collection converges toward the
circuit's distribution by the law of large numbers over tokens.

## 2. Repository map

```
traits.config.json        single source of truth: bit layout, value-to-trait
                          maps, simulated rarity curves, cat-state and
                          interference configuration
contracts/
  QuantumCats.sol         ERC-721, burn-to-mint, batch lifecycle, provenance storage
  CatRenderer.sol         DNA to pixel grid to run-length-encoded SVG to tokenURI JSON
  CatData.sol             generated art tables; edit script/gen-cat-data.cjs instead
  interfaces/, lib/       ICatRenderer, minimal IERC20, Base64
script/
  gen-cat-data.cjs        regenerates CatData.sol from the art tables
  Deploy.s.sol            forge deploy script (env-driven)
  rehearsal.sh            one-command local-chain plus real-QPU end-to-end run
  testnet-rehearsal.sh    the same against Robinhood testnet (chain 46630)
test/QuantumCats.t.sol    28 tests plus an SVG dump harness for pixel-diffing
quantum/
  submit_job.py           builds the circuit, emits the canonical experiment
                          descriptor, submits, prints jobId immediately
  fetch_job.py            single poll; shot derivation; immutable archive writer
  check_equivalence.py    automated ISA-versus-logical ideal-state equivalence
oracle/
  daemon.mjs              batch driver: seal, submit, bind, poll, resolve, reveal
  decode.mjs, ibm.mjs, abi.mjs
archive/                  canonical results JSON per job; the public record,
                          hash-bound on-chain (see archive/README.md)
verify.mjs                public verifier: seven explicit checks
viewer.html               dependency-free browser viewer for any RPC, contract, token
```

Toolchain: Solidity 0.8.24 with Foundry; Node 18 or later (ESM, viem);
Python 3.10 or later (qiskit, qiskit-ibm-runtime).

## 3. DNA specification (38 bits)

One `uint40` per token. Bit positions are MSB-first: position `i` is the
i-th character of the bitstring exactly as the QPU returns it.

| Field         | Bits  | Raw values mapped to options (multiplicity = coarse weighting) |
|---------------|-------|----------------------------------------------------------------|
| earShape      | 0:2   | pointed x2, rounded, folded |
| earInner      | 2:2   | pink x2, lavender, charcoal |
| whiskerStyle  | 4:2   | classic x2, none, long |
| whiskerColor  | 6:1   | dark, white |
| eyeShape      | 7:2   | round x2, wide, slit |
| eyeColor      | 9:3   | green x2, blue x2, amber, copper, violet, heterochromia |
| fur           | 12:4  | gray x5, orange x3, black x3, cream x2, chocolate x2, sphynx |
| pattern       | 16:3  | solid x3, tuxedo x2, patch, tiger, calico |
| accessory     | 19:3  | none x2, beanie (blue, red, purple), cigarette, cross, scarf |
| bg (hue)      | 22:3  | sky x2, purple, sand, green, rose x2, dusk |
| schrodinger   | 25:5  | all-ones triggers the half-skeleton variant (cat state, ideal 1/243) |
| interference  | 30:8  | fringe-band pattern of the background |

Solidity extraction: `(dna >> (38 - offset - len)) & mask`. Schrodinger
check: `((dna >> 8) & 0x1f) == 0x1f`. Interference byte: `dna & 0xff`.

Rarity stance: the numbers in `traits.config.json` seed the circuit's
rotations. Simulated per-option probabilities are pre-mint expectations.
Real rarity is whatever the hardware deals the minted collection, computed
post-mint from revealed DNAs. Independent per-qubit rotations cannot
factorize every categorical distribution (heterochromia, for example,
expects roughly 8.8% from a 6% seed); this property is disclosed and
retained.

## 4. The quantum circuit (quantum/submit_job.py)

38 qubits. DNA bit `i` lives on qubit `37 - i`, so the returned bitstring
reads as the DNA directly.

- Trait fields (25 qubits): one `Ry(2 asin sqrt(p))` per qubit, where `p` is
  the field's per-bit marginal from the configured curve. The pattern
  register (3 qubits) uses exact state preparation so its joint distribution
  matches the configured weights; this is how calico holds approximately 5%
  despite the factorization limit.
- Schrodinger gate (5 qubits), a physical cat state prepared shallow:
  `sqrt(242/243)|00000> + sqrt(1/243)|11111>` via `Ry(2 asin sqrt(1/243))`
  on the first cat qubit followed by a 4-CNOT chain. This is amplitude-exact
  relative to generic state preparation at a fraction of the compiled cost
  (full-circuit FakeFez depth 35 versus 222; two-qubit gates 18 versus 76).
  All-ones triggers the half-skeleton at an ideal 1/243. Other outcomes are
  unused, so noise on this register has zero art side effects.
- Interference background register (8 qubits):
  `H x8, Rz(pi/4 + k pi/2) per qubit, CZ chain (7 gates), H x8`. The final
  Hadamard layer converts phase relationships into probability differences;
  removing it provably flattens the distribution. Ideal statistics: every
  bit marginally fair (50.000%), joint entropy 7.72 bits, likeliest pattern
  1.99x uniform, rarest approximately 1 in 23,873 (some fringe patterns will
  likely never occur in the collection). The phases are fixed
  collection-wide and were chosen for interference contrast. The 8 bits
  render as 2-px diagonal fringe bands behind the cat.
- Execution: `least_busy` operational backend (QPUs vary across batches; the
  backend name is part of each batch's receipt), SamplerV2 with
  `init_qubits` explicitly enabled (each shot resets, re-prepares, and
  re-measures, producing a fresh collapse per shot), default 1,024 shots,
  logical depth 11. The script prints `{jobId, backend, configHash}`
  immediately after submission and exits without waiting for results.

Experiment descriptor: `build_circuit()` also emits a canonical,
library-independent record of the logical circuit: the exact op list (gate,
qubits, parameters rounded to 12 decimals), the sha256 of
`traits.config.json`, and the execution options. Its sha256, the configHash,
is sealed on-chain per batch and embedded byte-exactly in the results
archive. `submit_job.py --descriptor-only` reprints it for independent
rebuilding.

## 5. Derivation rule (canonical)

DNA equals `shot[shotIndex]` of the batch's bound job, where
`shotIndex = tokenId - batch.startId` is fixed on-chain at seal time, before
the job exists. The V2 Sampler preserves shot order, and per-shot
initialization is enabled and recorded.

Consequences: the delivered per-token distribution is exactly the
circuit-plus-hardware distribution, free of any histogram post-processing;
shot count is purely a cost and archival knob; unassigned shots in a batch
are permanently diagnostic data, because the sealed range fixes assignment
and leftovers can never supply outcomes for later mints.

## 6. The on-chain receipt

Stored once per batch:

| Field | Meaning |
|---|---|
| `startId..endId` | the token range; shotIndex = tokenId - startId |
| `configHash` | sha256 of the canonical experiment descriptor, sealed before any job |
| `jobIdHash`, then `jobId` | keccak commitment at bind; plaintext at resolve |
| `resultsHash` | sha256 of the canonical archive (all ordered shots, descriptor, IBM's submitted-circuit record, timestamps) |
| `backend` | the physical QPU that ran the batch |
| `archiveURI` | published location of the archive (availability pointer, owner-repointable; the hash is the identity) |
| `commitCount` | how many jobs were ever bound; re-rolls are permanently countable |

Stored per token: the 38-bit DNA and reveal status. `tokenURI` renders the
full receipt into metadata attributes (IBM Job ID, Backend, Batch, Shot
Index, Commit Count, Results Hash, Archive, DNA), so marketplaces and
explorers surface it with the art. Strings interpolated into the JSON are
charset-validated on-chain, which precludes injection.

Archive format (see archive/README.md): canonical JSON with a fixed key
order containing the jobId, backend, shot count, configHash, the experiment
descriptor as its exact canonical byte string, IBM's submitted-circuit
record (full ISA qasm3 payload plus structured options), every ordered
bitstring, and IBM's execution timestamps. Archives are immutable: the
fetcher never overwrites an existing file, and the daemon reveals resolved
batches from the committed archive without contacting IBM.

## 7. Contracts

QuantumCats.sol: a compact hand-rolled ERC-721 (unaudited; the highest-value
external audit target) plus the batch lifecycle.

- `mint()` transfers `100,000 x 10^decimals` of the configured ERC20 to
  `0xdEaD`, an irrecoverable sink. (This leaves the ERC20's `totalSupply()`
  unchanged.) The bytecode contains no escrow, treasury, or refund path.
  At 10,000 supply and 100k per mint, a complete mint-out consumes the full
  1B token supply.
- `setMintToken(address)`: the one-time deployment configuration; the price
  derives from the token's `decimals()` and locks permanently.
- `sealBatch(startId, endId, configHash)`: oracle-only; contiguous ranges
  enforced; fixes shot assignments and circuit identity while no job exists.
- `bindJob(batchId, jobIdHash)` attaches the submitted job. Each job hash
  can bind to exactly one batch ever; every re-bind increments the public
  counter.
- `resolveBatch(batchId, jobId, resultsHash, backend, archiveURI)` checks
  the commitment and binds the results identity and archive location.
- `revealBatch(batchId, dnas[])` reveals the whole batch in one transaction.
- `updateArchivePointer(batchId, uri)`: owner-only availability repoint;
  the required archive content is fixed by `resultsHash`.
- `setRenderer` until `freezeRenderer()` makes the art immutable.
  `setOracle` remains owner-operable after freezing, an operational
  necessity that is disclosed here.

CatRenderer.sol: pure and view functions, approximately 15.8 KB runtime.
Decodes DNA through the generated map tables, composes the 24x24 grid (ears,
whiskers, eyes, pattern, accessory, schrodinger transform, in that order),
renders run-length-encoded SVG with the interference fringe background, and
builds the complete tokenURI JSON as a base64 data URI. CatData.sol is
generated; reviewers should run `npm run gen:data` and confirm a clean diff.

## 8. Oracle (oracle/daemon.mjs)

A single-instance batch driver with per-process locks. Running two daemons
against one contract requires external locking. Every `BATCH_INTERVAL_MS`
(default 30 minutes) pending mints are sealed first and the job is
submitted afterward. Every submission path saves the experiment descriptor
and refuses to bind if its hash differs from the sealed configHash.
Recovery is chain-first: saved-but-unsealed work is sealed;
saved-but-unbound jobs are bound, never discarded or replaced; transaction
receipts are status-checked; failures back off exponentially and park after
`MAX_SUBMIT_ATTEMPTS` (manual unpark); a periodic resync clears local done
flags so reorged reveals are re-detected. Credentials travel to child
processes via the environment, never argv.

## 9. Verification (verify.mjs)

Seven explicit checks, each with its own verdict; the exit code reflects
them. The default mode requires an RPC endpoint and the public archive file
only, located via the on-chain `archiveURI`.

1. Archive integrity: sha256(archive bytes) equals the on-chain `resultsHash`.
2. DNA: `bitstrings[shotIndex]` equals the on-chain DNA, and the archive
   jobId equals the chain jobId.
3. Backend: archive equals chain.
4. Published circuit: the embedded descriptor string is hashed (bytes, never
   labels) and must equal the sealed `configHash` and the descriptor rebuilt
   from `traits.config.json`.
5. Execution ordering: a conservative three-state audit against the JobBound
   block time. PASS when execution began after the bind; FAIL when the job
   finished before the bind; INCONCLUSIVE otherwise.
6. Submitted circuit: `check_equivalence.py` rebuilds the logical circuit
   from the archived descriptor, parses IBM's submitted ISA payload,
   decomposes both into disconnected register components, simulates each,
   and compares ideal output distributions through the measurement wiring.
   Hard-fails on divergence or on `init_qubits=false`.
7. Live IBM cross-check (`--ibm`, requires instance read access): a fresh
   retrieval must match the committed archive shot for shot.

## 10. Trust model

| Vector | Status |
|---|---|
| Operator shops among jobs for rare outcomes | Constrained and auditable: assignments are sealed before submission, one job binds to one batch, re-binds are publicly counted, and execution-after-bind is checkable by anyone (check 5) |
| Operator fabricates results | Detectable: the archive hash is bound on-chain, and instance-authorized parties can diff IBM's data (check 7). The chain itself cannot query IBM |
| Operator substitutes a different circuit | Detectable: the descriptor is sealed pre-submission (check 4), and IBM's own submitted-circuit record must prepare the identical ideal state (check 6) |
| IBM as source | Trusted; IBM does not sign results. Mitigations: early third-party re-fetches during job retention, the immutable hash-bound archive, and the archived ISA payload |
| Funds | Nothing is custodied; payment is sink-transferred inside the mint transaction |
| Art | Freezable renderer; pre-freeze swaps are possible and disclosed |
| Oracle liveness | A dark oracle leaves boxes sealed while payment is already spent; run it monitored |
| ERC-721 implementation | Hand-rolled, 28 tests, unaudited |

IBM job reads require instance authorization; anonymous access is rejected.
The account-free verification path is the public archive plus the on-chain
hashes.

## 11. Economics (measured)

One batch job costs approximately 2 QPU-seconds regardless of batch size at
1,024 shots or fewer; fixed per-job overhead dominates (measured across
128, 1,024, and 8,192-shot runs on ibm_fez and ibm_marrakesh). At 500-token
batches, 20 jobs is the floor for a 10k mint-out; sparse arrivals raise the
count (a nonempty batch every 30 minutes is at most 48 jobs per day,
approximately 44.8 QPU-minutes per 28 days). That exceeds the free
Open-plan allowance of 10 minutes per 28 days, so budget IBM pay-as-you-go
(approximately $96 per QPU-minute, or $3.20 per batch job) with a cost limit
set on the instance. Gas on Robinhood Chain is negligible; the full testnet
rehearsal consumed approximately 0.000075 ETH.

## 12. Evidence

- Public testnet rehearsal (Robinhood testnet, chain 46630): contract
  `0xc6b3eafeb626662f6e6353441bce232419d58747`; a batch of 2 sealed, job
  `daeinh642tqs73aupkm0` on `ibm_marrakesh`, both tokens revealed. The
  seven-check verifier passes in full against the public chain. An external
  reviewer independently confirmed all 1,024 ordered shots, the submitted
  circuit, and both rendered images, and reproduced the equivalence check at
  approximately 1e-15 agreement. The automated check reports max delta-p of
  3.8e-13 across 25 components.
- `archive/` contains the canonical records for all current-format hardware
  runs. `archive/historical/` holds one pre-current-schema run kept as
  development evidence; it predates the descriptor fields and fails current
  checks by design.
- `forge test`: 28 of 28 passing. Renderer output is pixel-diffed against an
  independent reference implementation on every art change.
- Full reproduction: `script/rehearsal.sh` (local chain plus real QPU) or
  `script/testnet-rehearsal.sh` (public testnet plus real QPU).

## 13. Deployment checklist (mainnet)

1. Operate from the funded deployment EOA (it serves as owner and oracle).
   The roles are separable at any later time through `transferOwnership` and
   `setOracle` without redeployment.
2. Choose durable archive hosting; set `ARCHIVE_URI_BASE`; publish the
   `archive/` directory there.
3. Enable IBM pay-as-you-go with an instance cost limit.
4. `forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast`
   (chain 4663), record addresses, start the daemon.
5. `setMintToken(<ERC20>)`: once, locked forever.
6. `freezeRenderer()` when the art is declared final.

### Public verification scope

Archive-only verification checks the consistency of the published record with
its on-chain commitment. A consistent fabricated archive could pass those checks.
Independent IBM-instance Readers can authenticate their own connection to IBM
and retrieve the recorded job directly. The job ID alone does not grant access.
The verifier's `--ibm` mode requires that fresh comparison; missing access returns
an incomplete verdict (exit 2), not a successful live-source verification.
