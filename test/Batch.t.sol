// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Vm} from "forge-std/Test.sol";
import {SourceChain} from "./support/SourceChain.sol";
import {SingletonRegistry} from "../src/SingletonRegistry.sol";
import {RwaDeed} from "../src/emitters/RwaDeed.sol";
import {HarborCredit} from "../src/emitters/HarborCredit.sol";
import {MeridianCredit} from "../src/emitters/MeridianCredit.sol";

/**
 * Many pledges, one continuity proof.
 *
 * A relayer catching up on a block range holds a dozen pledges, not one, so this
 * is the shape of the work rather than an optimisation bolted on the side. What
 * the tests below pin is that batching changes only the cost: every rule that
 * governs a single filing governs a member of a batch, and a batch that breaks
 * one of them takes the whole transaction with it.
 */
contract BatchTest is SourceChain {
 bytes4 constant SINGLE_VERIFY = bytes4(
 keccak256("verify(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[]))")
 );
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

 function _harborPledges(uint256 count) internal returns (Vm.Log[] memory entries) {
 entries = new Vm.Log[](count);
 for (uint256 i; i < count; i++) {
 vm.recordLogs();
 vm.prank(BORROWER);
 harbor.openLien(address(deed), i + 1, (i + 1) * 100 ether);
 entries[i] = _log(registry.PLEDGED_SIG());
 }
 }

 function test_aBatchFilesEveryPledgeInIt() public {
 SingletonRegistry.BatchProof memory b = _relayBatch(_harborPledges(4));

 (bytes32[] memory keys, bool[] memory duplicate) = registry.registerPledges(b);

 assertEq(keys.length, 4, "one key per member");
 for (uint256 i; i < 4; i++) {
 assertFalse(duplicate[i], "nothing here was filed before this transaction");
 SingletonRegistry.Record memory r = registry.getStatus(keys[i]);
 assertEq(uint8(r.state), uint8(SingletonRegistry.AssetState.PLEDGED));
 assertEq(r.emitter, address(harbor));
 assertEq(r.amount, (i + 1) * 100 ether, "each member keeps its own fields");
 assertEq(registry.certificateOf(keys[i]), address(harbor), "and its own certificate");
 }
 }

 /**
 * The continuity proof is verified once for the whole batch, and that is the
 * entire point: it is the expensive part, and its cost is paid per call
 * rather than per pledge.
 *
 * What is asserted here is the call count, not gas. This suite runs against
 * a model of the precompile, and a model's gas is its author's opinion. The
 * real saving was measured against the live precompile on Creditcoin and is
 * recorded in docs/VERIFICATION.md, where it can be checked rather than
 * believed.
 */
 function test_aBatchVerifiesOnceWhereSinglesVerifyEachTime() public {
 SingletonRegistry.BatchProof memory b = _relayBatch(_harborPledges(4));

 vm.expectCall(PROVER_ADDR, abi.encodeWithSelector(BATCH_VERIFY), 1);
 registry.registerPledges(b);
 }

 function test_fourSinglesVerifyFourTimes() public {
 Vm.Log[] memory entries = _harborPledges(4);
 SingletonRegistry.Proof[] memory proofs = new SingletonRegistry.Proof[](4);
 for (uint256 i; i < 4; i++) {
 proofs[i] = _relay(entries[i]);
 }

 vm.expectCall(PROVER_ADDR, abi.encodeWithSelector(SINGLE_VERIFY), 4);
 for (uint256 i; i < 4; i++) {
 registry.registerPledge(proofs[i]);
 }
 }

 /// Every member is checked. A batch is not a way to smuggle a pledge past a
 /// rule that would refuse it on its own.
 function test_oneUnprovableMemberTakesTheWholeBatch() public {
 SingletonRegistry.BatchProof memory b = _relayBatch(_harborPledges(3));
 // one byte the prover never attested, so this member is not proven
 b.encodedTransactions[2] = bytes.concat(b.encodedTransactions[2], hex"00");

 vm.expectRevert(SingletonRegistry.ProofRejected.selector);
 registry.registerPledges(b);
 }

 function test_aCollisionInsideABatchTakesTheWholeBatch() public {
 Vm.Log[] memory first = _harborPledges(1);
 registry.registerPledge(_relay(first[0]));
 bytes32 taken = registry.assetKeyOf(SEPOLIA, address(deed), 1);

 vm.recordLogs();
 vm.prank(BORROWER);
 meridian.drawAgainst(address(deed), 1, 500 ether);
 Vm.Log memory clash = _log(registry.PLEDGED_SIG());

 vm.recordLogs();
 vm.prank(BORROWER);
 harbor.openLien(address(deed), 2, 200 ether);
 Vm.Log memory fine = _log(registry.PLEDGED_SIG());

 Vm.Log[] memory both = new Vm.Log[](2);
 both[0] = fine;
 both[1] = clash;
 // built before the expectation is armed: _relayBatch calls the prover,
 // and an expectation armed first would match that call instead
 SingletonRegistry.BatchProof memory b = _relayBatch(both);

 vm.expectRevert(
 abi.encodeWithSelector(SingletonRegistry.AssetNotFree.selector, taken, address(harbor))
 );
 registry.registerPledges(b);

 assertEq(
 uint8(registry.getStatus(registry.assetKeyOf(SEPOLIA, address(deed), 2)).state),
 uint8(SingletonRegistry.AssetState.FREE),
 "the innocent member is not filed either"
 );
 }

 /**
 * A member front-run out of a pending batch used to take the whole batch
 * down with it: the nullifier does not care which door a proof came
 * through, so the batch's own burn for that member found it already spent
 * and reverted `ProofAlreadyConsumed`, discarding every other member along
 * with it. That is free for the griefer and costly for the relayer, who
 * pays for the whole continuity proof before the loop ever reaches the
 * member that fails.
 *
 * The fix is not to let two different nullifiers exist for the same proof
 * depending on who submits it. Tried on paper first, that does not work,
 * because `_recordPledge`'s `AssetNotFree` check is keyed on the asset, not
 * the nullifier, so the batch would still fail on that check instead. The
 * fix that actually holds is downstream of it: a member that is already
 * recorded, by this exact pledge, is not an anomaly to halt on.
 */
 function test_aFrontRunMemberIsSkippedRatherThanTakingTheBatchDown() public {
 Vm.Log[] memory entries = _harborPledges(2);
 SingletonRegistry.BatchProof memory b = _relayBatch(entries);

 SingletonRegistry.Proof memory alone = SingletonRegistry.Proof({
 chainKey: b.chainKey,
 height: b.heights[0],
 emitter: b.emitters[0],
 logIndex: b.logIndexes[0],
 encodedTransaction: b.encodedTransactions[0],
 merkleProof: b.merkleProofs[0],
 continuityProof: b.sharedContinuityProof
 });
 registry.registerPledge(alone);

 (bytes32[] memory keys, bool[] memory duplicate) = registry.registerPledges(b);

 assertTrue(duplicate[0], "the front-run member is recognised as already filed");
 assertFalse(duplicate[1], "the other member is fresh");
 assertEq(
 uint8(registry.getStatus(keys[1]).state),
 uint8(SingletonRegistry.AssetState.PLEDGED),
 "and it lands, which a full revert would have prevented"
 );
 }

 function test_anEmptyBatchIsRefused() public {
 SingletonRegistry.BatchProof memory b = _relayBatch(new Vm.Log[](0));
 vm.expectRevert(SingletonRegistry.EmptyBatch.selector);
 registry.registerPledges(b);
 }

 function test_raggedArraysAreRefused() public {
 SingletonRegistry.BatchProof memory b = _relayBatch(_harborPledges(2));
 b.emitters = new address[](1);

 vm.expectRevert(
 abi.encodeWithSelector(SingletonRegistry.BatchLengthMismatch.selector, uint256(2))
 );
 registry.registerPledges(b);
 }

 function test_anEmitterOutsideTheAllowlistIsRefusedInsideABatch() public {
 registry.setEmitter(SEPOLIA, address(harbor), false);
 SingletonRegistry.BatchProof memory b = _relayBatch(_harborPledges(2));

 vm.expectRevert(
 abi.encodeWithSelector(
 SingletonRegistry.EmitterNotAllowed.selector, SEPOLIA, address(harbor)
 )
 );
 registry.registerPledges(b);
 }
}
