"""
Fetch results for one Quantum Cats job. Single poll, no waiting.

Derivation rule (documented, deterministic, reproducible):
  DNA = SHOT 0 — the first measured shot of the committed job. The V2 Sampler
  preserves shot order. One predetermined shot = one collapse = one cat, and
  the delivered distribution is exactly whatever the circuit and hardware
  produce (no most-frequent selection, which would skew toward repeats).

Provenance archive:
  With --archive DIR, writes DIR/job-<jobId>.json containing the CANONICAL
  results document (fixed key order, compact separators):
    {"jobId":..,"backend":..,"shots":N,"configHash":..,"experiment":"<raw
     canonical descriptor JSON string>","submitted":{best-effort job.inputs
     record},"bitstrings":[..ordered..],"timestamps":{..}}
  The experiment field is the EXACT byte string whose sha256 is configHash —
  verifiers hash it directly, no re-serialization ambiguity. The submitted
  record captures what IBM says was actually submitted (shots + ISA circuit
  dump when retrievable) — it trusts IBM's records but closes the gap between
  operator-supplied labels and the executed job.
  and reports resultsHash = sha256 of those exact bytes. The oracle binds that
  hash ON-CHAIN per batch, so the archived file is integrity-bound forever and
  verification outlives IBM's job retention. The embedded experiment descriptor
  (canonical op list + config hash + execution options) binds WHICH circuit was
  published for this batch — verifiable by rebuilding it from traits.config.json
  via `submit_job.py --descriptor-only`. (IBM does not sign results; hashes
  prove consistency with what was committed, not IBM authorship.)

Usage:
  python3 fetch_job.py <jobId> [--token X] [--archive DIR]
  (token may come from IBM_QUANTUM_TOKEN env — preferred over argv)
"""
import os
import sys
import json
import hashlib
import argparse
from pathlib import Path

TOTAL = json.loads((Path(__file__).parent.parent / "traits.config.json").read_text())["totalBits"]

def canonical(doc):
    """The exact byte representation whose sha256 goes on-chain."""
    ordered = {
        "jobId": doc["jobId"],
        "backend": doc["backend"],
        "shots": doc["shots"],
        "configHash": doc["configHash"],
        "experiment": doc["experiment"],
        "submitted": doc["submitted"],
        "bitstrings": doc["bitstrings"],
        "timestamps": doc["timestamps"],
    }
    return json.dumps(ordered, separators=(",", ":"), sort_keys=False).encode()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("job_id")
    ap.add_argument("--token", default=os.environ.get("IBM_QUANTUM_TOKEN"))
    ap.add_argument("--archive", default=None)
    ap.add_argument("--experiment", default=None,
                    help="canonical experiment descriptor JSON (from submit_job --experiment-out)")
    args = ap.parse_args()
    if not args.token:
        raise SystemExit("set IBM_QUANTUM_TOKEN (env) or pass --token")

    from qiskit_ibm_runtime import QiskitRuntimeService

    service = QiskitRuntimeService(channel="ibm_quantum_platform", token=args.token)
    job = service.job(args.job_id)
    status = str(job.status())

    if any(s in status for s in ("ERROR", "CANCELLED", "FAILED")):
        print(json.dumps({"status": "error", "reason": status}))
        return
    if "DONE" not in status and "Completed" not in status:
        print(json.dumps({"status": "pending", "raw": status}))
        return

    result = job.result()
    bits = result[0].data.meas.get_bitstrings()
    bitstring = bits[0]  # THE RULE: shot 0
    if len(bitstring) != TOTAL:
        print(json.dumps({"status": "error", "reason": f"expected {TOTAL} bits, got {len(bitstring)}"}))
        return

    timestamps = {}
    try:
        m = job.metrics()
        timestamps = m.get("timestamps", {}) or {}
    except Exception:
        pass
    usage = None
    try:
        usage = job.usage()
    except Exception:
        try:
            usage = job.metrics().get("usage", {}).get("quantum_seconds")
        except Exception:
            pass

    backend_name = job.backend().name if job.backend() else "unknown"
    experiment, config_hash = "", ""
    if args.experiment:
        exp_blob = Path(args.experiment).read_bytes()
        experiment = exp_blob.decode()  # embedded as the EXACT canonical string
        config_hash = hashlib.sha256(exp_blob).hexdigest()

    # best-effort record of what IBM says was submitted (trusts IBM's storage,
    # but pins the executed job beyond operator-supplied labels)
    submitted = {}
    try:
        inputs = job.inputs
        pubs = inputs.get("pubs") if isinstance(inputs, dict) else None
        if pubs:
            circ = pubs[0][0]
            from qiskit import qasm3
            isa_text = qasm3.dumps(circ)
            # FULL payload, not just the hash — a hash cannot reconstruct the
            # circuit after IBM's record disappears; storing it preserves the
            # option of deeper (ISA-vs-logical) verification later
            submitted["isaQasm3"] = isa_text
            submitted["isaQasm3Sha256"] = hashlib.sha256(isa_text.encode()).hexdigest()
            submitted["isaNumQubits"] = circ.num_qubits
        if isinstance(inputs, dict) and "options" in inputs:
            def jsonable(x):
                if isinstance(x, dict):
                    return {k: jsonable(v) for k, v in x.items()}
                if isinstance(x, (list, tuple)):
                    return [jsonable(v) for v in x]
                if isinstance(x, (str, int, float, bool)) or x is None:
                    return x
                return str(x)
            submitted["options"] = jsonable(inputs.get("options"))
    except Exception as e:
        submitted["unavailable"] = str(e)[:200]

    doc = {
        "jobId": args.job_id,
        "backend": backend_name,
        "shots": len(bits),
        "configHash": config_hash,
        "experiment": experiment,
        "submitted": submitted,
        "bitstrings": bits,
        "timestamps": timestamps,
    }
    blob = canonical(doc)
    results_hash = hashlib.sha256(blob).hexdigest()

    archive_path = None
    preserved = False
    if args.archive:
        Path(args.archive).mkdir(parents=True, exist_ok=True)
        archive_path = str(Path(args.archive) / f"job-{args.job_id}.json")
        if Path(archive_path).exists():
            # ARCHIVES ARE IMMUTABLE. Best-effort fields (submitted record,
            # timestamps) make re-fetches byte-unstable, and the existing file
            # may already be hash-committed on-chain. Verify the measurements
            # agree, then keep the original bytes as the canonical record.
            existing = Path(archive_path).read_bytes()
            existing_doc = json.loads(existing)
            if existing_doc.get("bitstrings") != bits:
                print(json.dumps({
                    "status": "error",
                    "reason": f"existing archive {archive_path} has DIFFERENT measurements than a fresh fetch — refusing to overwrite; investigate",
                }))
                return
            blob = existing
            results_hash = hashlib.sha256(blob).hexdigest()
            preserved = True
        else:
            Path(archive_path).write_bytes(blob)

    print(json.dumps({
        "status": "done",
        "configHash": config_hash,
        "bitstring": bitstring,
        "backend": backend_name,
        "shots": len(bits),
        "unique": len(set(bits)),
        "resultsHash": results_hash,
        "archive": archive_path,
        "archivePreserved": preserved,
        "timestamps": timestamps,
        "qpu_seconds": usage,
    }))

if __name__ == "__main__":
    main()
