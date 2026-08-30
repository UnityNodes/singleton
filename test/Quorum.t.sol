// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Vm} from "forge-std/Test.sol";
import {SourceChain} from "./support/SourceChain.sol";
import {SingletonRegistry} from "../src/SingletonRegistry.sol";
import {RwaDeed} from "../src/emitters/RwaDeed.sol";
import {HarborCredit} from "../src/emitters/HarborCredit.sol";
import {MeridianCredit} from "../src/emitters/MeridianCredit.sol";

/**
 * What stood behind the record when the record was made.
 *
 * A registry that reads another chain is believing an attestor set, and that
 * set changes size. These tests pin the two consequences: the size is written
 * down with every record so a later reader can weigh it, and a set that has
 * fallen below a stated floor stops producing records rather than producing
 * weak ones that look identical to strong ones.
 */
contract QuorumTest is SourceChain {
    bytes4 constant COUNT = bytes4(keccak256("getAttestorsCount(uint64)"));
    bytes4 constant BATCH_VERIFY = bytes4(
        keccak256(
            "verify(uint64,uint64[],bytes[],(bytes32,(bytes32,bool)[])[],(bytes32,bytes32[]))"
        )
    );

    SingletonRegistry registry;
    RwaDeed deed;
    HarborCredit harbor;
    MeridianCredit meridian;

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

        for (uint256 id = 1; id <= 6; id++) {
            deed.mint(BORROWER, id);
        }
        meridian.setCreditLimit(BORROWER, 1_000_000 ether);
    }

    function _harborPledge(uint256 tokenId) internal returns (Vm.Log memory) {
        vm.recordLogs();
        vm.prank(BORROWER);
        harbor.openLien(address(deed), tokenId, 100 ether);
        return _log(registry.PLEDGED_SIG());
    }

    function _fileHarborPledge(uint256 tokenId) internal returns (bytes32) {
        return registry.registerPledge(_relay(_harborPledge(tokenId)));
    }

    // ------------------------------------------------ the number is recorded

    /**
     * The set bonded at filing, and not the set that attested the source block.
     *
     * Those differ in practice, by one on the headline mainnet proof, and the
     * second is not reachable: `getAttestorsCount` takes no height. Caveat 11
     * carries the worked case. The name of this test says which number it is,
     * because the first name said the other one.
     */
    function test_theLienRecordsTheAttestorSetBondedWhenItWasFiled() public {
        bytes32 assetKey = _fileHarborPledge(1);

        SingletonRegistry.Record memory r = registry.getStatus(assetKey);
        assertEq(r.security.attestors, 7, "seven bonded attestors on this chain");
        assertEq(r.security.minBond, 100 ether, "and a hundred CTC of bond each");
        assertEq(r.security.attestedTip, TIP, "against the tip the finality guard saw");
    }

    function test_aRefusalRecordsTheAttestorSetItWasFiledUnder() public {
        _fileHarborPledge(1);

        vm.recordLogs();
        vm.prank(BORROWER);
        meridian.drawAgainst(address(deed), 1, 500 ether);
        SingletonRegistry.Proof memory second = _relay(_log(registry.PLEDGED_SIG()));

        bytes32 assetKey = registry.assetKeyOf(SEPOLIA, address(deed), 1);
        registry.reportCollision(second);

        SingletonRegistry.Collision memory c = registry.collisionAt(assetKey, 0);
        assertEq(c.security.attestors, 7, "a refusal is a record too, and carries the same");
        assertEq(c.security.attestedTip, TIP);
    }

    /**
     * The record is deleted when the lien is released, so if the numbers lived
     * only in storage a released lien would be unauditable afterwards. This is
     * the check that the log keeps them.
     */
    function test_theQuorumSurvivesInTheLogAfterTheRecordIsDeleted() public {
        vm.recordLogs();
        registry.registerPledge(_relay(_harborPledge(1)));

        Vm.Log[] memory entries = vm.getRecordedLogs();
        bytes32 signature = keccak256("AttestationWitnessed(bytes32,uint64,uint64,uint64,uint256)");
        bool found;
        for (uint256 i; i < entries.length; i++) {
            if (entries[i].topics[0] != signature) continue;
            found = true;
            (uint64 chainKey, uint64 attestedTip, uint64 attestors, uint256 bond) =
                abi.decode(entries[i].data, (uint64, uint64, uint64, uint256));
            assertEq(chainKey, SEPOLIA);
            assertEq(attestedTip, TIP);
            assertEq(attestors, 7);
            assertEq(bond, 100 ether);
        }
        assertTrue(found, "the permanent copy is in the log");
    }

    // -------------------------------------------------------- the floor bites

    function test_aThinnedAttestorSetStopsTheRegistryRecordingAnything() public {
        stash.setAttestorsCount(SEPOLIA, 2);

        SingletonRegistry.Proof memory p = _relay(_harborPledge(1));
        vm.expectRevert(
            abi.encodeWithSelector(SingletonRegistry.QuorumTooThin.selector, SEPOLIA, 2, 3)
        );
        registry.registerPledge(p);
    }

    function test_aThinnedAttestorSetStopsRefusalsBeingFiledToo() public {
        _fileHarborPledge(1);

        vm.recordLogs();
        vm.prank(BORROWER);
        meridian.drawAgainst(address(deed), 1, 500 ether);
        SingletonRegistry.Proof memory second = _relay(_log(registry.PLEDGED_SIG()));

        stash.setAttestorsCount(SEPOLIA, 1);
        vm.expectRevert(
            abi.encodeWithSelector(SingletonRegistry.QuorumTooThin.selector, SEPOLIA, 1, 3)
        );
        registry.reportCollision(second);
    }

    /**
     * The floor gates entry, never exit. A borrower whose lender repaid must be
     * able to get the asset back even if the attestor set collapsed in between,
     * because none of the parties to that lien had any part in the collapse.
     */
    function test_aThinnedAttestorSetDoesNotTrapAnAssetAlreadyOnFile() public {
        bytes32 assetKey = _fileHarborPledge(1);

        stash.setAttestorsCount(SEPOLIA, 0);

        vm.recordLogs();
        vm.prank(BORROWER);
        harbor.repayLien(address(deed), 1);
        registry.registerSettlement(_relay(_log(registry.SETTLED_SIG())));

        vm.recordLogs();
        harbor.dischargeLien(address(deed), 1);
        registry.registerRelease(_relay(_log(registry.RELEASED_SIG())));

        SingletonRegistry.Record memory r = registry.getStatus(assetKey);
        assertEq(uint8(r.state), uint8(SingletonRegistry.AssetState.FREE), "the asset came back");
    }

    /**
     * An unknown chain key answers zero attestors rather than reverting, which
     * is verified against the live precompile. So a stated floor is also the
     * refusal to read a chain Creditcoin does not attest at all.
     */
    function test_aChainCreditcoinDoesNotAttestIsRefusedByTheFloor() public {
        uint64 stranger = 9;
        registry.setMinConfirmations(stranger, MIN_CONF);
        registry.setMinAttestors(stranger, MIN_ATTESTORS);
        registry.setEmitter(stranger, address(harbor), true);

        Vm.Log memory entry = _harborPledge(1);
        SingletonRegistry.Proof memory p = _relayFrom(stranger, TIP - MIN_CONF - 10, entry);

        vm.expectRevert(
            abi.encodeWithSelector(SingletonRegistry.QuorumTooThin.selector, stranger, 0, 3)
        );
        registry.registerPledge(p);
    }

    // ------------------------------------------------------- the floor exists

    function test_aChainWithNoStatedFloorRecordsNothing() public {
        SingletonRegistry fresh = new SingletonRegistry();
        fresh.setMinConfirmations(SEPOLIA, MIN_CONF);
        fresh.setEmitter(SEPOLIA, address(harbor), true);

        SingletonRegistry.Proof memory p = _relay(_harborPledge(1));
        vm.expectRevert(abi.encodeWithSelector(SingletonRegistry.QuorumNotSet.selector, SEPOLIA));
        fresh.registerPledge(p);
    }

    function test_theFloorCannotBeSetToZero() public {
        vm.expectRevert(abi.encodeWithSelector(SingletonRegistry.QuorumNotSet.selector, SEPOLIA));
        registry.setMinAttestors(SEPOLIA, 0);
    }

    function test_onlyTheAdminStatesTheFloor() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert(SingletonRegistry.NotAdmin.selector);
        registry.setMinAttestors(SEPOLIA, 5);
    }

    // ------------------------------------------------------------ once, not n

    /**
     * The attestor set cannot change inside a transaction, so a batch asks for
     * it once however many pledges it carries. This is the second per item cost
     * the batch path turns into a per transaction one, after the continuity
     * proof itself.
     */
    /**
     * A batch member is a record like any other, so it carries the same
     * provenance. Without this, the one read shared across the batch could be
     * dropped on the floor for every member but the first and the suite would
     * not notice.
     */
    function test_everyMemberOfABatchCarriesTheWitnessedQuorum() public {
        Vm.Log[] memory entries = new Vm.Log[](4);
        for (uint256 i; i < 4; i++) {
            entries[i] = _harborPledge(i + 1);
        }

        (bytes32[] memory keys,) = registry.registerPledges(_relayBatch(entries));

        for (uint256 i; i < keys.length; i++) {
            SingletonRegistry.Record memory r = registry.getStatus(keys[i]);
            assertEq(r.security.attestors, 7, "each member, not only the first");
            assertEq(r.security.minBond, 100 ether);
            assertEq(r.security.attestedTip, TIP);
        }
    }

    /// A batch below the floor is refused before the precompile is asked to
    /// verify anything, because no proof can rescue a chain nobody is behind.
    function test_aThinnedAttestorSetStopsABatchBeforeItIsVerified() public {
        Vm.Log[] memory entries = new Vm.Log[](3);
        for (uint256 i; i < 3; i++) {
            entries[i] = _harborPledge(i + 1);
        }
        SingletonRegistry.BatchProof memory b = _relayBatch(entries);

        stash.setAttestorsCount(SEPOLIA, 1);

        vm.expectCall(PROVER_ADDR, abi.encodeWithSelector(BATCH_VERIFY), 0);
        vm.expectRevert(
            abi.encodeWithSelector(SingletonRegistry.QuorumTooThin.selector, SEPOLIA, 1, 3)
        );
        registry.registerPledges(b);
    }

    function test_aBatchReadsTheAttestorSetOnceForAllOfItsMembers() public {
        Vm.Log[] memory entries = new Vm.Log[](4);
        for (uint256 i; i < 4; i++) {
            entries[i] = _harborPledge(i + 1);
        }

        SingletonRegistry.BatchProof memory b = _relayBatch(entries);

        vm.expectCall(STASH_ADDR, abi.encodeWithSelector(COUNT, SEPOLIA), 1);
        registry.registerPledges(b);
    }

    /**
     * The floor is a floor, not a fence one above it.
     *
     * `attestors < floor` refuses below the floor and not at it, which is the
     * intended reading and was written down wrongly in four places: with four
     * bonded against a floor of three, the project claimed one departure would
     * halt it. It takes two. The error ran against us rather than for us, which
     * is the rarer direction and no better.
     */
    function test_aSetExactlyAtTheFloorStillRecords() public {
        stash.setAttestorsCount(SEPOLIA, MIN_ATTESTORS);

        bytes32 assetKey = _fileHarborPledge(1);

        SingletonRegistry.Record memory r = registry.getStatus(assetKey);
        assertEq(
            uint8(r.state), uint8(SingletonRegistry.AssetState.PLEDGED), "at the floor, on file"
        );
        assertEq(r.security.attestors, MIN_ATTESTORS, "and the record says how thin it was");

        stash.setAttestorsCount(SEPOLIA, MIN_ATTESTORS - 1);
        SingletonRegistry.Proof memory p = _relay(_harborPledge(2));
        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.QuorumTooThin.selector, SEPOLIA, MIN_ATTESTORS - 1, MIN_ATTESTORS
            )
        );
        registry.registerPledge(p);
    }
}
