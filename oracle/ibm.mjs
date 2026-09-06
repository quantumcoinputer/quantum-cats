// IBM Quantum bridge: shells out to the python scripts.
// The IBM token travels via the child process ENVIRONMENT, never argv —
// process lists and child-process error messages must not leak credentials.
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const here = path.dirname(fileURLToPath(import.meta.url));
const QUANTUM = path.join(here, "..", "quantum");

function runPython(script, args, ibmToken, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      "python3",
      [path.join(QUANTUM, script), ...args],
      { timeout: timeoutMs, env: { ...process.env, IBM_QUANTUM_TOKEN: ibmToken } },
      (err, stdout, stderr) => {
        if (stderr) process.stderr.write(stderr);
        if (err) return reject(new Error(`${script} failed: ${err.message}`));
        try {
          resolve(JSON.parse(stdout.trim().split("\n").pop()));
        } catch {
          reject(new Error(`${script} bad output: ${stdout.slice(0, 200)}`));
        }
      }
    );
  });
}

/// Submits one batch job. Writes the canonical experiment descriptor to
/// `experimentOut` (the file whose sha256 is the on-chain configHash).
export function submitJob({ ibmToken, shots, experimentOut }) {
  const args = ["--shots", String(shots)];
  if (experimentOut) args.push("--experiment-out", experimentOut);
  return runPython("submit_job.py", args, ibmToken, 300_000);
}

export function fetchJob(jobId, { ibmToken, archiveDir, experimentFile }) {
  const args = [jobId];
  if (archiveDir) args.push("--archive", archiveDir);
  if (experimentFile) args.push("--experiment", experimentFile);
  return runPython("fetch_job.py", args, ibmToken, 120_000);
}
