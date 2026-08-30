// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Vm} from "forge-std/Test.sol";
import {SourceChain} from "./support/SourceChain.sol";
import {SingletonRegistry} from "../src/SingletonRegistry.sol";
import {IPledgeAdapter} from "../src/interfaces/IPledgeAdapter.sol";
import {EvmV1Decoder} from "../src/vendor/EvmV1Decoder.sol";
import {RwaDeed} from "../src/emitters/RwaDeed.sol";
import {HarborCredit} from "../src/emitters/HarborCredit.sol";
import {MeridianCredit} from "../src/emitters/MeridianCredit.sol";

/// An adapter that ignores the log it is handed and answers from storage.
contract FabricatingAdapter is IPledgeAdapter {
    address public immutable token;
    uint256 public immutable id;
    bytes32 public constant PLEDGED_SIG =
        0xbfb86e5d7136ec550644fc6d0fcc8e6504e3dc19aacdeec2dec3d459854b4823;

    constructor(address token_, uint256 id_) {
        token = token_;
        id = id_;
    }

    function signaturesFor(uint8) external pure returns (bytes32[] memory s) {
        s = new bytes32[](1);
        s[0] = PLEDGED_SIG;
    }

    function translate(uint8, EvmV1Decoder.LogEntry calldata)
        external
        view
        returns (address, uint256, address, uint256, bytes32)
    {
        return (token, id, address(0xF00D), 1 ether, keccak256("fabricated"));
    }
}

/**
 * What an administrator can actually do, written down rather than asserted away.
 *
 * The caveats used to open with "an administrator can exclude, but cannot
 * fabricate", and the test that backed it only proved that de-allowlisting a
 * lender blocks that lender's pledge. It never attempted fabrication. A review
 * on 2026-08-19 attempted it and it worked, so the claim was false and the test
 * was vacuous. Both are corrected here: the boundary is real, but it sits
 * somewhere else, and this file is where it is.
 */
contract AdminPowerTest is SourceChain {
    SingletonRegistry registry;
    RwaDeed deed;
    HarborCredit harbor;
    MeridianCredit meridian;

    address constant UNINVOLVED = address(0x1111);
    uint256 constant UNTOUCHED_ID = 7;

    function setUp() public {
        _installPrecompiles();

        deed = new RwaDeed();
        harbor = new HarborCredit();
        meridian = new MeridianCredit(address(this));

        registry = new SingletonRegistry();
        registry.setMinConfirmations(SEPOLIA, MIN_CONF);
        registry.setMinAttestors(SEPOLIA, MIN_ATTESTORS);
        registry.setEmitter(SEPOLIA, address(harbor), true);
        registry.setEmitter(SEPOLIA, address(meridian), true);

        deed.mint(BORROWER, TOKEN_ID);
        deed.mint(UNINVOLVED, UNTOUCHED_ID);
        meridian.setCreditLimit(BORROWER, 1_000_000 ether);
    }

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

    /**
     * The adapter is where the admin's real power is. It cannot invent a log,
     * but it decides what a real log means, and that is enough to file a lien
     * against an asset whose owner was never involved.
     *
     * The freeze added after this test was first written closes what happens
     * next, not what happens here: it cannot stop a lying adapter from being
     * the very first thing installed for an emitter, because there is nothing
     * yet to freeze. What it does is lock the lie in immediately, the moment it
     * is used. The admin cannot even swap the adapter back afterward, which
     * is worse in one way (the lie can never be corrected by the same lever
     * that told it) and better in the one that matters more (nobody, including
     * this admin, can ever install a second, different lie against the same
     * emitter later).
     */
    function test_theAdminCanFabricateThroughAnAdapter() public {
        FabricatingAdapter liar = new FabricatingAdapter(address(deed), UNTOUCHED_ID);
        registry.setAdapter(SEPOLIA, address(harbor), address(liar));

        registry.registerPledge(_harborPledge(1000 ether));

        bytes32 fabricated = registry.assetKeyOf(SEPOLIA, address(deed), UNTOUCHED_ID);
        SingletonRegistry.Record memory r = registry.getStatus(fabricated);
        assertEq(uint8(r.state), uint8(SingletonRegistry.AssetState.PLEDGED), "never pledged");
        assertEq(deed.ownerOf(UNTOUCHED_ID), UNINVOLVED, "and still owned by somebody else");

        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.AdapterFrozen.selector, SEPOLIA, address(harbor)
            )
        );
        registry.setAdapter(SEPOLIA, address(harbor), address(0));
    }

    /// The boundary that does hold: no adapter can produce a record from a
    /// transaction that was never mined, because the precompile decides that.
    function test_noAdapterMakesTheProverAcceptAnUnminedTransaction() public {
        registry.setAdapter(
            SEPOLIA, address(harbor), address(new FabricatingAdapter(address(deed), 3))
        );

        vm.recordLogs();
        vm.prank(BORROWER);
        harbor.openLien(address(deed), TOKEN_ID, 1000 ether);
        Vm.Log memory entry = _log(registry.PLEDGED_SIG());

        SingletonRegistry.Proof memory unattested = _relay(entry);
        unattested.height = unattested.height + 1;

        vm.expectRevert(SingletonRegistry.ProofRejected.selector);
        registry.registerPledge(unattested);
    }

    /// Exclusion must not trap assets. The allowlist governs entry; a lender
    /// that has been excluded can still let go of what it already holds, and
    /// the borrower is not held hostage to a decision they were not part of.
    function test_anExcludedEmitterCanStillReleaseWhatItHolds() public {
        bytes32 assetKey = registry.registerPledge(_harborPledge(1000 ether));

        SingletonRegistry.Proof memory settle = _harborSettle();
        SingletonRegistry.Proof memory release = _harborRelease();

        registry.setEmitter(SEPOLIA, address(harbor), false);

        registry.registerSettlement(settle);
        registry.registerRelease(release);

        assertEq(
            uint8(registry.getStatus(assetKey).state),
            uint8(SingletonRegistry.AssetState.FREE),
            "the asset is free, not stranded"
        );
    }

    /// The floor on the attestor set gates entry and never exit, so the caveats
    /// used to say no administrator could strand an asset already on file. The
    /// confirmation depth is the other dial, and it sits on the shared read
    /// path rather than on entry, so it reaches the exits the floor cannot.
    function test_theAdminStrandsAnAssetByRaisingTheConfirmationDepth() public {
        bytes32 assetKey = registry.registerPledge(_harborPledge(1000 ether));

        SingletonRegistry.Proof memory settle = _harborSettle();
        SingletonRegistry.Proof memory release = _harborRelease();

        registry.setMinConfirmations(SEPOLIA, 1_000_000);

        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.NotFinal.selector, settle.height, TIP, uint64(1_000_000)
            )
        );
        registry.registerSettlement(settle);

        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.NotFinal.selector, release.height, TIP, uint64(1_000_000)
            )
        );
        registry.registerRelease(release);

        assertEq(
            uint8(registry.getStatus(assetKey).state),
            uint8(SingletonRegistry.AssetState.PLEDGED),
            "the asset is stranded, and only the admin can free it"
        );

        registry.setMinConfirmations(SEPOLIA, MIN_CONF);
        registry.registerSettlement(settle);
        registry.registerRelease(release);

        assertEq(
            uint8(registry.getStatus(assetKey).state),
            uint8(SingletonRegistry.AssetState.FREE),
            "lowering the depth again releases what raising it held"
        );
    }

    function test_anExcludedEmitterStillCannotFileAnythingNew() public {
        registry.setEmitter(SEPOLIA, address(harbor), false);
        SingletonRegistry.Proof memory p = _harborPledge(1000 ether);

        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.EmitterNotAllowed.selector, SEPOLIA, address(harbor)
            )
        );
        registry.registerPledge(p);
    }

    /// A lien that was closed before the current one began is not evidence that
    /// two lenders hold the same asset now.
    function test_aClosedLienCannotBeFiledAsACollisionAgainstALaterOne() public {
        SingletonRegistry.Proof memory old = _harborPledge(1000 ether);
        bytes32 assetKey = registry.registerPledge(old);
        registry.registerSettlement(_harborSettle());
        registry.registerRelease(_harborRelease());

        vm.recordLogs();
        vm.prank(BORROWER);
        meridian.drawAgainst(address(deed), TOKEN_ID, 750 ether);
        registry.registerPledge(_relay(_log(registry.PLEDGED_SIG())));

        SingletonRegistry.Record memory r = registry.getStatus(assetKey);
        assertEq(r.emitter, address(meridian), "meridian holds it now");

        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.StaleCollision.selector, old.height, r.sourceHeight
            )
        );
        registry.reportCollision(old);

        assertEq(registry.collisionCount(assetKey), 0, "nothing on file");
    }

    /// The demo lenders close their own liens. A settlement the registry
    /// records is a settlement somebody with standing declared, because the
    /// registry proves that a log happened and never that a debt was paid.
    function test_aStrangerCannotSettleSomebodyElsesLien() public {
        registry.registerPledge(_harborPledge(1000 ether));

        vm.prank(address(0xDEAD));
        vm.expectRevert(abi.encodeWithSelector(HarborCredit.NotTheHolder.selector, BORROWER));
        harbor.repayLien(address(deed), TOKEN_ID);
    }

    function test_aStrangerCannotClearSomebodyElsesDraw() public {
        vm.prank(BORROWER);
        meridian.drawAgainst(address(deed), TOKEN_ID, 750 ether);

        vm.prank(address(0xDEAD));
        vm.expectRevert(
            abi.encodeWithSelector(MeridianCredit.AssetNotHeldByObligor.selector, BORROWER)
        );
        meridian.repay(0);
    }
}
