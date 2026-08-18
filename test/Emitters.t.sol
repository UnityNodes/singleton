// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Vm} from "forge-std/Test.sol";
import {SourceChain} from "./support/SourceChain.sol";
import {SingletonRegistry} from "../src/SingletonRegistry.sol";
import {RwaDeed} from "../src/emitters/RwaDeed.sol";
import {HarborCredit} from "../src/emitters/HarborCredit.sol";
import {MeridianCredit} from "../src/emitters/MeridianCredit.sol";

/**
 * The registry against the two real Sepolia lenders rather than hand written
 * logs: what Harbor and Meridian actually emit is what the registry actually
 * reads.
 */
contract EmittersTest is SourceChain {
    SingletonRegistry registry;
    RwaDeed deed;
    HarborCredit harbor;
    MeridianCredit meridian;

    function setUp() public {
        _installPrecompiles();

        deed = new RwaDeed();
        harbor = new HarborCredit();
        meridian = new MeridianCredit(address(this));

        deed.mint(BORROWER, TOKEN_ID);
        meridian.setCreditLimit(BORROWER, 1_000_000 ether);

        registry = new SingletonRegistry();
        registry.setMinConfirmations(SEPOLIA, MIN_CONF);
        registry.setEmitter(SEPOLIA, address(harbor), true);
        registry.setEmitter(SEPOLIA, address(meridian), true);
    }

    function _harborPledge(uint256 amount) internal returns (Vm.Log memory) {
        vm.recordLogs();
        vm.prank(BORROWER);
        harbor.openLien(address(deed), TOKEN_ID, amount);
        return _log(registry.PLEDGED_SIG());
    }

    function _meridianPledge(uint256 amount) internal returns (Vm.Log memory) {
        vm.recordLogs();
        vm.prank(BORROWER);
        meridian.drawAgainst(address(deed), TOKEN_ID, amount);
        return _log(registry.PLEDGED_SIG());
    }

    /// The two lenders agree on nothing except the shape of the log. If they
    /// stop agreeing, the registry silently sees one of them and not the other.
    function test_bothLendersEmitTheSignatureTheRegistryReads() public {
        Vm.Log memory fromHarbor = _harborPledge(1000 ether);
        Vm.Log memory fromMeridian = _meridianPledge(750 ether);

        assertEq(fromHarbor.topics[0], registry.PLEDGED_SIG(), "harbor signature");
        assertEq(fromMeridian.topics[0], registry.PLEDGED_SIG(), "meridian signature");
        assertEq(fromHarbor.topics.length, 4, "three indexed arguments");
        assertEq(fromMeridian.topics.length, 4, "three indexed arguments");
        assertEq(fromHarbor.data.length, 64, "amount and instance id");
        assertEq(fromMeridian.data.length, 64, "amount and instance id");
        assertTrue(fromHarbor.emitter != fromMeridian.emitter, "different contracts");
    }

    function test_realHarborPledgeIsRegistered() public {
        Vm.Log memory pledge = _harborPledge(1000 ether);
        bytes32 assetKey = registry.registerPledge(_relay(pledge));

        SingletonRegistry.Record memory r = registry.getStatus(assetKey);
        assertEq(uint8(r.state), uint8(SingletonRegistry.AssetState.PLEDGED));
        assertEq(r.emitter, address(harbor));
        assertEq(r.borrower, BORROWER);
        assertEq(r.amount, 1000 ether);
        assertEq(assetKey, registry.assetKeyOf(SEPOLIA, address(deed), TOKEN_ID));
    }

    /// The demo, end to end, off one asset and two lenders that never met.
    function test_secondLenderCollidesOnTheSameAsset() public {
        bytes32 assetKey = registry.registerPledge(_relay(_harborPledge(1000 ether)));

        SingletonRegistry.Proof memory second = _relay(_meridianPledge(750 ether));

        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.AssetNotFree.selector, assetKey, address(harbor)
            )
        );
        registry.registerPledge(second);

        assertEq(registry.getStatus(assetKey).emitter, address(harbor), "first to file holds");
    }

    /// Caveat 6 in executable form. Both liens exist on the source chain because
    /// neither lender takes the deed; that is what makes the collision possible
    /// at all.
    function test_bothPledgesAreNonCustodial() public {
        _harborPledge(1000 ether);
        _meridianPledge(750 ether);

        assertEq(deed.ownerOf(TOKEN_ID), BORROWER, "borrower still holds the asset");
        assertEq(uint8(harbor.lienState(address(deed), TOKEN_ID)), 1, "harbor lien open");
        assertEq(meridian.positionCount(), 1, "meridian position drawn");
    }

    function test_lendersRejectAPledgeFromANonHolder() public {
        address stranger = address(0xDEAD);
        meridian.setCreditLimit(stranger, 1_000 ether);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(HarborCredit.NotTheHolder.selector, BORROWER));
        harbor.openLien(address(deed), TOKEN_ID, 1 ether);

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(MeridianCredit.AssetNotHeldByObligor.selector, BORROWER)
        );
        meridian.drawAgainst(address(deed), TOKEN_ID, 1 ether);
    }
}
