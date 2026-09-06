# The public archive

One canonical JSON file per quantum job, named `job-<jobId>.json`, plus the
experiment descriptor saved at submission time (`exp-<jobId>.json`; its
exact bytes are also embedded inside the job archive).

The sha256 of each `job-*.json` file's exact bytes is stored on-chain as the
corresponding batch's `resultsHash`. The file is therefore immutable:
tooling never rewrites it, and any modification is detectable by anyone
with an RPC endpoint.

## Format (fixed key order, compact separators)

```json
{
  "jobId":       "IBM job id (matches the on-chain plaintext)",
  "backend":     "QPU that executed the job",
  "shots":       1024,
  "configHash":  "sha256 of the experiment field below",
  "experiment":  "<the canonical experiment descriptor as its exact byte
                  string: version, totalBits, sha256 of traits.config.json,
                  the full logical op list, execution options>",
  "submitted":   { "isaQasm3": "<full transpiled circuit IBM reports having
                                received (job.inputs)>",
                   "isaQasm3Sha256": "...", "isaNumQubits": 156,
                   "options": { "execution": { "init_qubits": true } } },
  "bitstrings":  ["<shot 0>", "<shot 1>", "... every ordered measurement"],
  "timestamps":  { "created": "...", "running": "...", "finished": "..." }
}
```

Token attribution: the token with `shotIndex = k` (fixed on-chain at seal,
before the job existed) has `DNA = bitstrings[k]`. Shots beyond the batch's
token range are permanently diagnostic data: public statistical evidence of
the circuit's behaviour that can never be assigned to future mints.

Verify any file against any token with
`node verify.mjs <tokenId> --archive archive/job-<jobId>.json`
(seven checks; requires an RPC endpoint only).

`historical/` contains one pre-current-schema development run, kept as
evidence. It predates the descriptor and ISA fields and fails current
checks by design; attaching a present-day descriptor to it would
misdescribe what was executed.

## Why keep a public copy?

IBM stores job results, with instance-authorized access. Its published policy
retains undeleted data for three years while you are a current user; deleting
an instance removes its jobs and results. A public copy makes verification
available to NFT holders independently of that account and retention window.
See [IBM retention policy](https://quantum.cloud.ibm.com/docs/en/guides/secure-data)
and [job-result API authorization](https://quantum.cloud.ibm.com/docs/en/api/qiskit-runtime-rest/tags/jobs).

The chain already stores each cat's measurement and the batch's archive hash.
The archive adds all ordered shots, circuit records, and execution timestamps.
The hash identifies the exact file; it cannot reconstruct a missing file.
Publishing a copy on a public repository or another maintained host provides
access. Keeping copies on independent hosts improves availability.

The file for `daei48bdd5gc73d8l2sg` predates full ISA-payload capture: its
submitted record contains the ISA hash and options, but no `isaQasm3` payload.
It remains unchanged as historical evidence within the descriptor-era schema;
its submitted-circuit equivalence check cannot be reproduced from that file.
The other two descriptor-era archives include the full submitted ISA payload.

## Repository publication

Canonical location:
`https://raw.githubusercontent.com/quantumcoinputer/quantum-cats/main/archive/job-<jobId>.json`.
The production daemon publishes each resolved batch through
`oracle/publish-archive.mjs` before reveal, when GitHub publication is enabled.
Every future job file contains its exact experiment descriptor internally;
separate `exp-*.json` files are optional local submission records. Git history
records publication, while the on-chain SHA-256 determines file integrity.

Public archive checks establish consistency with the committed record. Direct
IBM agreement additionally requires a fresh authenticated retrieval from the
originating instance. See the repository README for holder and reviewer steps.
