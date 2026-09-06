// Quantum Cats batch oracle.
//
// Ordering: the daemon seals shot assignments before submitting a job.
//
//   every 30 min, if pending mints:
//     1. sealBatch(range, configHash)      <- shot assignments + circuit identity
//                                             fixed on-chain, no job exists yet
//     2. submit ONE job (descriptor saved, hash MUST equal the sealed configHash)
//     3. bindJob(batchId, keccak(jobId))   <- job attached after the seal
//     4. poll -> error: fresh submit + re-bind (publicly counted)
//             -> done: archive (embeds descriptor + IBM job.inputs record)
//                      -> resolveBatch -> revealBatch(dnas)
//
// Recovery:
//   - EVERY submission path saves the descriptor file and checks its hash
//     against the sealed configHash before binding (mismatch => PARK: the
//     config drifted since seal — never bind a different circuit)
//   - a saved-but-unbound job is BOUND on retry, never discarded or replaced
//   - attempts/backoff/parking apply to seal, submit, bind, poll, resolve,
//     reveal — every path
//   - resync every RESYNC_TICKS ticks clears local done flags so reorged
//     reveals are re-detected against the chain
//   - tx receipts checked; credentials via child env; single-daemon design
//     (per-process locks only — do not run two daemons without external locking)
import { createPublicClient, createWalletClient, http, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import path from "path";
import { CATS_ABI } from "./abi.mjs";
import { decode, bitstringToDna } from "./decode.mjs";
import { submitJob, fetchJob } from "./ibm.mjs";
import { publishArchive } from "./publish-archive.mjs";

// ── config ──
const here = path.dirname(fileURLToPath(import.meta.url));
try {
  const dotenv = readFileSync(path.join(here, "..", ".env"), "utf8");
  for (const line of dotenv.split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch { /* env only */ }

const env = (k, fallback) => {
  const v = process.env[k] ?? fallback;
  if (v === undefined) throw new Error(`missing env ${k}`);
  return v;
};
const RPC_URL = env("RPC_URL");
const CONTRACT = env("CONTRACT_ADDRESS");
const IBM_TOKEN = env("IBM_QUANTUM_TOKEN");
const SHOTS = Number(env("SHOTS", "1024"));
const POLL_MS = Number(env("POLL_MS", "30000"));
const BATCH_INTERVAL_MS = Number(env("BATCH_INTERVAL_MS", String(30 * 60_000)));
const MAX_BATCH = Number(env("MAX_BATCH", "500"));
const MAX_SUBMIT_ATTEMPTS = Number(env("MAX_SUBMIT_ATTEMPTS", "8"));
const RESYNC_TICKS = Number(env("RESYNC_TICKS", "50"));
const ARCHIVE_DIR = env("ARCHIVE_DIR", path.join(here, "..", "archive"));
// public location where archive files get published (IPFS dir, GitHub raw, ...)
const ARCHIVE_GITHUB_REPO = env("ARCHIVE_GITHUB_REPO", "");
const ARCHIVE_GITHUB_BRANCH = env("ARCHIVE_GITHUB_BRANCH", "main");
const ARCHIVE_GITHUB_PUBLISH = env("ARCHIVE_GITHUB_PUBLISH", "0") === "1";
const githubArchiveBase = `https://raw.githubusercontent.com/${ARCHIVE_GITHUB_REPO}/${ARCHIVE_GITHUB_BRANCH}/archive/`;
const ARCHIVE_URI_BASE = env("ARCHIVE_URI_BASE", ARCHIVE_GITHUB_REPO ? githubArchiveBase : "https://example.invalid/archive/");
if (ARCHIVE_GITHUB_PUBLISH && (!ARCHIVE_GITHUB_REPO || ARCHIVE_URI_BASE !== githubArchiveBase))
  throw new Error("GitHub publication requires a matching repository, branch, and ARCHIVE_URI_BASE");
const account = privateKeyToAccount(env("ORACLE_PRIVATE_KEY"));

const pub = createPublicClient({ transport: http(RPC_URL) });
const wallet = createWalletClient({ account, transport: http(RPC_URL) });

// ── persistent state ──
// { lastBatchAt, seal: {configHash, attempts, ...} | null,
//   batches: { [batchId]: {jobId, attempts, nextAttemptAt, parked, done} } }
const STATE_PATH = path.join(here, "state.json");
const state = existsSync(STATE_PATH)
  ? JSON.parse(readFileSync(STATE_PATH, "utf8"))
  : { lastBatchAt: 0, seal: null, batches: {} };
state.batches ??= {};
function persist() {
  const tmp = STATE_PATH + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_PATH);
}

const log = (tag, msg) => console.log(`[${new Date().toISOString()}] ${tag} ${msg}`);
const backoff = (attempts) =>
  Math.min(60 * 60_000, 30_000 * 2 ** attempts) * (0.75 + Math.random() * 0.5);

function bumpRetry(slot, tag) {
  slot.attempts = (slot.attempts ?? 0) + 1;
  slot.nextAttemptAt = Date.now() + backoff(slot.attempts);
  if (slot.attempts >= MAX_SUBMIT_ATTEMPTS) {
    slot.parked = true;
    log(tag, `ERROR: ${slot.attempts} consecutive failures — PARKED. Clear "parked" in state.json after investigating.`);
  }
  persist();
}
const retryReady = (slot) => !slot.parked && Date.now() >= (slot.nextAttemptAt ?? 0);

async function write(fn, args) {
  const hash = await wallet.writeContract({
    address: CONTRACT, abi: CATS_ABI, functionName: fn, args, chain: null,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${fn} tx ${hash} reverted`);
  return hash;
}
const read = (fn, args = []) =>
  pub.readContract({ address: CONTRACT, abi: CATS_ABI, functionName: fn, args });

const expFile = (jobId) => path.join(ARCHIVE_DIR, `exp-${jobId}.json`);

/// Submit a job with its descriptor saved and hash-checked against the batch's
/// SEALED configHash. Used by EVERY submission path (initial and re-rolls).
async function submitForBatch(sealedConfigHash, size) {
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  const tmpExp = path.join(ARCHIVE_DIR, `exp-pending-${Date.now()}.json`);
  const { jobId, backend, configHash } = await submitJob({
    ibmToken: IBM_TOKEN, shots: Math.max(SHOTS, size), experimentOut: tmpExp,
  });
  const fileHash = createHash("sha256").update(readFileSync(tmpExp)).digest("hex");
  if (fileHash !== configHash || "0x" + configHash !== sealedConfigHash.toLowerCase()) {
    throw Object.assign(
      new Error(`descriptor hash 0x${configHash} does not match sealed configHash ${sealedConfigHash} — traits.config.json drifted since seal; NEVER bind a different circuit`),
      { fatal: true }
    );
  }
  renameSync(tmpExp, expFile(jobId));
  return { jobId, backend };
}

async function publishBatchArchive(jobId, resultsHash, configHash) {
  if (!ARCHIVE_GITHUB_PUBLISH) return;
  const publication = await publishArchive({ jobId, resultsHash, configHash,
    archiveDir: ARCHIVE_DIR, repository: ARCHIVE_GITHUB_REPO, branch: ARCHIVE_GITHUB_BRANCH });
  log("archive", `${publication.status}: ${publication.url}`);
}

// ── phase 1: seal a batch on the interval (BEFORE any job exists) ──
async function maybeSealBatch() {
  if (state.seal) {
    const s = state.seal;
    if (!retryReady(s)) return;
    // did an earlier attempt land? the chain is the truth
    const lastBatched = Number(await read("lastBatchedId"));
    if (lastBatched >= s.endId) { state.seal = null; persist(); return; }
    try {
      await write("sealBatch", [BigInt(s.startId), BigInt(s.endId), s.configHash]);
      log("seal", `batch sealed: tokens ${s.startId}-${s.endId}, configHash ${s.configHash.slice(0, 12)}… (no job exists yet)`);
      state.seal = null;
      persist();
    } catch (e) {
      log("seal", `seal failed (${e.message})`);
      bumpRetry(s, "seal");
    }
    return;
  }

  if (Date.now() - state.lastBatchAt < BATCH_INTERVAL_MS) return;
  const [minted, lastBatched] = [Number(await read("totalMinted")), Number(await read("lastBatchedId"))];
  const pending = minted - lastBatched;
  state.lastBatchAt = Date.now();
  persist();
  if (pending <= 0) { log("batch", "no pending mints this interval"); return; }

  // circuit identity comes from the local canonical descriptor
  const { execFileSync } = await import("child_process");
  const out = execFileSync("python3",
    [path.join(here, "..", "quantum", "submit_job.py"), "--descriptor-only"],
    { env: process.env }).toString();
  const configHash = "0x" + JSON.parse(out.trim().split("\n").pop()).configHash;

  state.seal = {
    startId: lastBatched + 1,
    endId: Math.min(minted, lastBatched + MAX_BATCH),
    configHash,
    attempts: 0, nextAttemptAt: 0, parked: false,
  };
  persist();
  log("batch", `${pending} pending — sealing tokens ${state.seal.startId}-${state.seal.endId} first, job comes after`);
  await maybeSealBatch();
}

// ── phase 2: drive sealed batches to reveal ──
async function processBatch(batchId) {
  const s = (state.batches[String(batchId)] ??= { jobId: null, attempts: 0, nextAttemptAt: 0, parked: false, done: false });
  if (s.done || !retryReady(s)) return;

  const [startId, endId, jobIdHash, configHash, , chainJobId, , , resolved] =
    await read("getBatch", [BigInt(batchId)]);
  const size = Number(endId) - Number(startId) + 1;
  const ZERO = "0x" + "0".repeat(64);

  try {
    // 2a: sealed but no job bound — submit then bind (recover a saved job first)
    if (jobIdHash === ZERO || (s.jobId && keccak256(toBytes(s.jobId)) !== jobIdHash && !resolved)) {
      if (s.jobId) {
        const h = keccak256(toBytes(s.jobId));
        const boundTo = await read("jobBoundTo", [h]);
        if (boundTo === 0n) {
          await write("bindJob", [BigInt(batchId), h]);
          s.attempts = 0; s.nextAttemptAt = 0; persist();
          log(`batch ${batchId}`, `recovered: bound saved job ${s.jobId}`);
          return;
        }
        s.jobId = null; persist(); // bound elsewhere/superseded — fall through
      }
      if (jobIdHash === ZERO) {
        const { jobId, backend } = await submitForBatch(configHash, size);
        s.jobId = jobId;
        persist(); // preimage saved BEFORE the tx
        await write("bindJob", [BigInt(batchId), keccak256(toBytes(jobId))]);
        s.attempts = 0; s.nextAttemptAt = 0; persist();
        log(`batch ${batchId}`, `job ${jobId} on ${backend} bound (submitted AFTER the seal)`);
        return;
      }
    }
    if (!s.jobId) {
      if (chainJobId) { s.jobId = chainJobId; persist(); }
      else {
        log(`batch ${batchId}`, "WARNING: bound hash has no known preimage (state lost) — fresh job + re-bind (publicly counted)");
        const { jobId } = await submitForBatch(configHash, size);
        s.jobId = jobId; persist();
        await write("bindJob", [BigInt(batchId), keccak256(toBytes(jobId))]);
        s.attempts = 0; s.nextAttemptAt = 0; persist();
        return;
      }
    }

    // 2b: RESOLVED batches recover from the hash-committed local archive first —
    // committed archives are immutable and reveals must not depend on IBM
    // availability (or risk a divergent re-fetch overwriting the receipt)
    if (resolved) {
      const [, alreadyRevealedR] = await read("getToken", [BigInt(startId)]);
      const [, , , , chainResultsHash] = await read("getBatch", [BigInt(batchId)]);
      const archivePath = path.join(ARCHIVE_DIR, `job-${s.jobId}.json`);
      if (existsSync(archivePath)) {
        const blob = readFileSync(archivePath);
        const localHashHex = "0x" + createHash("sha256").update(blob).digest("hex");
        if (localHashHex.toLowerCase() !== chainResultsHash.toLowerCase()) {
          s.parked = true;
          persist();
          log(`batch ${batchId}`, `FATAL: local archive ${archivePath} does not match the on-chain resultsHash — PARKED; restore the committed archive before proceeding`);
          return;
        }
        await publishBatchArchive(s.jobId, chainResultsHash, configHash);
        if (alreadyRevealedR) { s.done = true; persist(); return; }
        const archive = JSON.parse(blob.toString());
        const dnas = [];
        for (let i = 0; i < size; i++) dnas.push(bitstringToDna(archive.bitstrings[i]));
        await write("revealBatch", [BigInt(batchId), dnas]);
        log(`batch ${batchId}`, `REVEALED ${size} tokens from the committed archive (no IBM call needed)`);
        s.done = true;
        persist();
        return;
      }
      log(`batch ${batchId}`, "resolved but local archive missing — re-fetching from IBM (fetcher preserves committed bytes if measurements agree)");
    }

    // poll / first fetch (the fetcher never overwrites an existing archive)
    const r = await fetchJob(s.jobId, {
      ibmToken: IBM_TOKEN, archiveDir: ARCHIVE_DIR, experimentFile: expFile(s.jobId),
    });
    if (r.status === "pending") { log(`batch ${batchId}`, `job ${s.jobId} still ${r.raw ?? "pending"}`); return; }
    if (r.status === "error") {
      log(`batch ${batchId}`, `job ${s.jobId} failed on IBM (${r.reason}) — re-rolling (visible in commitCount)`);
      const { jobId } = await submitForBatch(configHash, size);
      s.jobId = jobId; persist();
      await write("bindJob", [BigInt(batchId), keccak256(toBytes(jobId))]);
      s.attempts = 0; s.nextAttemptAt = 0; persist();
      return;
    }

    if (!resolved) {
      const archiveURI = ARCHIVE_URI_BASE + `job-${s.jobId}.json`;
      await write("resolveBatch", [BigInt(batchId), s.jobId, "0x" + r.resultsHash, r.backend, archiveURI]);
      log(`batch ${batchId}`, `resolved: results 0x${r.resultsHash.slice(0, 12)}… on ${r.backend}${r.archivePreserved ? " (existing archive bytes preserved)" : ""}`);
    }
    await publishBatchArchive(s.jobId, "0x" + r.resultsHash, configHash);
    const [, alreadyRevealed] = await read("getToken", [BigInt(startId)]);
    if (!alreadyRevealed) {
      const archive = JSON.parse(readFileSync(r.archive, "utf8"));
      const dnas = [];
      for (let i = 0; i < size; i++) {
        const bits = archive.bitstrings[i];
        dnas.push(bitstringToDna(bits));
        const traits = decode(bits);
        log(`  #${Number(startId) + i}`, `shot ${i}: ${bits} ${traits.schrodinger ? "✦ SCHRODINGER ✦" : ""}`);
      }
      await write("revealBatch", [BigInt(batchId), dnas]);
      log(`batch ${batchId}`, `REVEALED ${size} tokens (shots 0-${size - 1} of ${archive.shots}; archive ${r.archive})`);
    }
    s.done = true;
    persist();
  } catch (e) {
    if (e.fatal) {
      s.parked = true;
      persist();
      log(`batch ${batchId}`, `FATAL: ${e.message} — PARKED`);
      return;
    }
    log(`batch ${batchId}`, `failed (${e.message})`);
    bumpRetry(s, `batch ${batchId}`);
  }
}

let ticking = false;
let tickCount = 0;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    tickCount++;
    if (tickCount % RESYNC_TICKS === 0) {
      log("oracle", "resync tick: clearing local done flags to re-verify reveals against the chain (reorg healing)");
      for (const b of Object.values(state.batches)) b.done = false;
      persist();
    }
    await maybeSealBatch();
    const count = Number(await read("batchCount"));
    for (let b = 1; b <= count; b++) {
      try {
        await processBatch(b);
      } catch (e) {
        log(`batch ${b}`, `tick error: ${e.message}`);
      }
    }
  } finally {
    ticking = false;
  }
}

log("oracle", `${account.address} watching ${CONTRACT} — seal-first batches every ${BATCH_INTERVAL_MS / 60000}min, max ${MAX_BATCH}/batch, ${SHOTS}+ shots`);
await tick();
setInterval(() => tick().catch((e) => log("oracle", `tick failed: ${e.message}`)), POLL_MS);
