// Publishes one immutable, hash-checked batch archive. GitHub receives only this
// explicitly selected JSON file, never the oracle checkout or its Git index.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const digest = bytes => '0x' + createHash('sha256').update(bytes).digest('hex');
export function validatePublication({ jobId, resultsHash, configHash, archiveDir }) {
  if (!/^[a-z0-9]{20}$/.test(jobId)) throw new Error('Invalid IBM job ID for publication');
  const blob = readFileSync(path.join(archiveDir, `job-${jobId}.json`));
  if (digest(blob) !== resultsHash.toLowerCase()) throw new Error('Archive differs from committed resultsHash');
  const doc = JSON.parse(blob);
  const allowed = ['jobId', 'backend', 'shots', 'configHash', 'experiment', 'submitted', 'bitstrings', 'timestamps'];
  if (Object.keys(doc).some(k => !allowed.includes(k))) throw new Error('Archive contains unexpected fields');
  if (doc.jobId !== jobId || typeof doc.experiment !== 'string' || digest(Buffer.from(doc.experiment)) !== configHash.toLowerCase()) throw new Error('Archive job or circuit identity mismatch');
  if (!Number.isSafeInteger(doc.shots) || doc.shots < 1 || !Array.isArray(doc.bitstrings) || doc.bitstrings.length !== doc.shots || doc.bitstrings.some(b => !/^[01]{38}$/.test(b))) throw new Error('Archive has invalid ordered measurements');
  for (const [key, value] of Object.entries(process.env)) {
    if (/PRIVATE_KEY|TOKEN|SECRET|PASSWORD/i.test(key) && value?.length >= 16 && blob.includes(Buffer.from(value))) throw new Error('Archive contains a configured credential; publication refused');
  }
  return blob;
}

function github(args, body) {
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/PRIVATE_KEY|IBM_QUANTUM_TOKEN/.test(key)));
    const child = spawn('gh', ['api', ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [], errors = [];
    const timer = setTimeout(() => child.kill('SIGTERM'), 60_000);
    child.stdout.on('data', b => chunks.push(b));
    child.stderr.on('data', b => errors.push(b));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString();
      if (code !== 0) {
        const missing = Buffer.concat(errors).toString().includes('(HTTP 404)');
        reject(Object.assign(new Error(missing ? 'GitHub path unavailable (404)' : 'GitHub publication request failed; check authentication, branch, and write access'), { missing }));
      } else {
        try { resolve(JSON.parse(output)); } catch { reject(new Error('Invalid GitHub API response')); }
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(body ? JSON.stringify(body) : undefined);
  });
}

export async function publishArchive(options, request = github) {
  const { repository, branch = 'master', jobId } = options;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) throw new Error('Set ARCHIVE_GITHUB_REPO to owner/repository');
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith('-') || branch.includes('..')) throw new Error('Invalid archive branch');
  const blob = validatePublication(options);
  const endpoint = `repos/${repository}/contents/archive/job-${jobId}.json`;
  let existing;
  try { existing = await request([`${endpoint}?ref=${encodeURIComponent(branch)}`]); }
  catch (error) { if (!error.missing) throw error; }
  if (existing) {
    if (existing.encoding !== 'base64' || !Buffer.from(existing.content, 'base64').equals(blob)) throw new Error('Published archive differs; immutable file will not be overwritten');
    return { status: 'already-published', url: existing.html_url };
  }
  // Attribution is explicit and the authenticated account must match it.
  // Never let another machine's Git or GitHub defaults choose a commit identity.
  const user = await request(['user']);
  if (user.login !== 'quantumcoinputer' || user.id !== 272529679)
    throw new Error('Archive publication requires the authenticated quantumcoinputer account');
  const identity = { name: 'quantumcoinputer', email: '272529679+quantumcoinputer@users.noreply.github.com' };
  const result = await request([endpoint, '--method', 'PUT', '--input', '-'], {
    message: `Archive IBM job ${jobId}`,
    author: identity,
    committer: identity,
    content: blob.toString('base64'),
    branch,
  });
  return { status: 'published', commit: result.commit.sha, url: result.content.html_url };
}
