export const CATS_ABI = [
  { type: "function", name: "totalMinted", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "lastBatchedId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "batchCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function", name: "jobBoundTo", stateMutability: "view",
    inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "getBatch", stateMutability: "view",
    inputs: [{ name: "batchId", type: "uint256" }],
    outputs: [
      { name: "startId", type: "uint64" },
      { name: "endId", type: "uint64" },
      { name: "jobIdHash", type: "bytes32" },
      { name: "configHash", type: "bytes32" },
      { name: "resultsHash", type: "bytes32" },
      { name: "jobId", type: "string" },
      { name: "backend", type: "string" },
      { name: "commitCount", type: "uint16" },
      { name: "resolved", type: "bool" },
      { name: "archiveURI", type: "string" },
    ],
  },
  {
    type: "function", name: "getToken", stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "dna", type: "uint256" },
      { name: "revealed", type: "bool" },
      { name: "mintedAt", type: "uint40" },
      { name: "batchId", type: "uint256" },
      { name: "shotIndex", type: "uint256" },
    ],
  },
  {
    type: "function", name: "sealBatch", stateMutability: "nonpayable",
    inputs: [
      { name: "startId", type: "uint64" }, { name: "endId", type: "uint64" },
      { name: "configHash", type: "bytes32" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "bindJob", stateMutability: "nonpayable",
    inputs: [{ name: "batchId", type: "uint256" }, { name: "jobIdHash", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function", name: "resolveBatch", stateMutability: "nonpayable",
    inputs: [
      { name: "batchId", type: "uint256" }, { name: "jobId", type: "string" },
      { name: "resultsHash", type: "bytes32" }, { name: "backend", type: "string" },
      { name: "archiveURI", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function", name: "revealBatch", stateMutability: "nonpayable",
    inputs: [{ name: "batchId", type: "uint256" }, { name: "dnas", type: "uint40[]" }],
    outputs: [],
  },
  {
    type: "event", name: "BatchSealed",
    inputs: [
      { name: "batchId", type: "uint256", indexed: true },
      { name: "startId", type: "uint64", indexed: false },
      { name: "endId", type: "uint64", indexed: false },
      { name: "configHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event", name: "JobBound",
    inputs: [
      { name: "batchId", type: "uint256", indexed: true },
      { name: "jobIdHash", type: "bytes32", indexed: false },
      { name: "commitCount", type: "uint16", indexed: false },
    ],
  },
];
