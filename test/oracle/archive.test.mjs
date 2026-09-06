import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { publishArchive } from '../../oracle/publish-archive.mjs';
import { compareIbmRecord, verificationResult } from '../../oracle/verify-record.mjs';
const jobId = 'daeinh642tqs73aupkm0';
const file = new URL(`../../archive/job-${jobId}.json`, import.meta.url);
const blob = readFileSync(file);
const doc = JSON.parse(blob);
const digest = b => '0x' + createHash('sha256').update(b).digest('hex');
const configHash = digest(Buffer.from(doc.experiment));
const fixture = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'qc-publish-test-'));
  writeFileSync(path.join(dir, `job-${jobId}.json`), blob);
  writeFileSync(path.join(dir, '.env'), 'PRIVATE_KEY=must-never-be-published');
  return { archiveDir: dir, jobId, resultsHash: digest(blob), configHash, repository: 'example/cats', branch: 'main' };
};
test('publishes exactly the committed archive, without touching staged files or sending the directory', async () => {
  const options = fixture(), calls = [];
  try {
    const result = await publishArchive(options, async (args, body) => {
      calls.push({ args, body });
      if (!body) throw Object.assign(new Error('missing'), { missing: true });
      assert.equal(Buffer.from(body.content, 'base64').toString(), blob.toString());
      assert.equal(body.sha, undefined);
      assert.equal(body.branch, 'main');
      return { commit: { sha: 'commit' }, content: { html_url: 'https://example.test/archive' } };
    });
    assert.equal(result.status, 'published');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].args[0], `repos/example/cats/contents/archive/job-${jobId}.json`);
  } finally { rmSync(options.archiveDir, { recursive: true }); }
});
test('existing matching archive is idempotent; existing altered archive is never overwritten', async () => {
  const options = fixture();
  try {
    const same = await publishArchive(options, async () => ({ encoding: 'base64', content: blob.toString('base64') }));
    assert.equal(same.status, 'already-published');
    await assert.rejects(publishArchive(options, async () => ({ encoding: 'base64', content: Buffer.from('altered').toString('base64') })), /will not be overwritten/);
  } finally { rmSync(options.archiveDir, { recursive: true }); }
});
test('wrong chain hash, path traversal, and invalid descriptor fail before network access', async () => {
  const options = fixture();
  const request = async () => assert.fail('network should not be reached');
  try {
    await assert.rejects(publishArchive({ ...options, resultsHash: '0x' + '0'.repeat(64) }, request), /resultsHash/);
    await assert.rejects(publishArchive({ ...options, jobId: '../.env' }, request), /Invalid IBM job/);
    await assert.rejects(publishArchive({ ...options, configHash: '0x' + '0'.repeat(64) }, request), /identity mismatch/);
  } finally { rmSync(options.archiveDir, { recursive: true }); }
});
test('live IBM comparison detects altered shots, backend, execution times, and submitted circuit', () => {
  assert.match(compareIbmRecord(doc, structuredClone(doc)), /^PASS/);
  for (const change of [
    d => { d.bitstrings[0] = '0'.repeat(38); },
    d => { d.backend = 'ibm_other'; },
    d => { d.timestamps.running = '2000-01-01T00:00:00Z'; },
    d => { d.submitted.options.execution.init_qubits = false; },
    d => { d.submitted.isaQasm3 += '\n'; },
  ]) {
    const fake = structuredClone(doc); change(fake);
    assert.match(compareIbmRecord(fake, doc), /^FAIL/);
  }
  const missing = structuredClone(doc); delete missing.submitted;
  assert.match(compareIbmRecord(doc, missing), /^INCONCLUSIVE/);
});
test('unavailable requested IBM check never returns a successful verification result', () => {
  const checks = Object.fromEntries(['integrity', 'dna', 'backend', 'circuit', 'ordering', 'submitted'].map(k => [k, 'PASS']));
  checks.ibm = 'INCONCLUSIVE';
  assert.equal(verificationResult(checks, true).exitCode, 2);
  assert.equal(verificationResult(checks, false).exitCode, 0);
  assert.match(verificationResult(checks, false).message, /authorship was not independently checked/);
  checks.submitted = 'UNVERIFIED';
  assert.equal(verificationResult(checks, false).exitCode, 2);
  checks.ibm = 'FAIL';
  assert.equal(verificationResult(checks, true).exitCode, 1);
});
