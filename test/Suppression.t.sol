// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Vm} from "forge-std/Test.sol";
import {SourceChain} from "./support/SourceChain.sol";
import {SingletonRegistry} from "../src/SingletonRegistry.sol";
import {RwaDeed} from "../src/emitters/RwaDeed.sol";
import {HarborCredit} from "../src/emitters/HarborCredit.sol";
import {MeridianCredit} from "../src/emitters/MeridianCredit.sol";

/**
 * A borrower who arranges the logs inside their own pledge transaction.
 *
 * The party who sends a transaction on the source chain decides what else is in
 * its receipt and in what order. Two reviews found the same attack through that
 * fact: first a decoy log with a borrowed topic zero, then a genuine log from
 * an unrelated allowlisted protocol placed first. Both made a real pledge
 * unregisterable, and an unregisterable pledge is first to file inverted, since
 * the borrower then chooses which lender gets priority.
 */
contract Arranger {
    event Pledged(
        address indexed collateralToken,
        uint256 indexed tokenId,
        address indexed borrower,
        uint256 amount,
        bytes32 pledgeInstanceId
    );

    /// A decoy with the registry's own signature, written by a stranger.
    function pledgeAndDecoy(address harbor, address deed, uint256 tokenId, uint256 principal)
        external
    {
        HarborCredit(harbor).openLien(deed, tokenId, principal);
        emit Pledged(deed, tokenId, address(this), 0, keccak256("decoy"));
    }

    /// A real log from another allowlisted lender, ordered first.
    function noiseThenDraw(
        address harbor,
        address meridian,
        address deed,
        uint256 noiseId,
        uint256 pledgeId,
        uint256 amount
    ) external {
        HarborCredit(harbor).repayLien(deed, noiseId);
        MeridianCredit(meridian).drawAgainst(deed, pledgeId, amount);
    }

    /// Two genuine pledges from the same lender in one transaction.
    function twoHarborLiens(address harbor, address deed, uint256 a, uint256 b) external {
        HarborCredit(harbor).openLien(deed, a, 1 ether);
        HarborCredit(harbor).openLien(deed, b, 1000 ether);
    }
}

contract SuppressionTest is SourceChain {
    SingletonRegistry registry;
    RwaDeed deed;
    HarborCredit harbor;
    MeridianCredit meridian;
    Arranger borrower;

    uint256 constant NOISE_ID = 99;
    uint256 constant OTHER_ID = 7;

    function setUp() public {
        _installPrecompiles();

        deed = new RwaDeed();
        harbor = new HarborCredit();
        meridian = new MeridianCredit(address(this));
        borrower = new Arranger();

        registry = new SingletonRegistry();
        registry.setMinConfirmations(SEPOLIA, MIN_CONF);
        registry.setMinAttestors(SEPOLIA, MIN_ATTESTORS);
        registry.setEmitter(SEPOLIA, address(harbor), true);
        registry.setEmitter(SEPOLIA, address(meridian), true);

        deed.mint(address(borrower), TOKEN_ID);
        deed.mint(address(borrower), NOISE_ID);
        deed.mint(address(borrower), OTHER_ID);
        meridian.setCreditLimit(address(borrower), 1_000_000 ether);
    }

    function _indexOf(Vm.Log[] memory entries, address emitter, bytes32 signature)
        internal
        pure
        returns (uint32)
    {
        for (uint32 i; i < entries.length; i++) {
            if (
                entries[i].emitter == emitter && entries[i].topics.length > 0
                    && entries[i].topics[0] == signature
            ) return i;
        }
        revert("that emitter wrote no such log");
    }

    /// A stranger's log carrying the registry's own signature is just another
    /// log in the receipt. The relayer names the one it is filing.
    function test_aDecoyWithTheSameSignatureChangesNothing() public {
        vm.recordLogs();
        borrower.pledgeAndDecoy(address(harbor), address(deed), TOKEN_ID, 1000 ether);
        Vm.Log[] memory entries = vm.getRecordedLogs();

        uint256 carrying;
        for (uint256 i; i < entries.length; i++) {
            if (entries[i].topics.length > 0 && entries[i].topics[0] == registry.PLEDGED_SIG()) {
                carrying++;
            }
        }
        assertEq(carrying, 2, "the receipt carries the decoy and the real pledge");

        uint32 real = _indexOf(entries, address(harbor), registry.PLEDGED_SIG());
        bytes32 assetKey = registry.registerPledge(_relayMany(entries, real));

        SingletonRegistry.Record memory r = registry.getStatus(assetKey);
        assertEq(uint8(r.state), uint8(SingletonRegistry.AssetState.PLEDGED));
        assertEq(r.emitter, address(harbor), "the lender's log was filed");
        assertEq(r.amount, 1000 ether, "with its own fields, not the decoy's zero");
    }

    /// Naming the decoy names its author, who is not on the allowlist.
    function test_filingTheDecoyNamesItsAuthor() public {
        vm.recordLogs();
        borrower.pledgeAndDecoy(address(harbor), address(deed), TOKEN_ID, 1000 ether);
        Vm.Log[] memory entries = vm.getRecordedLogs();

        uint32 decoy = _indexOf(entries, address(borrower), registry.PLEDGED_SIG());
        SingletonRegistry.Proof memory p = _relayMany(entries, decoy);

        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.EmitterNotAllowed.selector, SEPOLIA, address(borrower)
            )
        );
        registry.registerPledge(p);
    }

    /// The finding that broke the previous design: an unrelated log from
    /// another allowlisted protocol, placed first, used to decide who the
    /// emitter was. Now nothing decides that except the relayer.
    function test_anUnrelatedAllowlistedLogDoesNotSuppressAPledge() public {
        vm.prank(address(borrower));
        harbor.openLien(address(deed), NOISE_ID, 1);

        vm.recordLogs();
        borrower.noiseThenDraw(
            address(harbor), address(meridian), address(deed), NOISE_ID, TOKEN_ID, 900 ether
        );
        Vm.Log[] memory entries = vm.getRecordedLogs();
        assertEq(entries[0].emitter, address(harbor), "the noise is ordered first");

        uint32 real = _indexOf(entries, address(meridian), registry.PLEDGED_SIG());
        bytes32 assetKey = registry.registerPledge(_relayMany(entries, real));

        assertEq(registry.getStatus(assetKey).emitter, address(meridian), "the real lender holds");
    }

    /// The consequence that made it high severity: with the pledge filed, the
    /// borrower can no longer hand priority to whichever lender they prefer.
    function test_theArrangedPledgeStillWinsTheRace() public {
        vm.prank(address(borrower));
        harbor.openLien(address(deed), NOISE_ID, 1);

        vm.recordLogs();
        borrower.noiseThenDraw(
            address(harbor), address(meridian), address(deed), NOISE_ID, TOKEN_ID, 900 ether
        );
        Vm.Log[] memory first = vm.getRecordedLogs();
        bytes32 assetKey = registry.registerPledge(
            _relayMany(first, _indexOf(first, address(meridian), registry.PLEDGED_SIG()))
        );

        vm.recordLogs();
        vm.prank(address(borrower));
        harbor.openLien(address(deed), TOKEN_ID, 1000 ether);
        SingletonRegistry.Proof memory late = _relay(_log(registry.PLEDGED_SIG()));

        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.AssetNotFree.selector, assetKey, address(meridian)
            )
        );
        registry.registerPledge(late);
    }

    /// A batch used to be refused as ambiguous, which was the same suppression
    /// wearing a feature's clothes: one throwaway lien in the same transaction
    /// made the real one unfilable. Each log is now filed on its own.
    function test_aBatchFromOneEmitterRegistersEveryPledgeInIt() public {
        vm.recordLogs();
        borrower.twoHarborLiens(address(harbor), address(deed), NOISE_ID, TOKEN_ID);
        Vm.Log[] memory entries = vm.getRecordedLogs();

        bytes32 small = registry.registerPledge(_relayMany(entries, 0));
        bytes32 large = registry.registerPledge(_relayMany(entries, 1));

        assertTrue(small != large, "two assets, two records");
        assertEq(registry.getStatus(small).amount, 1 ether);
        assertEq(registry.getStatus(large).amount, 1000 ether);
    }

    /// Naming a log the emitter did not write is refused rather than read.
    function test_aLogTheNamedEmitterDidNotWriteIsRefused() public {
        vm.recordLogs();
        borrower.pledgeAndDecoy(address(harbor), address(deed), TOKEN_ID, 1000 ether);
        Vm.Log[] memory entries = vm.getRecordedLogs();

        uint32 decoy = _indexOf(entries, address(borrower), registry.PLEDGED_SIG());
        SingletonRegistry.Proof memory p = _relayMany(entries, decoy);
        p.emitter = address(harbor);

        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.LogNotFromEmitter.selector, address(harbor), address(borrower)
            )
        );
        registry.registerPledge(p);
    }

    function test_anIndexPastTheEndOfTheReceiptIsRefused() public {
        vm.recordLogs();
        vm.prank(address(borrower));
        harbor.openLien(address(deed), TOKEN_ID, 1000 ether);
        SingletonRegistry.Proof memory p = _relay(_log(registry.PLEDGED_SIG()));
        p.logIndex = 9;

        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.LogIndexOutOfRange.selector, uint256(9), uint256(1)
            )
        );
        registry.registerPledge(p);
    }
}
