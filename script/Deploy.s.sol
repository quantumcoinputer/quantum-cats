// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CatRenderer} from "../contracts/CatRenderer.sol";
import {QuantumCats} from "../contracts/QuantumCats.sol";

/// Deploy:  forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
/// Env:     DEPLOYER_PRIVATE_KEY, ORACLE_ADDRESS, MAX_SUPPLY,
///          MINT_TOKEN_CA (optional — leave unset to plug in later via setMintToken)
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address oracleAddr = vm.envAddress("ORACLE_ADDRESS");
        uint256 maxSupply = vm.envOr("MAX_SUPPLY", uint256(10_000));
        address mintToken = vm.envOr("MINT_TOKEN_CA", address(0));

        vm.startBroadcast(pk);
        CatRenderer renderer = new CatRenderer();
        QuantumCats cats = new QuantumCats(address(renderer), oracleAddr, maxSupply);
        if (mintToken != address(0)) {
            cats.setMintToken(mintToken);
        }
        vm.stopBroadcast();

        console2.log("CatRenderer:", address(renderer));
        console2.log("QuantumCats:", address(cats));
        if (mintToken == address(0)) {
            console2.log("Mint token NOT set. Plug in the CA later:");
            console2.log("  cast send <QuantumCats> 'setMintToken(address)' <ERC20_CA>");
        }
    }
}
