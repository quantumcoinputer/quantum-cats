"""
Submit one Quantum Cats mint circuit to IBM Quantum hardware.

Builds the 38-qubit circuit from traits.config.json:
  - shallow trait fields: one Ry(2*asin(sqrt(p))) per qubit, p = per-bit marginal
  - exact fields (pattern): state preparation so the joint distribution matches
    the configured weights exactly
  - schrodinger gate: an entangled CAT STATE  sqrt(242/243)|00000> + sqrt(1/243)|11111>
    prepared SHALLOW: Ry(2*asin(sqrt(1/243))) on the first cat qubit + a 4-CNOT
    chain — identical ideal state to generic amplitude prep at a fraction of the
    compiled depth (fewer gates = fewer noise opportunities)
  - interference background register: H^8 -> fixed Rz phase layer -> CZ chain ->
    H^8. Individually fair bits whose combinations carry interference structure;
    rendered as diagonal fringe bands behind the cat.

Prints a single JSON line to stdout IMMEDIATELY after submission and exits —
it does NOT wait for results. The oracle seals the batch on-chain (job id hash +
circuit config hash) first, then polls fetch_job.py.

Circuit identity: build_circuit() also emits a canonical EXPERIMENT DESCRIPTOR
(onechain-order op list, config file hash, execution options). Its sha256 is the
configHash bound on-chain per batch and embedded in the results archive, so a
verifier can rebuild the descriptor from traits.config.json and prove which
experiment was published for the batch. (--descriptor-only prints it and exits.)

Derivation rule (documented, applied in fetch_job.py): DNA = shot 0.

Usage:
  python3 submit_job.py [--token X] [--shots 1024] [--dry-run]
  (token may also come from IBM_QUANTUM_TOKEN in the environment — preferred,
   so the credential never appears in process arguments)

Bit convention: DNA bitstring position i (0 = leftmost = first field's MSB)
lives on qubit (TOTAL-1 - i), so Qiskit's returned bitstring reads as the DNA.
"""
import os
import sys
import json
import math
import argparse
from pathlib import Path

CONFIG = json.loads((Path(__file__).parent.parent / "traits.config.json").read_text())
TOTAL = CONFIG["totalBits"]

def log(msg):
    print(f"[submit] {msg}", file=sys.stderr)

def field_layout():
    out, off = [], 0
    for f in CONFIG["fields"]:
        out.append((f, off))
        off += f["bits"]
    assert off + CONFIG["schrodinger"]["qubits"] + CONFIG["interference"]["qubits"] == TOTAL
    return out, off

def marginals(f):
    mult = {}
    for o in f["map"]:
        mult[o] = mult.get(o, 0) + 1
    q = [f["target"][o] / mult[o] for o in f["map"]]
    ps = []
    for j in range(f["bits"]):
        shift = f["bits"] - 1 - j
        ps.append(sum(q[v] for v in range(len(f["map"])) if (v >> shift) & 1))
    return ps

def value_probs(f):
    mult = {}
    for o in f["map"]:
        mult[o] = mult.get(o, 0) + 1
    return [f["target"][o] / mult[o] for o in f["map"]]

def build_circuit():
    """Returns (circuit, canonical op list). The op list is OUR record of the
    logical circuit — library-independent, deterministic, hashable."""
    from qiskit import QuantumCircuit
    qc = QuantumCircuit(TOTAL)
    ops = []
    r12 = lambda x: round(x, 12)

    def ry(theta, q):
        qc.ry(theta, q)
        ops.append(["ry", [q], [r12(theta)]])

    def cx(a, b):
        qc.cx(a, b)
        ops.append(["cx", [a, b], []])

    fields, off = field_layout()

    # trait fields
    for f, foff in fields:
        qubits_msb_first = [TOTAL - 1 - (foff + j) for j in range(f["bits"])]
        if f.get("exact"):
            amps = [math.sqrt(p) for p in value_probs(f)]
            norm = math.sqrt(sum(a * a for a in amps))
            amps = [a / norm for a in amps]
            qc.prepare_state(amps, list(reversed(qubits_msb_first)))
            ops.append(["prepare_state", list(reversed(qubits_msb_first)), [r12(a) for a in amps]])
            log(f"{f['name']}: exact state prep on qubits {qubits_msb_first}")
        else:
            for j, p in enumerate(marginals(f)):
                ry(2 * math.asin(math.sqrt(min(1.0, max(0.0, p)))), qubits_msb_first[j])

    # schrodinger cat state, SHALLOW form: Ry on the first cat qubit + CNOT chain
    # (identical ideal state to amplitude prep; compiled depth ~21 vs ~220)
    s = CONFIG["schrodinger"]
    n = s["qubits"]
    cat_qubits_msb_first = [TOTAL - 1 - (off + j) for j in range(n)]
    p_all_ones = s["p1"] ** n
    ry(2 * math.asin(math.sqrt(p_all_ones)), cat_qubits_msb_first[0])
    for j in range(n - 1):
        cx(cat_qubits_msb_first[j], cat_qubits_msb_first[j + 1])
    log(f"schrodinger: shallow cat state (Ry + {n-1} CNOTs) on qubits {cat_qubits_msb_first}, P(all-ones)={p_all_ones:.6f}")
    off += n

    # interference background register on the last 8 bits
    iface = CONFIG["interference"]
    m = iface["qubits"]
    bg_qubits_msb_first = [TOTAL - 1 - (off + j) for j in range(m)]
    for q in bg_qubits_msb_first:
        qc.h(q)
        ops.append(["h", [q], []])
    for k, frac in enumerate(iface["phasesPi"]):
        qc.rz(math.pi * frac, bg_qubits_msb_first[k])
        ops.append(["rz", [bg_qubits_msb_first[k]], [r12(math.pi * frac)]])
    for k in range(m - 1):
        qc.cz(bg_qubits_msb_first[k], bg_qubits_msb_first[k + 1])
        ops.append(["cz", [bg_qubits_msb_first[k], bg_qubits_msb_first[k + 1]], []])
    for q in bg_qubits_msb_first:
        qc.h(q)
        ops.append(["h", [q], []])
    log(f"interference: H-Rz-CZ-H on qubits {bg_qubits_msb_first}")

    qc.measure_all()
    ops.append(["measure_all", list(range(TOTAL)), []])
    return qc, ops


def experiment_descriptor(ops):
    """Canonical, library-independent identity of the published experiment."""
    import hashlib
    config_bytes = (Path(__file__).parent.parent / "traits.config.json").read_bytes()
    doc = {
        "version": 2,
        "totalBits": TOTAL,
        "configSha256": hashlib.sha256(config_bytes).hexdigest(),
        "ops": ops,
        "options": {"init_qubits": True},
    }
    blob = json.dumps(doc, separators=(",", ":"), sort_keys=False).encode()
    return doc, hashlib.sha256(blob).hexdigest(), blob

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--token", default=os.environ.get("IBM_QUANTUM_TOKEN"))
    ap.add_argument("--shots", type=int, default=int(os.environ.get("SHOTS", "1024")))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--descriptor-only", action="store_true",
                    help="print the canonical experiment descriptor + configHash and exit")
    ap.add_argument("--experiment-out", default=None,
                    help="write the canonical descriptor JSON here")
    args = ap.parse_args()

    qc, ops = build_circuit()
    doc, config_hash, blob = experiment_descriptor(ops)
    log(f"circuit: {qc.num_qubits} qubits, depth {qc.depth()}, ops {dict(qc.count_ops())}")
    log(f"configHash: {config_hash}")
    if args.experiment_out:
        Path(args.experiment_out).write_bytes(blob)

    if args.descriptor_only:
        print(json.dumps({"configHash": config_hash, "descriptor": doc}))
        return

    if args.dry_run:
        print(json.dumps({"jobId": "DRY_RUN", "backend": "none", "configHash": config_hash}))
        return

    if not args.token:
        raise SystemExit("set IBM_QUANTUM_TOKEN (env) or pass --token")

    from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager
    from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2 as Sampler

    log("connecting to IBM Quantum Platform...")
    service = QiskitRuntimeService(channel="ibm_quantum_platform", token=args.token)
    backend = service.least_busy(operational=True)
    log(f"backend: {backend.name} ({backend.num_qubits} qubits)")

    pm = generate_preset_pass_manager(optimization_level=1, target=backend.target)
    isa = pm.run(qc)
    log(f"transpiled: depth {isa.depth()}")

    sampler = Sampler(mode=backend)
    # per-shot re-initialization: every shot resets, re-prepares, and re-measures
    # (a fresh collapse per shot — required for the one-mint-per-shot design)
    sampler.options.execution.init_qubits = True
    job = sampler.run([isa], shots=args.shots)
    # print and exit immediately — the job id must be committed on-chain
    # BEFORE anyone (including us) can know the results
    print(json.dumps({"jobId": job.job_id(), "backend": backend.name, "configHash": config_hash}))

if __name__ == "__main__":
    main()
