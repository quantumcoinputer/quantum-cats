// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {ICatRenderer} from "./interfaces/ICatRenderer.sol";

/// @title QuantumCats
/// @notice Quantum-collapsed pixel cats — batched lifecycle:
///
///   1. mint()            — 100,000 units of the mint token are sent to 0xdEaD
///                          (irrecoverable sink; the ERC20 totalSupply is not
///                          reduced). Minter receives a sealed box.
///   2. sealBatch()       — every ~30 minutes the oracle seals all unbatched
///                          mints into one contiguous batch on-chain FIRST:
///                          the token range and the sha256 of the canonical
///                          circuit descriptor (configHash). Shot assignments
///                          (shotIndex = tokenId - startId) are therefore fixed
///                          BEFORE any job is even submitted.
///   2b. bindJob()        — only after the seal confirms does the oracle submit
///                          the job and bind keccak256(jobId). A job hash can
///                          only ever bind to one batch; every re-bind after a
///                          failed job increments a public counter.
///   3. resolveBatch()    — when the QPU results land, the oracle binds the
///                          plaintext jobId (checked against the commitment),
///                          the backend name, and the sha256 of the canonical
///                          archived results document (all ordered shots + the
///                          experiment descriptor + IBM timestamps).
///   4. revealBatch()     — every token in the batch receives its own 38-bit
///                          DNA: shot[shotIndex] of the job. One collapse, one
///                          cat; the batch is the shared experiment run.
///
/// Job shopping is constrained and auditable, not impossible: execution
/// timestamps vs seal time are checked by the off-chain verifier. All art and
/// metadata are on-chain; verification works from the public archive (hash
/// bound here) without any IBM account.
contract QuantumCats {
    // ─── ERC-721 core ───────────────────────────────────────────────
    string public constant name = "Quantum Cats";
    string public constant symbol = "QCAT";

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    mapping(uint256 => address) internal _ownerOf;
    mapping(address => uint256) internal _balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    // ─── collection state ───────────────────────────────────────────
    struct Token {
        uint40 dna;      // 38-bit measurement: shot[shotIndex] of the batch job
        uint40 mintedAt;
        bool revealed;
    }

    struct Batch {
        uint64 startId;      // tokens [startId..endId]; shotIndex = tokenId - startId
        uint64 endId;
        uint16 commitCount;  // job binds (re-rolls) for this batch — publicly visible
        bool resolved;
        bytes32 jobIdHash;   // keccak256(jobId), bound AFTER the seal fixed assignments
        bytes32 configHash;  // sha256 of the canonical circuit/experiment descriptor
        bytes32 resultsHash; // sha256 of the canonical archived results document
        string jobId;        // plaintext, set at resolve — the provenance receipt
        string backend;      // QPU that ran the batch (e.g. "ibm_fez")
        string archiveURI;   // WHERE the hash-bound archive lives (availability
                             // pointer only — the resultsHash is the identity;
                             // owner may repoint it if a host dies)
    }

    mapping(uint256 => Token) internal _tokens;
    mapping(uint256 => Batch) internal _batches;   // 1-indexed
    uint256 public batchCount;
    uint256 public lastBatchedId; // highest tokenId included in any batch
    /// a job id hash can only ever bind to one batch — no job reuse
    mapping(bytes32 => uint256) public jobBoundTo;

    uint256 public totalSupply;
    uint256 public totalMinted;
    uint256 public immutable maxSupply;
    uint256 public constant MINT_UNITS = 100_000; // x 10**decimals of the mint token
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    address public owner;
    address public oracle;
    ICatRenderer public renderer;
    bool public rendererFrozen;

    // The single plug-in field: set once when the ERC20 CA is known, locked forever.
    IERC20 public mintToken;
    uint256 public mintPrice;

    event Minted(uint256 indexed tokenId, address indexed minter, uint256 burned);
    event BatchSealed(uint256 indexed batchId, uint64 startId, uint64 endId, bytes32 configHash);
    event JobBound(uint256 indexed batchId, bytes32 jobIdHash, uint16 commitCount);
    event BatchResolved(uint256 indexed batchId, string jobId, bytes32 resultsHash, string backend, string archiveURI);
    event ArchivePointerUpdated(uint256 indexed batchId, string archiveURI);
    event Revealed(uint256 indexed tokenId, uint256 indexed batchId, uint256 shotIndex, uint256 dna);
    event MintTokenSet(address indexed token, uint256 price);

    error NotOwner();
    error NotOracle();
    error MintTokenUnset();
    error MintTokenAlreadySet();
    error SoldOut();
    error Nonexistent();
    error AlreadyRevealed();
    error AlreadyResolved();
    error NotResolved();
    error BadBatchRange();
    error NoCommit();
    error JobIdMismatch();
    error JobAlreadyUsed();
    error BadJobId();
    error BadDna();
    error BadLength();
    error RendererIsFrozen();
    error NotAuthorized();
    error WrongFrom();
    error ZeroAddress();
    error UnsafeRecipient();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier onlyOracle() { if (msg.sender != oracle) revert NotOracle(); _; }

    constructor(address renderer_, address oracle_, uint256 maxSupply_) {
        owner = msg.sender;
        renderer = ICatRenderer(renderer_);
        oracle = oracle_;
        maxSupply = maxSupply_;
    }

    // ─── admin ──────────────────────────────────────────────────────

    /// @notice THE plug-in. Call once with the ERC20 contract address; price
    /// becomes 100,000 whole tokens (respecting its decimals) and can never change.
    function setMintToken(address token) external onlyOwner {
        if (address(mintToken) != address(0)) revert MintTokenAlreadySet();
        if (token == address(0)) revert ZeroAddress();
        mintToken = IERC20(token);
        mintPrice = MINT_UNITS * (10 ** IERC20(token).decimals());
        emit MintTokenSet(token, mintPrice);
    }

    function setOracle(address oracle_) external onlyOwner { oracle = oracle_; }
    function transferOwnership(address newOwner) external onlyOwner { owner = newOwner; }

    function setRenderer(address renderer_) external onlyOwner {
        if (rendererFrozen) revert RendererIsFrozen();
        renderer = ICatRenderer(renderer_);
    }

    function freezeRenderer() external onlyOwner { rendererFrozen = true; }

    // ─── mint ───────────────────────────────────────────────────────

    function mint() external returns (uint256 tokenId) {
        if (address(mintToken) == address(0)) revert MintTokenUnset();
        if (totalMinted >= maxSupply) revert SoldOut();

        tokenId = ++totalMinted;
        totalSupply++;
        _tokens[tokenId].mintedAt = uint40(block.timestamp);
        _mint(msg.sender, tokenId);
        emit Minted(tokenId, msg.sender, mintPrice);

        // irrecoverable sink transfer — no escrow, no treasury, no way back
        require(mintToken.transferFrom(msg.sender, BURN_ADDRESS, mintPrice), "BURN_FAILED");
    }

    // ─── batch lifecycle ────────────────────────────────────────────

    /// @notice Seal the next contiguous range of minted tokens and fix the
    /// circuit identity — BEFORE any job is submitted. Shot assignments
    /// (shotIndex = tokenId - startId) become immutable here.
    function sealBatch(uint64 startId, uint64 endId, bytes32 configHash)
        external
        onlyOracle
        returns (uint256 batchId)
    {
        if (startId != lastBatchedId + 1 || endId < startId || endId > totalMinted) revert BadBatchRange();
        if (configHash == bytes32(0)) revert JobIdMismatch();

        batchId = ++batchCount;
        lastBatchedId = endId;
        Batch storage b = _batches[batchId];
        b.startId = startId;
        b.endId = endId;
        b.configHash = configHash;
        emit BatchSealed(batchId, startId, endId, configHash);
    }

    /// @notice Bind the submitted job to a sealed batch (and re-bind after a
    /// failed/cancelled job). Publicly counted — a re-roll can never be hidden.
    function bindJob(uint256 batchId, bytes32 jobIdHash) external onlyOracle {
        Batch storage b = _batches[batchId];
        if (b.startId == 0) revert Nonexistent();
        if (b.resolved) revert AlreadyResolved();
        if (jobIdHash == bytes32(0)) revert JobIdMismatch();
        if (jobBoundTo[jobIdHash] != 0) revert JobAlreadyUsed();
        jobBoundTo[jobIdHash] = batchId;
        b.jobIdHash = jobIdHash;
        b.commitCount++;
        emit JobBound(batchId, jobIdHash, b.commitCount);
    }

    /// @notice Bind the completed job plaintext id, backend, and the hash of
    /// the canonical archived results document.
    function resolveBatch(
        uint256 batchId,
        string calldata jobId,
        bytes32 resultsHash,
        string calldata backend,
        string calldata archiveURI
    ) external onlyOracle {
        Batch storage b = _batches[batchId];
        if (b.startId == 0) revert Nonexistent();
        if (b.resolved) revert AlreadyResolved();
        if (b.jobIdHash == bytes32(0)) revert NoCommit();
        if (keccak256(bytes(jobId)) != b.jobIdHash) revert JobIdMismatch();
        if (resultsHash == bytes32(0)) revert BadDna();
        _validateAscii(bytes(jobId), 64);
        _validateAscii(bytes(backend), 32);
        _validateUri(bytes(archiveURI));

        b.jobId = jobId;
        b.resultsHash = resultsHash;
        b.backend = backend;
        b.archiveURI = archiveURI;
        b.resolved = true;
        emit BatchResolved(batchId, jobId, resultsHash, backend, archiveURI);
    }

    /// @notice Availability-only repoint of a batch's archive location (host
    /// migration). The resultsHash remains the archive's immutable identity —
    /// this cannot alter what the archive must contain.
    function updateArchivePointer(uint256 batchId, string calldata archiveURI) external onlyOwner {
        Batch storage b = _batches[batchId];
        if (b.startId == 0) revert Nonexistent();
        if (!b.resolved) revert NotResolved();
        _validateUri(bytes(archiveURI));
        b.archiveURI = archiveURI;
        emit ArchivePointerUpdated(batchId, archiveURI);
    }

    /// @dev URI charset: printable ASCII minus quote/backslash (JSON-safe)
    function _validateUri(bytes memory s_) internal pure {
        if (s_.length == 0 || s_.length > 200) revert BadJobId();
        for (uint256 i = 0; i < s_.length; i++) {
            bytes1 c = s_[i];
            if (c < 0x20 || c > 0x7e || c == '"' || c == "\\") revert BadJobId();
        }
    }

    /// @notice Reveal every token in a resolved batch. dnas[i] is the 38-bit
    /// measurement at shot index i (token startId + i).
    function revealBatch(uint256 batchId, uint40[] calldata dnas) external onlyOracle {
        Batch storage b = _batches[batchId];
        if (b.startId == 0) revert Nonexistent();
        if (!b.resolved) revert NotResolved();
        uint256 size = b.endId - b.startId + 1;
        if (dnas.length != size) revert BadLength();

        for (uint256 i = 0; i < size; i++) {
            uint256 tokenId = b.startId + i;
            Token storage t = _tokens[tokenId];
            if (t.revealed) revert AlreadyRevealed();
            if (dnas[i] >= 1 << 38) revert BadDna();
            t.dna = dnas[i];
            t.revealed = true;
            emit Revealed(tokenId, batchId, i, dnas[i]);
        }
    }

    /// @dev lowercase alphanumeric + underscore + dash only, non-empty, bounded —
    /// these strings are interpolated into tokenURI JSON, keep them injection-proof
    function _validateAscii(bytes memory s_, uint256 maxLen) internal pure {
        if (s_.length == 0 || s_.length > maxLen) revert BadJobId();
        for (uint256 i = 0; i < s_.length; i++) {
            bytes1 c = s_[i];
            bool ok = (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "_" || c == "-";
            if (!ok) revert BadJobId();
        }
    }

    // ─── views ──────────────────────────────────────────────────────

    /// @notice Which batch a token belongs to (0 if not yet batched).
    /// Batches are contiguous ordered ranges — binary search, view-only.
    function batchOf(uint256 tokenId) public view returns (uint256) {
        if (tokenId == 0 || tokenId > lastBatchedId) return 0;
        uint256 lo = 1;
        uint256 hi = batchCount;
        while (lo <= hi) {
            uint256 mid = (lo + hi) / 2;
            Batch storage b = _batches[mid];
            if (tokenId < b.startId) hi = mid - 1;
            else if (tokenId > b.endId) lo = mid + 1;
            else return mid;
        }
        return 0;
    }

    function getBatch(uint256 batchId)
        external
        view
        returns (
            uint64 startId,
            uint64 endId,
            bytes32 jobIdHash,
            bytes32 configHash,
            bytes32 resultsHash,
            string memory jobId,
            string memory backend,
            uint16 commitCount,
            bool resolved,
            string memory archiveURI
        )
    {
        Batch storage b = _batches[batchId];
        if (b.startId == 0) revert Nonexistent();
        return (b.startId, b.endId, b.jobIdHash, b.configHash, b.resultsHash,
                b.jobId, b.backend, b.commitCount, b.resolved, b.archiveURI);
    }

    function getToken(uint256 tokenId)
        external
        view
        returns (uint256 dna, bool revealed, uint40 mintedAt, uint256 batchId, uint256 shotIndex)
    {
        if (_ownerOf[tokenId] == address(0)) revert Nonexistent();
        Token storage t = _tokens[tokenId];
        batchId = batchOf(tokenId);
        shotIndex = batchId == 0 ? 0 : tokenId - _batches[batchId].startId;
        return (t.dna, t.revealed, t.mintedAt, batchId, shotIndex);
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (_ownerOf[tokenId] == address(0)) revert Nonexistent();
        Token storage t = _tokens[tokenId];
        uint256 batchId = batchOf(tokenId);
        Batch storage b = _batches[batchId]; // zero-struct when unbatched
        return renderer.tokenURI(ICatRenderer.RenderData({
            tokenId: tokenId,
            dna: t.dna,
            revealed: t.revealed,
            jobId: b.jobId,
            commitCount: b.commitCount,
            resultsHash: b.resultsHash,
            backend: b.backend,
            batchId: batchId,
            shotIndex: batchId == 0 ? 0 : tokenId - b.startId,
            archiveURI: b.archiveURI
        }));
    }

    // ─── ERC-721 implementation ─────────────────────────────────────

    function balanceOf(address account) external view returns (uint256) {
        if (account == address(0)) revert ZeroAddress();
        return _balanceOf[account];
    }

    function ownerOf(uint256 tokenId) public view returns (address account) {
        account = _ownerOf[tokenId];
        if (account == address(0)) revert Nonexistent();
    }

    function approve(address spender, uint256 tokenId) external {
        address holder = _ownerOf[tokenId];
        if (msg.sender != holder && !isApprovedForAll[holder][msg.sender]) revert NotAuthorized();
        getApproved[tokenId] = spender;
        emit Approval(holder, spender, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (from != _ownerOf[tokenId]) revert WrongFrom();
        if (to == address(0)) revert ZeroAddress();
        if (msg.sender != from && !isApprovedForAll[from][msg.sender] && msg.sender != getApproved[tokenId]) {
            revert NotAuthorized();
        }
        _balanceOf[from]--;
        _balanceOf[to]++;
        _ownerOf[tokenId] = to;
        delete getApproved[tokenId];
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        if (to.code.length != 0) {
            if (
                IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data)
                    != IERC721Receiver.onERC721Received.selector
            ) revert UnsafeRecipient();
        }
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0x80ac58cd // ERC-721
            || interfaceId == 0x5b5e139f; // ERC-721 Metadata
    }

    function _mint(address to, uint256 tokenId) internal {
        _balanceOf[to]++;
        _ownerOf[tokenId] = to;
        emit Transfer(address(0), to, tokenId);
    }
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}
