// Compares IBM-sourced fields only. The logical experiment descriptor is our
// publication and is verified separately against the on-chain configHash.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
const sha = value => createHash('sha256').update(value).digest('hex');
export function compareIbmRecord(archive, fresh) {
  const different = [], unavailable = [];
  for (const key of ['jobId', 'backend', 'shots', 'bitstrings']) {
    if (fresh[key] == null || archive[key] == null) unavailable.push(key);
    else if (!isDeepStrictEqual(archive[key], fresh[key])) different.push(key);
  }
  for (const key of ['created', 'running', 'finished']) {
    const a = archive.timestamps?.[key], b = fresh.timestamps?.[key];
    if (!a || !b || !Number.isFinite(Date.parse(a)) || !Number.isFinite(Date.parse(b))) unavailable.push(`timestamps.${key}`);
    else if (Date.parse(a) !== Date.parse(b)) different.push(`timestamps.${key}`);
  }
  for (const [label, doc] of [['archive', archive], ['IBM', fresh]]) {
    const sub = doc.submitted;
    if (!sub || typeof sub.isaQasm3 !== 'string' || !sub.isaQasm3.length || !sub.options || sub.isaNumQubits == null) unavailable.push(`${label} submitted circuit`);
    else if (sha(sub.isaQasm3) !== sub.isaQasm3Sha256) different.push(`${label} ISA hash`);
  }
  if (!unavailable.some(k => k.includes('submitted circuit'))) {
    for (const key of ['isaQasm3', 'isaNumQubits', 'options']) {
      if (!isDeepStrictEqual(archive.submitted[key], fresh.submitted[key])) different.push(`submitted.${key}`);
    }
  }
  if (different.length) return `FAIL (fresh IBM record differs: ${different.join(', ')}; circuit serialization differences need investigation)`;
  if (unavailable.length) return `INCONCLUSIVE (missing fields: ${unavailable.join(', ')})`;
  return `PASS (all ${archive.shots} ordered shots, job, backend, timestamps, and submitted circuit match a fresh IBM retrieval)`;
}

export function verificationResult(checks, liveRequested) {
  if (Object.values(checks).some(v => String(v).startsWith('FAIL'))) return { exitCode: 1, message: 'FAILED: one or more records disagree.' };
  const incomplete = ['integrity', 'dna', 'backend', 'circuit', 'ordering', 'submitted'].some(k => !String(checks[k]).startsWith('PASS'))
    || String(checks.circuit).includes('unavailable')
    || (liveRequested && !String(checks.ibm).startsWith('PASS'));
  if (incomplete) return { exitCode: 2, message: 'INCOMPLETE: review the unavailable or inconclusive checks above.' };
  if (liveRequested) return { exitCode: 0, message: 'VERIFIED: record consistency and live IBM retrieval match. IBM remains the trusted hardware provider.' };
  return { exitCode: 0, message: 'VERIFIED: published-record consistency. IBM authorship was not independently checked; use --ibm with instance read access.' };
}
