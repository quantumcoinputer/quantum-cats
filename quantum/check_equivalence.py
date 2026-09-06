"""
ISA-vs-logical circuit equivalence check (automates the reviewer's manual audit).

Given a v3+ archive (embedded experiment descriptor + submitted ISA qasm3),
verifies that the circuit IBM says it executed produces the same ideal
measurement distribution as the published logical experiment:

  1. rebuild the logical circuit from the archive's canonical op list
  2. parse the submitted ISA circuit; record its measurement wiring
     (qubit -> classical bit -> DNA position); strip measures/barriers
  3. decompose BOTH into disconnected components (registers are disjoint by
     design, so components stay small: 8q interference, 5q cat, 3q pattern,
     singles) and simulate each component's ideal output probabilities
  4. match components by the DNA positions they measure and compare the
     probability distributions in DNA-bit order

Prints one JSON line: {"status":"pass"|"fail"|"unavailable", "maxDiff":…,
"components":N, "reason":…}. Compare threshold 1e-9 (transpilation is exact
up to numerical precision; observed agreement is ~1e-15).

Usage: python3 check_equivalence.py path/to/job-<id>.json
"""
import json
import sys
from pathlib import Path


def out(**kw):
    print(json.dumps(kw))
    sys.exit(0 if kw.get("status") == "pass" else 1 if kw.get("status") == "fail" else 0)


def component_distributions(circ, qubit_to_dna):
    """Split into disconnected components; return {frozenset(dna_positions):
    {tuple(bits in sorted-dna order): probability}} for measured qubits."""
    from qiskit.converters import circuit_to_dag, dag_to_circuit
    from qiskit.quantum_info import Statevector

    dag = circuit_to_dag(circ)
    result = {}
    for comp in dag.separable_circuits(remove_idle_qubits=True):
        if comp.num_qubits() == 0 or not any(True for _ in comp.op_nodes()):
            continue
        qc = dag_to_circuit(comp)
        # component qubit j -> original index -> DNA position (None if unmeasured)
        dna_of = []
        for q in qc.qubits:
            orig = circ.find_bit(q).index
            dna_of.append(qubit_to_dna.get(orig))
        measured = sorted(d for d in dna_of if d is not None)
        if not measured:
            continue
        if qc.num_qubits > 22:
            out(status="unavailable", reason=f"component too large to simulate ({qc.num_qubits} qubits)")
        probs = Statevector.from_instruction(qc).probabilities()
        dist = {}
        for v, p in enumerate(probs):
            if p < 1e-18:
                continue
            bits = {}
            for j, d in enumerate(dna_of):
                if d is not None:
                    bits[d] = (v >> j) & 1  # statevector bit j <-> qubits[j]
            key = tuple(bits[d] for d in measured)
            dist[key] = dist.get(key, 0.0) + p
        fs = frozenset(measured)
        if fs in result:  # same register split across components? merge is invalid
            out(status="unavailable", reason="duplicate register component")
        result[fs] = dist
    return result


def main():
    archive_path = sys.argv[1]
    doc = json.loads(Path(archive_path).read_text())

    exp = doc.get("experiment")
    isa_text = (doc.get("submitted") or {}).get("isaQasm3")
    if not exp or not isinstance(exp, str):
        out(status="unavailable", reason="archive embeds no experiment descriptor")
    if not isa_text:
        out(status="unavailable", reason="archive embeds no submitted ISA payload")

    from qiskit import QuantumCircuit, qasm3

    descriptor = json.loads(exp)
    total = descriptor["totalBits"]

    # 1. logical circuit from the canonical op list (skip terminal measure)
    logical = QuantumCircuit(total)
    for name, qubits, params in descriptor["ops"]:
        if name == "measure_all":
            continue
        if name == "prepare_state":
            logical.prepare_state(params, qubits)
        else:
            getattr(logical, name)(*params, *qubits)
    logical_map = {q: total - 1 - q for q in range(total)}  # qubit q holds DNA bit total-1-q

    # 2. ISA circuit: capture measurement wiring, strip measures/barriers
    isa = qasm3.loads(isa_text)
    isa_map = {}
    clean = QuantumCircuit(isa.num_qubits)
    for inst in isa.data:
        nm = inst.operation.name
        if nm == "measure":
            q = isa.find_bit(inst.qubits[0]).index
            c = isa.find_bit(inst.clbits[0]).index
            isa_map[q] = total - 1 - c  # clbit c holds DNA position total-1-c
        elif nm == "barrier":
            continue
        else:
            clean.append(inst.operation, [isa.find_bit(q).index for q in inst.qubits], [])
    if len(isa_map) != total:
        out(status="fail", reason=f"ISA measures {len(isa_map)} qubits, expected {total}")

    # 3-4. component-wise ideal distributions, matched by DNA positions
    ldist = component_distributions(logical, logical_map)
    idist = component_distributions(clean, isa_map)
    if set(ldist.keys()) != set(idist.keys()):
        out(status="fail", reason="register partition differs between logical and ISA circuits",
            logical=[sorted(k) for k in ldist], isa=[sorted(k) for k in idist])

    max_diff = 0.0
    for key in ldist:
        keys = set(ldist[key]) | set(idist[key])
        for k in keys:
            d = abs(ldist[key].get(k, 0.0) - idist[key].get(k, 0.0))
            max_diff = max(max_diff, d)

    if max_diff < 1e-9:
        out(status="pass", maxDiff=max_diff, components=len(ldist))
    out(status="fail", maxDiff=max_diff, components=len(ldist),
        reason="ideal output distributions differ beyond numerical precision")


if __name__ == "__main__":
    main()
