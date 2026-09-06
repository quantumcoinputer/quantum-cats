// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICatRenderer {
    struct RenderData {
        uint256 tokenId;
        uint256 dna;
        bool revealed;
        string jobId;
        uint256 commitCount;
        bytes32 resultsHash;
        string backend;
        uint256 batchId;
        uint256 shotIndex;
        string archiveURI;
    }

    function tokenURI(RenderData memory d) external view returns (string memory);
}
