// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {RwaDeed} from "../src/emitters/RwaDeed.sol";
import {HarborCredit} from "../src/emitters/HarborCredit.sol";
import {MeridianCredit} from "../src/emitters/MeridianCredit.sol";

/**
 * Deploys the source-chain half of the demo on Sepolia: one tokenised asset and
 * two lenders that have never heard of each other.
 *
 * BORROWER holds the deed and draws from both. It defaults to the deployer so a
 * single funded key is enough for the whole demo.
 *
 *   forge script script/DeploySepolia.s.sol:DeploySepolia \
 *     --rpc-url $SEPOLIA_RPC --broadcast --private-key $PK
 */
contract DeploySepolia is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address borrower = vm.envOr("BORROWER", deployer);
        uint256 tokenId = vm.envOr("TOKEN_ID", uint256(42));
        uint256 creditLimit = vm.envOr("CREDIT_LIMIT", uint256(1_000_000 ether));

        vm.startBroadcast(pk);

        RwaDeed deed = new RwaDeed();
        HarborCredit harbor = new HarborCredit();
        MeridianCredit meridian = new MeridianCredit(deployer);

        deed.mint(borrower, tokenId);
        meridian.setCreditLimit(borrower, creditLimit);

        vm.stopBroadcast();

        console.log("deed     ", address(deed));
        console.log("harbor   ", address(harbor));
        console.log("meridian ", address(meridian));
        console.log("borrower ", borrower);
        console.log("tokenId  ", tokenId);
    }
}
