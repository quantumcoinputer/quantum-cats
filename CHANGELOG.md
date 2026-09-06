# Changelog

The mechanism went through five external review rounds before its testnet
rehearsal. This condensed history is retained because several design
decisions are best understood against what they replaced.

## v4.2: archive discovery, automated equivalence, live IBM mode
- `resolveBatch` stores a public `archiveURI` per batch (on-chain, in the
  event, and as the tokenURI Archive attribute). The owner may repoint it
  for host migration; `resultsHash` remains the archive's identity.
- `quantum/check_equivalence.py`: automated ISA-versus-logical ideal-state
  comparison (component-wise simulation through the measurement wiring),
  wired in as verifier check 6. Observed agreement on the real testnet
  archive: max delta-p of 3.8e-13 across 25 components.
- `verify.mjs --ibm`: check 7, a shot-for-shot comparison between a fresh
  retrieval and the committed archive.
- Renderer input refactored to a struct (stack limit).

## v4.1: immutable archives, precise verdict labels
- The fetcher preserves existing archives (best-effort fields make
  re-fetches byte-unstable, and the file may already be hash-committed).
  Resolved batches reveal from the committed local archive without an IBM
  dependency; divergence from the on-chain hash parks the batch.
- Verifier check 4 relabelled to state exactly what it proves ("published
  experiment descriptor matches"). The submitted-circuit record became its
  own explicit check, with a hard fail on `init_qubits=false`.
- The archive gained the full ISA qasm3 payload and structured execution
  options.
- `script/rehearsal.sh`: one-command reproducible live verification.

## v4: seal-before-submit, byte-level circuit binding
- `sealBatch` (range plus configHash, with no job in existence) was split
  from `bindJob` (job attached afterward), making assignment-before-
  execution structural.
- The archive embeds the experiment descriptor as its exact canonical byte
  string; the verifier hashes those bytes itself and checks archive jobId
  against chain jobId.
- Every oracle submission path saves its descriptor and refuses to bind on
  a configHash mismatch. Parking applies to every retry path. Resync
  restored.
- Economics restated: 20 jobs is the floor for 10k at 500 per batch;
  free-tier completion is unavailable at realistic cadences.

## v3: batch protocol, shallow cat state
- One job per 30-minute window serves all pending mints;
  `shotIndex = tokenId - startId` is fixed at seal; unassigned shots are
  permanently diagnostic.
- Cat-state preparation moved from generic amplitude preparation to
  `Ry` plus a 4-CNOT chain (amplitude-exact; compiled full-circuit depth
  fell from 222 to 35 and two-qubit gates from 76 to 18; the deep
  preparation had measurably leaked 26% of shots outside the ideal outcome
  pair).
- Circuit identity (the canonical experiment descriptor hash) became bound
  on-chain per batch. The verifier moved to separate explicit verdicts.

## v2: 38-bit DNA, shot-based derivation, on-chain provenance
- Derivation moved from the most-frequent outcome to a predetermined shot.
  The histogram rule was statistically unsound twice over: at 30-plus
  qubits every outcome is unique, so a tie-break decides everything (the
  original smallest-integer tie-break zeroed the high bits on real
  hardware), and with repeats present the rule distorts the distribution
  and couples rarity to shot count.
- Added the 8-qubit interference background register (H, Rz, CZ, H) and
  the 5-qubit Schrodinger cat state; DNA grew from 30 to 38 bits.
- Reveal began storing the results hash and backend on-chain; job hashes
  became single-use; jobId strings became charset-validated.
- Fixed: the v1 background dither index formula sampled only even-position
  DNA bits.

## v1: initial mechanism
- 30-bit DNA, per-token IBM jobs, commit-reveal with keccak(jobId),
  burn-to-mint (100k ERC20 to 0xdEaD), and a fully on-chain SVG renderer
  pixel-diffed against an independent reference implementation.
