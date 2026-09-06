// Publish/retry one resolved batch using its on-chain archive and circuit hashes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createPublicClient, http, parseAbi } from 'viem';
import { publishArchive, validatePublication } from '../oracle/publish-archive.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
try {
  for (const line of readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch { /* environment-only use */ }
if (!/^[1-9][0-9]*$/.test(process.argv[2] || '')) throw new Error('Usage: node script/publish-archive.mjs <batchId> [--dry-run]');
if (!process.env.RPC_URL || !process.env.CONTRACT_ADDRESS) throw new Error('Set RPC_URL and CONTRACT_ADDRESS');
const pub = createPublicClient({ transport: http(process.env.RPC_URL) });
// The first nine return fields are shared by both deployed batch interfaces.
const abi = parseAbi(['function getBatch(uint256) view returns(uint64,uint64,bytes32,bytes32,bytes32,string,string,uint16,bool)']);
const batch = await pub.readContract({ address: process.env.CONTRACT_ADDRESS, abi, functionName: 'getBatch', args: [BigInt(process.argv[2])] });
if (!batch[8]) throw new Error('Batch is not resolved on-chain');
const options = { jobId: batch[5], resultsHash: batch[4], configHash: batch[3],
  archiveDir: path.resolve(root, process.env.ARCHIVE_DIR || 'archive'),
  repository: process.env.ARCHIVE_GITHUB_REPO,
  branch: process.env.ARCHIVE_GITHUB_BRANCH || 'main' };
if (process.argv.includes('--dry-run')) {
  const blob = validatePublication(options);
  console.log(`Validated batch ${process.argv[2]}: job ${options.jobId}, ${blob.length} bytes match the on-chain hashes. No publication performed.`);
} else console.log(await publishArchive(options));
