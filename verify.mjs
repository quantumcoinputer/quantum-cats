// Per-token archive consistency, submitted-circuit equivalence, and optional
// direct IBM retrieval. Exit codes: 0 complete for the requested mode,
// 1 disagreement, 2 incomplete checks. Archive-only mode cannot authenticate IBM.
// Usage: node verify.mjs <tokenId> [--archive file.json] [--ibm]
import { createPublicClient, http, parseAbiItem } from "viem";
import { readFileSync, existsSync } from "fs";
import { createHash } from "crypto";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { CATS_ABI } from "./oracle/abi.mjs";
import { decode, bitstringToDna, CONFIG } from "./oracle/decode.mjs";
import { compareIbmRecord, verificationResult } from "./oracle/verify-record.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(path.join(here, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch { /* env only */ }

const tokenId = process.argv[2];
const archiveArg = process.argv.indexOf("--archive");
if (!tokenId) {
  console.error("Usage: node verify.mjs <tokenId> [--archive job-<jobId>.json]");
  process.exit(1);
}

const pub = createPublicClient({ transport: http(process.env.RPC_URL) });
const [dna, revealed, , batchId, shotIndex] = await pub.readContract({
  address: process.env.CONTRACT_ADDRESS, abi: CATS_ABI, functionName: "getToken", args: [BigInt(tokenId)],
});

const BITS = CONFIG.totalBits;
console.log(`\nQuantum Cat #${tokenId}`);
if (!revealed) {
  console.log("Token is still in superposition — nothing to verify yet.");
  process.exit(0);
}
let startId, jobIdHash, chainConfigHash, chainResultsHash, jobId, chainBackend, chainArchiveURI;
try {
  [startId, , jobIdHash, chainConfigHash, chainResultsHash, jobId, chainBackend, , , chainArchiveURI] =
    await pub.readContract({
      address: process.env.CONTRACT_ADDRESS, abi: CATS_ABI, functionName: "getBatch", args: [batchId],
    });
} catch {
  // legacy deployment without archiveURI (pre-v4.2)
  const LEGACY = [{ type: "function", name: "getBatch", stateMutability: "view",
    inputs: [{ name: "batchId", type: "uint256" }],
    outputs: [
      { type: "uint64" }, { type: "uint64" }, { type: "bytes32" }, { type: "bytes32" },
      { type: "bytes32" }, { type: "string" }, { type: "string" }, { type: "uint16" }, { type: "bool" },
    ] }];
  [startId, , jobIdHash, chainConfigHash, chainResultsHash, jobId, chainBackend] =
    await pub.readContract({
      address: process.env.CONTRACT_ADDRESS, abi: LEGACY, functionName: "getBatch", args: [batchId],
    });
  chainArchiveURI = "(pre-archiveURI deployment)";
}
console.log(`  batch ${batchId}, shot index ${shotIndex} (assigned pre-execution)`);
console.log(`  on-chain jobId:       ${jobId}`);
console.log(`  on-chain backend:     ${chainBackend}`);
console.log(`  on-chain configHash:  ${chainConfigHash}`);
console.log(`  on-chain resultsHash: ${chainResultsHash}`);
console.log(`  on-chain archive URI: ${chainArchiveURI || "(none)"}`);
console.log(`  on-chain DNA:         ${dna.toString(2).padStart(BITS, "0")}`);

const archivePath = archiveArg > -1
  ? process.argv[archiveArg + 1]
  : path.join(here, "archive", `job-${jobId}.json`);
if (!existsSync(archivePath)) {
  console.error(`\narchive not found: ${archivePath}`);
  console.error("(fetch it from the published archive location, or run the oracle's fetch_job.py with instance access)");
  process.exit(1);
}
const blob = readFileSync(archivePath);
const doc = JSON.parse(blob.toString());

const checks = {};
const verdict = (ok) => (ok ? "PASS" : "FAIL");

// [1] archive integrity
const archiveHash = "0x" + createHash("sha256").update(blob).digest("hex");
checks.integrity = verdict(archiveHash.toLowerCase() === chainResultsHash.toLowerCase());

// [2] dna at the pre-assigned shot + archive/job identity
const bitstring = doc.bitstrings?.[Number(shotIndex)];
const jobIdMatches = doc.jobId === jobId;
checks.dna = verdict(!!bitstring && bitstringToDna(bitstring) === dna && jobIdMatches);
if (!jobIdMatches) checks.dna = "FAIL (archive is for a different job than the chain records)";

// [3] backend consistency
checks.backend = verdict(doc.backend === chainBackend);

// [4] circuit identity: archive vs chain vs REBUILT descriptor
let rebuiltHash = null;
try {
  const out = execFileSync("python3", [path.join(here, "quantum", "submit_job.py"), "--descriptor-only"],
    { env: process.env }).toString();
  rebuiltHash = "0x" + JSON.parse(out.trim().split("\n").pop()).configHash;
} catch { /* descriptor rebuild unavailable */ }
// hash the EMBEDDED descriptor bytes ourselves — labels prove nothing
const expString = typeof doc.experiment === "string" ? doc.experiment : null;
const embeddedHash = expString
  ? "0x" + createHash("sha256").update(Buffer.from(expString)).digest("hex")
  : null;
const cfgEmbeddedOk = embeddedHash !== null && embeddedHash.toLowerCase() === chainConfigHash.toLowerCase();
const cfgRebuildOk = rebuiltHash === null || rebuiltHash.toLowerCase() === chainConfigHash.toLowerCase();
if (embeddedHash === null) {
  checks.circuit = "FAIL (archive embeds no experiment descriptor string)";
} else if (!cfgEmbeddedOk) {
  checks.circuit = "FAIL (embedded descriptor hashes to a different value than the sealed configHash)";
} else if (rebuiltHash !== null && !cfgRebuildOk) {
  checks.circuit = "FAIL (local traits.config.json rebuilds a different descriptor — config drift or substitution)";
} else {
  checks.circuit = rebuiltHash === null
    ? "PASS — published experiment descriptor matches (rebuild unavailable; embedded-vs-chain only)"
    : "PASS — published experiment descriptor matches";
}
// [6] submitted-circuit record — reported separately, never folded into [4]
const sub = doc.submitted ?? null;
if (!sub || sub.unavailable || !sub.isaQasm3Sha256) {
  checks.submitted = `MISSING (${sub?.unavailable ? "job.inputs unavailable at fetch" : "no record in archive"}) — submitted circuit is UNVERIFIED`;
} else {
  const optStr = JSON.stringify(sub.options ?? {});
  const initFalse = /"init_qubits"\s*:\s*false/i.test(optStr);
  if (initFalse) {
    checks.submitted = "FAIL (job.inputs record says init_qubits=false — per-shot re-initialization was DISABLED; the one-shot-per-cat premise does not hold)";
  } else if (typeof sub.isaQasm3 === "string" && sub.isaQasm3.length > 0) {
    // automated ISA-vs-logical ideal-state equivalence (component-wise simulation)
    try {
      const eq = JSON.parse(execFileSync("python3",
        [path.join(here, "quantum", "check_equivalence.py"), archivePath],
        { env: process.env, timeout: 300_000 }).toString().trim().split("\n").pop());
      checks.submitted = eq.status === "pass"
        ? `PASS — submitted ISA circuit prepares the SAME ideal state as the published experiment (max Δp ${Number(eq.maxDiff).toExponential(1)}, ${eq.components} components)`
        : `UNVERIFIED (${eq.reason ?? eq.status})`;
    } catch (e) {
      const line = (e.stdout ?? "").toString().trim().split("\n").pop();
      try {
        const eq = JSON.parse(line);
        checks.submitted = eq.status === "fail"
          ? `FAIL (${eq.reason ?? "ideal distributions differ"}${eq.maxDiff ? `, max Δp ${Number(eq.maxDiff).toExponential(1)}` : ""})`
          : `UNVERIFIED (${eq.reason ?? "equivalence check unavailable"})`;
      } catch {
        checks.submitted = `UNVERIFIED (equivalence check errored: ${e.message.slice(0, 60)})`;
      }
    }
  } else {
    checks.submitted = `PRESENT (ISA ${sub.isaQasm3Sha256.slice(0, 12)}…, hash only — no payload; equivalence UNVERIFIED)`;
  }
}

// [5] execution ordering — conservative three-state
checks.ordering = "INCONCLUSIVE";
try {
  // RPCs cap eth_getLogs ranges, so scan backwards in adaptive chunks
  // (VERIFY_FROM_BLOCK skips the scan directly to a known lower bound)
  const bindEvent = parseAbiItem(
    "event JobBound(uint256 indexed batchId, bytes32 jobIdHash, uint16 commitCount)"
  );
  let logs = [];
  {
    const latest = await pub.getBlockNumber();
    const floor = process.env.VERIFY_FROM_BLOCK
      ? BigInt(process.env.VERIFY_FROM_BLOCK)
      : latest > 5_000_000n ? latest - 5_000_000n : 0n;
    let chunk = 45_000n;
    let hi = latest;
    while (hi >= floor && logs.length === 0) {
      const lo = hi - chunk + 1n > floor ? hi - chunk + 1n : floor;
      try {
        logs = await pub.getLogs({
          address: process.env.CONTRACT_ADDRESS,
          event: bindEvent,
          args: { batchId },
          fromBlock: lo,
          toBlock: hi,
        });
        hi = lo - 1n;
      } catch (e) {
        if (chunk > 2_000n) { chunk /= 2n; continue; }
        throw e;
      }
    }
  }
  const match = logs.filter((l) => l.args.jobIdHash === jobIdHash).pop();
  if (match) {
    const block = await pub.getBlock({ blockNumber: match.blockNumber });
    const bindTime = new Date(Number(block.timestamp) * 1000);
    const ts = doc.timestamps ?? {};
    const running = ts.running ? new Date(ts.running) : null;
    const finished = ts.finished ? new Date(ts.finished) : null;
    console.log(`\n  bind block time: ${bindTime.toISOString()}`);
    console.log(`  job running:     ${running ? running.toISOString() : "(unavailable)"}`);
    console.log(`  job finished:    ${finished ? finished.toISOString() : "(unavailable)"}`);
    if (finished && finished < bindTime) {
      checks.ordering = "FAIL (job finished BEFORE the bind — results were knowable at commit time)";
    } else if (running && running > bindTime) {
      checks.ordering = "PASS (execution began after the on-chain bind; assignments were fixed at the earlier seal)";
    } else {
      checks.ordering = "INCONCLUSIVE (commit landed during queue/execution, or timestamps incomplete)";
    }
  }
} catch (e) {
  checks.ordering = `INCONCLUSIVE (audit unavailable: ${e.message.slice(0, 60)})`;
}

// [7] optional live IBM cross-check (--ibm): fresh retrieval must agree with
// the committed archive, shot for shot. Requires instance read access.
checks.ibm = "SKIPPED (pass --ibm with instance access for a live cross-check)";
if (process.argv.includes("--ibm")) {
  const { mkdtempSync, rmSync } = await import("fs");
  const os = await import("os");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "qc-verify-"));
  try {
    execFileSync("python3",
      [path.join(here, "quantum", "fetch_job.py"), jobId, "--archive", tmp],
      { env: process.env, timeout: 300_000 });
    const fresh = JSON.parse(readFileSync(path.join(tmp, `job-${jobId}.json`), "utf8"));
    checks.ibm = compareIbmRecord(doc, fresh);
  } catch {
    checks.ibm = "INCONCLUSIVE (IBM retrieval unavailable; check instance read access and job retention)";
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

if (bitstring) {
  console.log(`\n  measurement at shot ${shotIndex}: ${bitstring}`);
  console.log(`  trait breakdown:`);
  for (const [k, v] of Object.entries(decode(bitstring))) {
    console.log(`    ${String(k).padEnd(14)} ${v}`);
  }
}

console.log("\n" + "=".repeat(60));
console.log(`  [1] archive integrity: ${checks.integrity}`);
console.log(`  [2] dna at shot:       ${checks.dna}`);
console.log(`  [3] backend:           ${checks.backend}`);
console.log(`  [4] published circuit: ${checks.circuit}`);
console.log(`  [5] exec ordering:     ${checks.ordering}`);
console.log(`  [6] submitted circuit: ${checks.submitted}`);
console.log(`  [7] live IBM check:    ${checks.ibm}`);
const result = verificationResult(checks, process.argv.includes("--ibm"));
console.log(`  RESULT: ${result.message}`);
console.log("=".repeat(60));
process.exit(result.exitCode);
