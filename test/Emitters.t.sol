// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, Vm} from "forge-std/Test.sol";
import {SingletonRegistry} from "../src/SingletonRegistry.sol";
import {IBlockProver} from "../src/interfaces/IBlockProver.sol";
import {EvmV1Decoder} from "../src/vendor/EvmV1Decoder.sol";
import {ProverModel, ChainInfoModel} from "./mocks/Precompiles.sol";
import {RwaDeed} from "../src/emitters/RwaDeed.sol";
import {HarborCredit} from "../src/emitters/HarborCredit.sol";
import {MeridianCredit} from "../src/emitters/MeridianCredit.sol";

/**
 * The registry against the two real Sepolia lenders instead of hand written
 * logs.
 *
 * The logs here are not authored by the test: the lenders are called, their
 * emitted logs are captured with vm.recordLogs and repacked into the same
 * transaction encoding the BlockProver attests to. So if either lender's event
 * drifts from what the registry decodes, this fails, which is the one kind of
 * drift the Solidity compiler cannot catch across two chains.
 */
contract EmittersTest is Test {
    address constant PROVER_ADDR = 0x0000000000000000000000000000000000000FD2;
    address constant CHAININFO_ADDR = 0x0000000000000000000000000000000000000fD3;

    uint64 constant SEPOLIA = 1;
    uint64 constant MIN_CONF = 64;
    uint64 constant TIP = 11_509_380;

    uint256 constant TOKEN_ID = 42;
    address constant BORROWER = address(0xB0110);

    SingletonRegistry registry;
    ProverModel prover;
    RwaDeed deed;
    HarborCredit harbor;
    MeridianCredit meridian;

    function setUp() public {
        vm.etch(PROVER_ADDR, address(new ProverModel()).code);
        vm.etch(CHAININFO_ADDR, address(new ChainInfoModel()).code);
        prover = ProverModel(PROVER_ADDR);

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

    // ------------------------------------------------------------- helpers

    /// Repacks a captured log into the transaction encoding the precompile reads.
    function _encode(Vm.Log memory entry) internal pure returns (bytes memory) {
        bytes memory common = abi.encode(
            uint64(1), uint64(200000), BORROWER, false, entry.emitter, uint256(0), bytes("")
        );

        EvmV1Decoder.AccessListEntryBytes32[] memory accessList =
            new EvmV1Decoder.AccessListEntryBytes32[](0);
        bytes memory typeSpecific = abi.encode(
            uint64(1), uint128(1e9), uint128(3e10), accessList, uint8(0), bytes32(0), bytes32(0)
        );

        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = EvmV1Decoder.LogEntryTuple({
            address_: entry.emitter,
            topics: entry.topics,
            data: entry.data
        });

        bytes memory receipt = abi.encode(uint8(1), uint64(90000), logs, new bytes(256));

        bytes[] memory chunks = new bytes[](3);
        chunks[0] = common;
        chunks[1] = typeSpecific;
        chunks[2] = receipt;
        return abi.encode(uint8(2), chunks);
    }

    function _pledgeLog() internal view returns (Vm.Log memory found) {
        Vm.Log[] memory entries = vm.getRecordedLogs();
        bytes32 sig = registry.PLEDGED_SIG();
        for (uint256 i; i < entries.length; i++) {
            if (entries[i].topics.length > 0 && entries[i].topics[0] == sig) return entries[i];
        }
        revert("no Pledged log emitted");
    }

    function _relay(Vm.Log memory entry, uint64 height, bytes32 root)
        internal
        returns (SingletonRegistry.Proof memory p)
    {
        bytes memory encoded = _encode(entry);
        prover.attest(SEPOLIA, height, encoded);

        IBlockProver.MerkleProofEntry[] memory siblings = new IBlockProver.MerkleProofEntry[](1);
        siblings[0] = IBlockProver.MerkleProofEntry({hash: root, isLeft: true});

        p = SingletonRegistry.Proof({
            chainKey: SEPOLIA,
            height: height,
            encodedTransaction: encoded,
            merkleProof: IBlockProver.MerkleProof({root: root, siblings: siblings}),
            continuityProof: IBlockProver.ContinuityProof({
                lowerEndpointDigest: bytes32(0),
                roots: new bytes32[](0)
            })
        });
    }

    function _final() internal pure returns (uint64) {
        return TIP - MIN_CONF - 100;
    }

    // --------------------------------------------------------------- tests

    /// The two lenders agree on nothing except the shape of the log. If they
    /// stop agreeing, the registry silently sees one of them and not the other.
    function test_bothLendersEmitTheSignatureTheRegistryReads() public {
        vm.recordLogs();
        vm.prank(BORROWER);
        harbor.openLien(address(deed), TOKEN_ID, 1000 ether);
        Vm.Log memory fromHarbor = _pledgeLog();

        vm.recordLogs();
        vm.prank(BORROWER);
        meridian.drawAgainst(address(deed), TOKEN_ID, 750 ether);
        Vm.Log memory fromMeridian = _pledgeLog();

        assertEq(fromHarbor.topics[0], registry.PLEDGED_SIG(), "harbor signature");
        assertEq(fromMeridian.topics[0], registry.PLEDGED_SIG(), "meridian signature");
        assertEq(fromHarbor.topics.length, 4, "three indexed arguments");
        assertEq(fromMeridian.topics.length, 4, "three indexed arguments");
        assertEq(fromHarbor.data.length, 64, "amount and instance id");
        assertEq(fromMeridian.data.length, 64, "amount and instance id");
        assertTrue(fromHarbor.emitter != fromMeridian.emitter, "different contracts");
    }

    function test_realHarborPledgeIsRegistered() public {
        vm.recordLogs();
        vm.prank(BORROWER);
        bytes32 instanceId = harbor.openLien(address(deed), TOKEN_ID, 1000 ether);

        bytes32 assetKey =
            registry.registerPledge(_relay(_pledgeLog(), _final(), bytes32(uint256(0xA))));

        SingletonRegistry.Record memory r = registry.getStatus(assetKey);
        assertEq(uint8(r.state), uint8(SingletonRegistry.AssetState.PLEDGED));
        assertEq(r.emitter, address(harbor));
        assertEq(r.borrower, BORROWER);
        assertEq(r.amount, 1000 ether);
        assertEq(r.instanceId, instanceId);
        assertEq(assetKey, registry.assetKeyOf(SEPOLIA, address(deed), TOKEN_ID));
    }

    /// The demo, end to end, off one asset and two lenders that never met.
    function test_secondLenderCollidesOnTheSameAsset() public {
        vm.recordLogs();
        vm.prank(BORROWER);
        harbor.openLien(address(deed), TOKEN_ID, 1000 ether);
        bytes32 assetKey =
            registry.registerPledge(_relay(_pledgeLog(), _final(), bytes32(uint256(0xA))));

        vm.recordLogs();
        vm.prank(BORROWER);
        meridian.drawAgainst(address(deed), TOKEN_ID, 750 ether);
        SingletonRegistry.Proof memory second =
            _relay(_pledgeLog(), _final() + 1, bytes32(uint256(0xB)));

        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.AssetNotFree.selector, assetKey, address(harbor)
            )
        );
        registry.registerPledge(second);

        SingletonRegistry.Record memory r = registry.getStatus(assetKey);
        assertEq(r.emitter, address(harbor), "first to file keeps the asset");
    }

    /// Caveat 6 in executable form. Both liens exist on the source chain because
    /// neither lender takes the deed; that is what makes the collision possible
    /// at all.
    function test_bothPledgesAreNonCustodial() public {
        vm.startPrank(BORROWER);
        harbor.openLien(address(deed), TOKEN_ID, 1000 ether);
        meridian.drawAgainst(address(deed), TOKEN_ID, 750 ether);
        vm.stopPrank();

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
