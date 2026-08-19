// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Vm} from "forge-std/Test.sol";
import {SourceChain} from "./support/SourceChain.sol";
import {SingletonRegistry} from "../src/SingletonRegistry.sol";
import {RwaDeed} from "../src/emitters/RwaDeed.sol";
import {HarborCredit} from "../src/emitters/HarborCredit.sol";
import {MeridianCredit} from "../src/emitters/MeridianCredit.sol";

/**
 * A borrower who emits the register's own event from their own contract.
 *
 * Topic zero belongs to nobody. Declaring the same event is enough to put a
 * second log with the same signature into the receipt of a genuine pledge, and
 * the borrower is the party who sends that transaction.
 */
contract PoisonBorrower {
    event Pledged(
        address indexed collateralToken,
        uint256 indexed tokenId,
        address indexed borrower,
        uint256 amount,
        bytes32 pledgeInstanceId
    );

    function pledgeAndPoison(address harbor, address deed, uint256 tokenId, uint256 principal)
        external
    {
        HarborCredit(harbor).openLien(deed, tokenId, principal);
        emit Pledged(deed, tokenId, address(this), 0, keccak256("poison"));
    }

    function drawAndPoison(address meridian, address deed, uint256 tokenId, uint256 amount)
        external
    {
        MeridianCredit(meridian).drawAgainst(deed, tokenId, amount);
        emit Pledged(deed, tokenId, address(this), 0, keccak256("poison"));
    }
}

/**
 * The receipt is genuine and the proof is good; the question is whether a log
 * the emitter did not write can decide what the register does with it.
 */
contract PoisoningTest is SourceChain {
    SingletonRegistry registry;
    RwaDeed deed;
    HarborCredit harbor;
    MeridianCredit meridian;
    PoisonBorrower borrower;

    function setUp() public {
        _installPrecompiles();

        deed = new RwaDeed();
        harbor = new HarborCredit();
        meridian = new MeridianCredit(address(this));

        registry = new SingletonRegistry();
        registry.setMinConfirmations(SEPOLIA, MIN_CONF);
        registry.setEmitter(SEPOLIA, address(harbor), true);
        registry.setEmitter(SEPOLIA, address(meridian), true);

        borrower = new PoisonBorrower();
        deed.mint(address(borrower), TOKEN_ID);
        meridian.setCreditLimit(address(borrower), 1_000_000 ether);
    }

    function _poisonedHarborPledge(uint256 principal)
        internal
        returns (SingletonRegistry.Proof memory)
    {
        vm.recordLogs();
        borrower.pledgeAndPoison(address(harbor), address(deed), TOKEN_ID, principal);
        Vm.Log[] memory entries = vm.getRecordedLogs();

        uint256 matched;
        for (uint256 i; i < entries.length; i++) {
            if (entries[i].topics.length > 0 && entries[i].topics[0] == registry.PLEDGED_SIG()) {
                matched++;
            }
        }
        assertEq(matched, 2, "the receipt carries two logs with the pledge signature");

        return _relayMany(entries);
    }

    /// The attack the register has to survive: the borrower's own log must not
    /// be able to suppress the lender's.
    function test_aForeignLogWithTheSameSignatureDoesNotBlockThePledge() public {
        bytes32 assetKey = registry.registerPledge(_poisonedHarborPledge(1000 ether));

        SingletonRegistry.Record memory r = registry.getStatus(assetKey);
        assertEq(uint8(r.state), uint8(SingletonRegistry.AssetState.PLEDGED));
        assertEq(r.emitter, address(harbor), "the lender's log was read, not the borrower's");
        assertEq(r.amount, 1000 ether, "and its fields, not the poisoned zero");
        assertEq(r.borrower, address(borrower));
    }

    /// The whole point of surviving it: first to file still holds afterwards.
    function test_theSecondLenderStillCollidesAfterPoisoning() public {
        bytes32 assetKey = registry.registerPledge(_poisonedHarborPledge(1000 ether));

        vm.recordLogs();
        vm.prank(address(borrower));
        meridian.drawAgainst(address(deed), TOKEN_ID, 900 ether);
        SingletonRegistry.Proof memory second = _relay(_log(registry.PLEDGED_SIG()));

        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.AssetNotFree.selector, assetKey, address(harbor)
            )
        );
        registry.registerPledge(second);

        assertEq(registry.getStatus(assetKey).emitter, address(harbor));
    }

    /// A poisoned receipt must stay reportable too, or the evidence of the
    /// attempt is lost along with the pledge.
    function test_aPoisonedCollisionIsStillReportable() public {
        bytes32 assetKey = registry.registerPledge(_poisonedHarborPledge(1000 ether));

        vm.recordLogs();
        borrower.drawAndPoison(address(meridian), address(deed), TOKEN_ID, 900 ether);
        SingletonRegistry.Proof memory poisoned = _relayMany(vm.getRecordedLogs());

        registry.reportCollision(poisoned);

        assertEq(registry.collisionCount(assetKey), 1, "the attempt is on file");
        assertEq(registry.collisionAt(assetKey, 0).emitter, address(meridian));
    }

    /// The emitter is chosen before any log is read, and only that emitter's
    /// logs count. A matching log belonging to somebody else is not a pledge by
    /// the emitter, so there is no pledge to read.
    function test_onlyTheChosenEmittersLogsAreRead() public {
        vm.recordLogs();
        vm.prank(address(borrower));
        harbor.openLien(address(deed), TOKEN_ID, 1000 ether);
        Vm.Log memory realPledge = _log(registry.PLEDGED_SIG());

        vm.recordLogs();
        vm.prank(address(borrower));
        harbor.repayLien(address(deed), TOKEN_ID);
        Vm.Log memory harborSettle = _log(registry.SETTLED_SIG());

        Vm.Log[] memory entries = new Vm.Log[](2);
        entries[0] = harborSettle;
        entries[1] = realPledge;
        entries[1].emitter = address(borrower);

        SingletonRegistry.Proof memory p = _relayMany(entries);

        vm.expectRevert(SingletonRegistry.NoPledgeLog.selector);
        registry.registerPledge(p);
    }

    /// Caveat 7 is preserved: two pledges from the emitter itself are a batch,
    /// and a batch is still refused rather than half read.
    function test_aGenuineBatchFromOneEmitterIsStillRefused() public {
        deed.mint(address(borrower), TOKEN_ID + 1);

        vm.recordLogs();
        vm.prank(address(borrower));
        harbor.openLien(address(deed), TOKEN_ID, 1000 ether);
        Vm.Log memory first = _log(registry.PLEDGED_SIG());

        vm.recordLogs();
        vm.prank(address(borrower));
        harbor.openLien(address(deed), TOKEN_ID + 1, 500 ether);
        Vm.Log memory second = _log(registry.PLEDGED_SIG());

        Vm.Log[] memory entries = new Vm.Log[](2);
        entries[0] = first;
        entries[1] = second;

        SingletonRegistry.Proof memory p = _relayMany(entries);

        vm.expectRevert(
            abi.encodeWithSelector(SingletonRegistry.AmbiguousPledgeLogs.selector, uint256(2))
        );
        registry.registerPledge(p);
    }

    /// A chain nobody stated a depth for is unreadable, rather than readable at
    /// a depth of zero.
    function test_aChainWithNoStatedDepthIsUnreadable() public {
        SingletonRegistry fresh = new SingletonRegistry();
        fresh.setEmitter(SEPOLIA, address(harbor), true);

        vm.recordLogs();
        vm.prank(address(borrower));
        harbor.openLien(address(deed), TOKEN_ID, 1000 ether);
        SingletonRegistry.Proof memory p = _relay(_log(registry.PLEDGED_SIG()));

        vm.expectRevert(
            abi.encodeWithSelector(SingletonRegistry.ConfirmationsNotSet.selector, SEPOLIA)
        );
        fresh.registerPledge(p);
    }

    function test_aDepthOfZeroCannotBeStored() public {
        vm.expectRevert(
            abi.encodeWithSelector(SingletonRegistry.ConfirmationsNotSet.selector, SEPOLIA)
        );
        registry.setMinConfirmations(SEPOLIA, 0);

        assertEq(registry.minConfirmations(SEPOLIA), MIN_CONF, "the old depth still stands");
    }
}
