// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Vm} from "forge-std/Test.sol";
import {SourceChain} from "./support/SourceChain.sol";
import {SingletonRegistry} from "../src/SingletonRegistry.sol";
import {RwaDeed} from "../src/emitters/RwaDeed.sol";
import {HarborCredit} from "../src/emitters/HarborCredit.sol";
import {MeridianCredit} from "../src/emitters/MeridianCredit.sol";

/**
 * One asset through its whole life, each transition carried by its own proof of
 * its own real log: pledge, refused second pledge, settlement, release, and a
 * legitimate re-pledge once the asset is free again.
 */
contract LifecycleTest is SourceChain {
    SingletonRegistry registry;
    RwaDeed deed;
    HarborCredit harbor;
    MeridianCredit meridian;

    bytes32 assetKey;

    function setUp() public {
        _installPrecompiles();

        deed = new RwaDeed();
        harbor = new HarborCredit();
        meridian = new MeridianCredit(address(this));

        deed.mint(BORROWER, TOKEN_ID);
        meridian.setCreditLimit(BORROWER, 1_000_000 ether);

        registry = new SingletonRegistry();
        registry.setMinConfirmations(SEPOLIA, MIN_CONF);
        registry.setMinAttestors(SEPOLIA, MIN_ATTESTORS);
        registry.setEmitter(SEPOLIA, address(harbor), true);
        registry.setEmitter(SEPOLIA, address(meridian), true);

        assetKey = registry.assetKeyOf(SEPOLIA, address(deed), TOKEN_ID);
    }

    // ------------------------------------------------------------- helpers

    function _harborPledge(uint256 amount) internal returns (SingletonRegistry.Proof memory) {
        vm.recordLogs();
        vm.prank(BORROWER);
        harbor.openLien(address(deed), TOKEN_ID, amount);
        return _relay(_log(registry.PLEDGED_SIG()));
    }

    function _harborSettle() internal returns (SingletonRegistry.Proof memory) {
        vm.recordLogs();
        vm.prank(BORROWER);
        harbor.repayLien(address(deed), TOKEN_ID);
        return _relay(_log(registry.SETTLED_SIG()));
    }

    function _harborRelease() internal returns (SingletonRegistry.Proof memory) {
        vm.recordLogs();
        harbor.dischargeLien(address(deed), TOKEN_ID);
        return _relay(_log(registry.RELEASED_SIG()));
    }

    function _meridianPledge(uint256 amount) internal returns (SingletonRegistry.Proof memory) {
        vm.recordLogs();
        vm.prank(BORROWER);
        meridian.drawAgainst(address(deed), TOKEN_ID, amount);
        return _relay(_log(registry.PLEDGED_SIG()));
    }

    function _state() internal view returns (SingletonRegistry.AssetState) {
        return registry.getStatus(assetKey).state;
    }

    // --------------------------------------------------------- the lifecycle

    function test_fourProofsMoveOneAssetThroughItsWholeLife() public {
        registry.registerPledge(_harborPledge(1000 ether));
        assertEq(uint8(_state()), uint8(SingletonRegistry.AssetState.PLEDGED), "pledged");

        SingletonRegistry.Proof memory rejected = _meridianPledge(750 ether);
        registry.reportCollision(rejected);
        assertEq(registry.collisionCount(assetKey), 1, "the refusal is on file");
        assertEq(registry.getStatus(assetKey).emitter, address(harbor), "incumbent untouched");

        registry.registerSettlement(_harborSettle());
        assertEq(uint8(_state()), uint8(SingletonRegistry.AssetState.SETTLED), "settled");

        registry.registerRelease(_harborRelease());
        assertEq(uint8(_state()), uint8(SingletonRegistry.AssetState.FREE), "free again");

        vm.prank(BORROWER);
        meridian.repay(0);
        registry.registerPledge(_meridianPledge(500 ether));

        SingletonRegistry.Record memory r = registry.getStatus(assetKey);
        assertEq(uint8(r.state), uint8(SingletonRegistry.AssetState.PLEDGED), "re-pledged");
        assertEq(r.emitter, address(meridian), "and by the other lender this time");
        assertEq(r.amount, 500 ether);
    }

    function test_settlementFromANonIncumbentIsRefused() public {
        registry.registerPledge(_harborPledge(1000 ether));

        vm.prank(BORROWER);
        meridian.drawAgainst(address(deed), TOKEN_ID, 750 ether);
        vm.recordLogs();
        vm.prank(BORROWER);
        meridian.repay(0);
        SingletonRegistry.Proof memory foreign = _relay(_log(registry.SETTLED_SIG()));

        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.NotTheIncumbent.selector, address(harbor), address(meridian)
            )
        );
        registry.registerSettlement(foreign);
    }

    /// The instance id is what stops a settlement proved for a previous lien
    /// from settling the one on file now.
    function test_aStaleSettlementCannotBeReplayedAgainstANewLien() public {
        registry.registerPledge(_harborPledge(1000 ether));
        bytes32 firstInstance = registry.getStatus(assetKey).instanceId;

        SingletonRegistry.Proof memory staleSettlement = _harborSettle();
        registry.registerRelease(_harborRelease());

        registry.registerPledge(_harborPledge(2000 ether));
        bytes32 secondInstance = registry.getStatus(assetKey).instanceId;
        assertTrue(firstInstance != secondInstance, "a new lien is a new instance");

        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.WrongInstance.selector, secondInstance, firstInstance
            )
        );
        registry.registerSettlement(staleSettlement);
    }

    function test_settlementBeforeAnyPledgeIsRefused() public {
        vm.prank(BORROWER);
        harbor.openLien(address(deed), TOKEN_ID, 1000 ether);
        SingletonRegistry.Proof memory settlement = _harborSettle();

        vm.expectRevert(
            abi.encodeWithSelector(SingletonRegistry.AssetNotPledged.selector, assetKey)
        );
        registry.registerSettlement(settlement);
    }

    function test_releaseIsAcceptedStraightFromPledged() public {
        registry.registerPledge(_harborPledge(1000 ether));
        _harborSettle();

        registry.registerRelease(_harborRelease());
        assertEq(uint8(_state()), uint8(SingletonRegistry.AssetState.FREE));
    }

    // ----------------------------------------------------------- collisions

    function test_aReportedCollisionIsKeptWithItsDetails() public {
        registry.registerPledge(_harborPledge(1000 ether));
        registry.reportCollision(_meridianPledge(750 ether));

        SingletonRegistry.Collision memory c = registry.collisionAt(assetKey, 0);
        assertEq(c.emitter, address(meridian));
        assertEq(c.borrower, BORROWER);
        assertEq(c.amount, 750 ether);
        assertEq(c.chainKey, SEPOLIA);
        assertTrue(c.sourceHeight > 0);
    }

    function test_aCollisionCannotBeReportedAgainstAFreeAsset() public {
        SingletonRegistry.Proof memory lonely = _meridianPledge(750 ether);

        vm.expectRevert(
            abi.encodeWithSelector(SingletonRegistry.NoCollisionToReport.selector, assetKey)
        );
        registry.reportCollision(lonely);
    }

    function test_theSameCollisionCannotBeReportedTwice() public {
        registry.registerPledge(_harborPledge(1000 ether));
        SingletonRegistry.Proof memory rejected = _meridianPledge(750 ether);

        registry.reportCollision(rejected);
        vm.expectRevert();
        registry.reportCollision(rejected);
        assertEq(registry.collisionCount(assetKey), 1);
    }

    /**
     * Reporting a collision must not spend the proof itself. The losing pledge
     * is still a real lien on the source chain, and once the asset is released
     * it deserves to be registered on its own merits.
     */
    function test_reportingDoesNotConsumeTheProofForALaterLegitimatePledge() public {
        registry.registerPledge(_harborPledge(1000 ether));
        SingletonRegistry.Proof memory losing = _meridianPledge(750 ether);
        registry.reportCollision(losing);

        registry.registerSettlement(_harborSettle());
        registry.registerRelease(_harborRelease());

        registry.registerPledge(losing);

        SingletonRegistry.Record memory r = registry.getStatus(assetKey);
        assertEq(r.emitter, address(meridian), "the once refused lien now holds the asset");
        assertEq(r.amount, 750 ether);
    }

    // --------------------------------------------------------- certificate

    function test_theCertificateIsIssuedBurnedAndNeverTransferable() public {
        registry.registerPledge(_harborPledge(1000 ether));

        assertEq(registry.certificateOf(assetKey), address(harbor), "issued to the emitter");
        assertEq(registry.ownerOf(uint256(assetKey)), address(harbor));
        assertEq(registry.balanceOf(address(harbor)), 1);

        vm.prank(address(harbor));
        vm.expectRevert(SingletonRegistry.Soulbound.selector);
        registry.transferFrom(address(harbor), BORROWER, uint256(assetKey));

        registry.registerSettlement(_harborSettle());
        registry.registerRelease(_harborRelease());

        assertEq(registry.certificateOf(assetKey), address(0), "burned with the lien");
        assertEq(registry.balanceOf(address(harbor)), 0);
        vm.expectRevert(
            abi.encodeWithSelector(SingletonRegistry.NoCertificate.selector, uint256(assetKey))
        );
        registry.ownerOf(uint256(assetKey));
    }
}
