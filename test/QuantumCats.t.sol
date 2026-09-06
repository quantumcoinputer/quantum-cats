// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {QuantumCats} from "../contracts/QuantumCats.sol";
import {CatRenderer} from "../contracts/CatRenderer.sol";

contract MockERC20 {
    string public name = "Mock";
    string public symbol = "MOCK";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}

contract NonReceiver {}

contract QuantumCatsTest is Test {
    QuantumCats cats;
    CatRenderer renderer;
    MockERC20 token;

    address oracle = address(0x0AC1E);
    address alice = address(0xA11CE);

    uint40 constant SCHROD_DNA = uint40((((0x3 << 28) | (0x2 << 24) | (0x5 << 14) | (0x7 << 5) | 0x1f) << 8) | 0xB3);
    uint40 constant PLAIN_DNA = 0;
    uint40 constant BUSY_DNA = uint40((((0x2 << 28) | (0x2 << 26) | (0x3 << 24) | (0x1 << 23) | (0x3 << 21)
        | (0x7 << 18) | (0xf << 14) | (0x7 << 11) | (0x7 << 8) | (0x5 << 5)) << 8) | 0x5A);

    string constant JOB_ID = "daeh8etnj4cs73af5jj0";
    bytes32 constant RESULTS_HASH = keccak256("canonical-results-json");
    bytes32 constant CONFIG_HASH = keccak256("canonical-experiment-descriptor");
    string constant BACKEND = "ibm_fez";
    string constant ARCHIVE_URI = "ipfs://bafybeigdyrexample/job-daeh8etnj4cs73af5jj0.json";

    function setUp() public {
        renderer = new CatRenderer();
        cats = new QuantumCats(address(renderer), oracle, 10_000);
        token = new MockERC20();
        cats.setMintToken(address(token));
        token.mint(alice, 10_000_000e18);
        vm.prank(alice);
        token.approve(address(cats), type(uint256).max);
    }

    function _mintN(uint256 n) internal {
        vm.startPrank(alice);
        for (uint256 i = 0; i < n; i++) cats.mint();
        vm.stopPrank();
    }

    function _sealResolve(uint64 startId, uint64 endId, string memory jobId) internal returns (uint256 batchId) {
        vm.startPrank(oracle);
        batchId = cats.sealBatch(startId, endId, CONFIG_HASH);
        cats.bindJob(batchId, keccak256(bytes(jobId)));
        cats.resolveBatch(batchId, jobId, RESULTS_HASH, BACKEND, ARCHIVE_URI);
        vm.stopPrank();
    }

    // ─── payment ────────────────────────────────────────────────────

    function testMintBurnsPaymentForever() public {
        _mintN(1);
        assertEq(cats.ownerOf(1), alice);
        assertEq(token.balanceOf(cats.BURN_ADDRESS()), 100_000e18);
        assertEq(token.balanceOf(address(cats)), 0);
        assertEq(cats.totalSupply(), 1);
    }

    function testMintPriceUsesDecimals() public view {
        assertEq(cats.mintPrice(), 100_000 * 1e18);
    }

    function testMintTokenIsSingleUse() public {
        vm.expectRevert(QuantumCats.MintTokenAlreadySet.selector);
        cats.setMintToken(address(token));
    }

    function testMintRevertsWithoutToken() public {
        QuantumCats bare = new QuantumCats(address(renderer), oracle, 10);
        vm.expectRevert(QuantumCats.MintTokenUnset.selector);
        bare.mint();
    }

    function testMaxSupply() public {
        QuantumCats small = new QuantumCats(address(renderer), oracle, 1);
        small.setMintToken(address(token));
        vm.startPrank(alice);
        token.approve(address(small), type(uint256).max);
        small.mint();
        vm.expectRevert(QuantumCats.SoldOut.selector);
        small.mint();
        vm.stopPrank();
    }

    // ─── batch lifecycle ────────────────────────────────────────────

    function testFullBatchLifecycle() public {
        _mintN(3);
        uint256 batchId = _sealResolve(1, 3, JOB_ID);

        uint40[] memory dnas = new uint40[](3);
        dnas[0] = SCHROD_DNA;
        dnas[1] = PLAIN_DNA;
        dnas[2] = BUSY_DNA;
        vm.prank(oracle);
        cats.revealBatch(batchId, dnas);

        (uint256 dna, bool revealed,, uint256 bId, uint256 shot) = cats.getToken(2);
        assertEq(dna, PLAIN_DNA);
        assertTrue(revealed);
        assertEq(bId, batchId);
        assertEq(shot, 1);

        (,,,,bytes32 rh, string memory jobId, string memory be, uint16 commits, bool resolved, string memory uri) = cats.getBatch(batchId);
        assertEq(rh, RESULTS_HASH);
        assertEq(jobId, JOB_ID);
        assertEq(be, BACKEND);
        assertEq(commits, 1);
        assertTrue(resolved);
        assertEq(uri, ARCHIVE_URI);
    }

    function testSealRequiresContiguousRange() public {
        _mintN(4);
        vm.startPrank(oracle);
        cats.sealBatch(1, 2, CONFIG_HASH);
        vm.expectRevert(QuantumCats.BadBatchRange.selector);
        cats.sealBatch(4, 4, CONFIG_HASH); // gap: must start at 3
        vm.expectRevert(QuantumCats.BadBatchRange.selector);
        cats.sealBatch(3, 5, CONFIG_HASH); // beyond totalMinted
        cats.sealBatch(3, 4, CONFIG_HASH);
        vm.stopPrank();
    }

    function testJobCannotBindTwoBatches() public {
        _mintN(2);
        vm.startPrank(oracle);
        uint256 a = cats.sealBatch(1, 1, CONFIG_HASH);
        uint256 b = cats.sealBatch(2, 2, CONFIG_HASH);
        cats.bindJob(a, keccak256(bytes(JOB_ID)));
        vm.expectRevert(QuantumCats.JobAlreadyUsed.selector);
        cats.bindJob(b, keccak256(bytes(JOB_ID)));
        vm.stopPrank();
    }

    function testRecommitIncrementsCounter() public {
        _mintN(1);
        vm.startPrank(oracle);
        uint256 b = cats.sealBatch(1, 1, CONFIG_HASH);
        cats.bindJob(b, keccak256("job-a"));
        cats.bindJob(b, keccak256("job-b"));
        vm.stopPrank();
        (,,,,,,, uint16 commits,,) = cats.getBatch(b);
        assertEq(commits, 2);
    }

    function testResolveRejectsWrongJobId() public {
        _mintN(1);
        vm.startPrank(oracle);
        uint256 b = cats.sealBatch(1, 1, CONFIG_HASH);
        cats.bindJob(b, keccak256(bytes(JOB_ID)));
        vm.expectRevert(QuantumCats.JobIdMismatch.selector);
        cats.resolveBatch(b, "some-other-job", RESULTS_HASH, BACKEND, ARCHIVE_URI);
        vm.stopPrank();
    }

    function testResolveRejectsBadCharset() public {
        _mintN(1);
        string memory evil = 'x","malicious":"1';
        vm.startPrank(oracle);
        uint256 b = cats.sealBatch(1, 1, CONFIG_HASH);
        cats.bindJob(b, keccak256(bytes(evil)));
        vm.expectRevert(QuantumCats.BadJobId.selector);
        cats.resolveBatch(b, evil, RESULTS_HASH, BACKEND, ARCHIVE_URI);
        vm.stopPrank();
    }

    function testResolveRequiresBind() public {
        _mintN(1);
        vm.startPrank(oracle);
        uint256 b = cats.sealBatch(1, 1, CONFIG_HASH);
        vm.expectRevert(QuantumCats.NoCommit.selector);
        cats.resolveBatch(b, JOB_ID, RESULTS_HASH, BACKEND, ARCHIVE_URI);
        vm.stopPrank();
    }

    function testRevealRequiresResolve() public {
        _mintN(1);
        vm.startPrank(oracle);
        uint256 b = cats.sealBatch(1, 1, CONFIG_HASH);
        cats.bindJob(b, keccak256(bytes(JOB_ID)));
        uint40[] memory dnas = new uint40[](1);
        vm.expectRevert(QuantumCats.NotResolved.selector);
        cats.revealBatch(b, dnas);
        vm.stopPrank();
    }

    function testRevealRejectsWrongLength() public {
        _mintN(2);
        uint256 b = _sealResolve(1, 2, JOB_ID);
        uint40[] memory dnas = new uint40[](1);
        vm.prank(oracle);
        vm.expectRevert(QuantumCats.BadLength.selector);
        cats.revealBatch(b, dnas);
    }

    function testRevealTwiceReverts() public {
        _mintN(1);
        uint256 b = _sealResolve(1, 1, JOB_ID);
        uint40[] memory dnas = new uint40[](1);
        dnas[0] = PLAIN_DNA;
        vm.startPrank(oracle);
        cats.revealBatch(b, dnas);
        vm.expectRevert(QuantumCats.AlreadyRevealed.selector);
        cats.revealBatch(b, dnas);
        vm.stopPrank();
    }

    function testOnlyOracle() public {
        _mintN(1);
        vm.expectRevert(QuantumCats.NotOracle.selector);
        cats.sealBatch(1, 1, CONFIG_HASH);
        vm.expectRevert(QuantumCats.NotOracle.selector);
        cats.resolveBatch(1, JOB_ID, RESULTS_HASH, BACKEND, ARCHIVE_URI);
    }

    function testArchivePointerUpdate() public {
        _mintN(1);
        uint256 b = _sealResolve(1, 1, JOB_ID);
        cats.updateArchivePointer(b, "https://mirror.example/job.json");
        (,,,,,,,,, string memory uri) = cats.getBatch(b);
        assertEq(uri, "https://mirror.example/job.json");
        vm.prank(address(0xBAD));
        vm.expectRevert(QuantumCats.NotOwner.selector);
        cats.updateArchivePointer(b, "x://y");
    }

    function testRevealedTokenURICarriesArchive() public {
        _mintN(1);
        uint256 b = _sealResolve(1, 1, JOB_ID);
        uint40[] memory dnas = new uint40[](1);
        dnas[0] = PLAIN_DNA;
        vm.prank(oracle);
        cats.revealBatch(b, dnas);
        string memory json = string(_b64decode(_stripPrefix(cats.tokenURI(1), 29)));
        assertTrue(_contains(json, '"Archive","value":"ipfs://bafybeigdyrexample'));
    }

    function testBatchOfBinarySearch() public {
        _mintN(10);
        vm.startPrank(oracle);
        cats.sealBatch(1, 3, CONFIG_HASH);
        cats.sealBatch(4, 4, CONFIG_HASH);
        cats.sealBatch(5, 9, CONFIG_HASH);
        vm.stopPrank();
        assertEq(cats.batchOf(1), 1);
        assertEq(cats.batchOf(3), 1);
        assertEq(cats.batchOf(4), 2);
        assertEq(cats.batchOf(5), 3);
        assertEq(cats.batchOf(9), 3);
        assertEq(cats.batchOf(10), 0); // unbatched
    }

    // ─── metadata ───────────────────────────────────────────────────

    function testBoxedTokenURI() public {
        _mintN(1);
        string memory json = string(_b64decode(_stripPrefix(cats.tokenURI(1), 29)));
        assertTrue(_contains(json, "SUPERPOSITION"));
        assertTrue(_contains(json, '"Job Committed","value":"No"'));
    }

    function testRevealedTokenURICarriesFullProvenance() public {
        _mintN(2);
        uint256 b = _sealResolve(1, 2, JOB_ID);
        uint40[] memory dnas = new uint40[](2);
        dnas[0] = PLAIN_DNA;
        dnas[1] = SCHROD_DNA;
        vm.prank(oracle);
        cats.revealBatch(b, dnas);

        string memory json = string(_b64decode(_stripPrefix(cats.tokenURI(2), 29)));
        assertTrue(_contains(json, JOB_ID));
        assertTrue(_contains(json, '"Backend","value":"ibm_fez"'));
        assertTrue(_contains(json, '"Batch","value":"1"'));
        assertTrue(_contains(json, '"Shot Index","value":"1"'));
        assertTrue(_contains(json, '"Results Hash","value":"'));
        assertTrue(_contains(json, '"Schrodinger","value":"Yes"'));
        assertTrue(_contains(json, '"Fur","value":"Orange"'));
        assertTrue(_contains(json, "data:image/svg+xml;base64,"));
    }

    function testTraitDecodePlain() public {
        _mintN(1);
        uint256 b = _sealResolve(1, 1, JOB_ID);
        uint40[] memory dnas = new uint40[](1);
        dnas[0] = PLAIN_DNA;
        vm.prank(oracle);
        cats.revealBatch(b, dnas);
        string memory json = string(_b64decode(_stripPrefix(cats.tokenURI(1), 29)));
        assertTrue(_contains(json, '"Ear Shape","value":"Pointed"'));
        assertTrue(_contains(json, '"Fur","value":"Gray"'));
        assertTrue(_contains(json, '"Schrodinger","value":"No"'));
    }

    // ─── ERC-721 surface ────────────────────────────────────────────

    function testTransferAndApprovals() public {
        _mintN(1);
        address bob = address(0xB0B);
        vm.prank(alice);
        cats.transferFrom(alice, bob, 1);
        assertEq(cats.ownerOf(1), bob);
        vm.expectRevert(QuantumCats.NotAuthorized.selector);
        cats.transferFrom(bob, alice, 1);
    }

    function testApprovedSpenderCanTransfer() public {
        _mintN(1);
        address spender = address(0x5E11);
        vm.prank(alice);
        cats.approve(spender, 1);
        vm.prank(spender);
        cats.transferFrom(alice, spender, 1);
        assertEq(cats.ownerOf(1), spender);
        assertEq(cats.getApproved(1), address(0));
    }

    function testOperatorApprovalForAll() public {
        _mintN(1);
        address op = address(0x0FA);
        vm.prank(alice);
        cats.setApprovalForAll(op, true);
        vm.prank(op);
        cats.transferFrom(alice, op, 1);
        assertEq(cats.ownerOf(1), op);
    }

    function testSafeTransferCallback() public {
        _mintN(1);
        Receiver r = new Receiver();
        vm.prank(alice);
        cats.safeTransferFrom(alice, address(r), 1);
        assertEq(cats.ownerOf(1), address(r));
    }

    function testSafeTransferToNonReceiverReverts() public {
        _mintN(1);
        NonReceiver n = new NonReceiver();
        vm.prank(alice);
        vm.expectRevert();
        cats.safeTransferFrom(alice, address(n), 1);
    }

    /// dumps SVGs for offline pixel-diff against the reference renderer
    function testDumpSvgs() public {
        vm.writeFile("out-svg/schrod.svg", renderer.svg(SCHROD_DNA));
        vm.writeFile("out-svg/plain.svg", renderer.svg(PLAIN_DNA));
        vm.writeFile("out-svg/busy.svg", renderer.svg(BUSY_DNA));
        vm.writeFile("out-svg/box.svg", renderer.boxSvg());
    }

    // ─── helpers ────────────────────────────────────────────────────

    function _contains(string memory hay, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) { ok = false; break; }
            }
            if (ok) return true;
        }
        return false;
    }

    function _stripPrefix(string memory s, uint256 len) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory p = new bytes(b.length - len);
        for (uint256 i = len; i < b.length; i++) p[i - len] = b[i];
        return string(p);
    }

    function _b64decode(string memory s) internal pure returns (bytes memory) {
        bytes memory data = bytes(s);
        uint256 pad;
        if (data.length > 0 && data[data.length - 1] == "=") pad++;
        if (data.length > 1 && data[data.length - 2] == "=") pad++;
        bytes memory out = new bytes(data.length / 4 * 3 - pad);
        uint256 o;
        for (uint256 i = 0; i < data.length; i += 4) {
            uint256 chunk = (_dec(data[i]) << 18) | (_dec(data[i + 1]) << 12)
                | (_dec(data[i + 2]) << 6) | _dec(data[i + 3]);
            if (o < out.length) out[o++] = bytes1(uint8(chunk >> 16));
            if (o < out.length) out[o++] = bytes1(uint8(chunk >> 8));
            if (o < out.length) out[o++] = bytes1(uint8(chunk));
        }
        return out;
    }

    function _dec(bytes1 c) internal pure returns (uint256) {
        uint8 u = uint8(c);
        if (u >= 65 && u <= 90) return u - 65;
        if (u >= 97 && u <= 122) return u - 71;
        if (u >= 48 && u <= 57) return u + 4;
        if (u == 43) return 62;
        if (u == 47) return 63;
        return 0; // '='
    }
}
