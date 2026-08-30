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
import {AtlasVault} from "./mocks/AtlasVault.sol";
import {LockedCollateralAdapter} from "../src/adapters/LockedCollateralAdapter.sol";

/**
 * What the lien model says when nobody is looking at the happy path.
 *
 * These four are written to fail if the behaviour they pin ever changes. They
 * are not assertions that the behaviour is right; each one is a claim the
 * registry currently makes that a lender reading it would misread.
 */
contract LienModelTest is SourceChain {
 SingletonRegistry registry;
 RwaDeed deed;
 HarborCredit harbor;
 MeridianCredit meridian;
 AtlasVault atlas;

 bytes32 assetKey;

 uint256 internal constant SECOND_TOKEN = 43;

 function setUp() public {
 _installPrecompiles();

 deed = new RwaDeed();
 harbor = new HarborCredit();
 meridian = new MeridianCredit(address(this));
 atlas = new AtlasVault();

 deed.mint(BORROWER, TOKEN_ID);
 deed.mint(BORROWER, SECOND_TOKEN);
 meridian.setCreditLimit(BORROWER, 1_000_000 ether);

 registry = new SingletonRegistry();
 registry.setMinConfirmations(SEPOLIA, MIN_CONF);
 registry.setMinAttestors(SEPOLIA, MIN_ATTESTORS);
 registry.setEmitter(SEPOLIA, address(harbor), true);
 registry.setEmitter(SEPOLIA, address(meridian), true);
 registry.setEmitter(SEPOLIA, address(atlas), true);

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

 // ---------------------------------------------------------------- 1

 /**
 * The collision list is never pruned, so a refusal survives the lien it was
 * filed against and keeps accusing the lender that afterwards won the asset
 * legitimately.
 *
 * This is the state the deployed registry is in for the demo deed: the
 * record names Meridian as the incumbent and the single collision on file
 * is Meridian's own pledge, byte for byte.
 */
 function test_theRefusalGoesWithTheLienItWasFiledAgainst() public {
 registry.registerPledge(_harborPledge(1000 ether));

 // One real Sepolia log, filed twice: once as the refusal while Harbor
 // held the asset, once as the pledge after Harbor let it go. That is
 // what the deployed registry was given, and the two filings carry the
 // same source height because they are the same log.
 vm.recordLogs();
 vm.prank(BORROWER);
 meridian.drawAgainst(address(deed), TOKEN_ID, 750 ether);
 Vm.Log memory drawn = _log(registry.PLEDGED_SIG());
 uint64 drawnAt = TIP - MIN_CONF - 100;

 registry.reportCollision(_relayFrom(SEPOLIA, drawnAt, drawn));

 registry.registerSettlement(_harborSettle());
 registry.registerRelease(_harborRelease());

 registry.registerPledge(_relayFrom(SEPOLIA, drawnAt, drawn));

 SingletonRegistry.Record memory r = registry.getStatus(assetKey);

 assertEq(r.emitter, address(meridian), "the lender that lost the race now holds it");
 assertEq(
 registry.collisionCount(assetKey),
 0,
 "and is not on file as a refused claimant against its own lien"
 );
 }

 // ---------------------------------------------------------------- 2

 /**
 * SETTLED means the debt is repaid while the registry still treats the asset
 * as taken, because only the source chain can say the lien is over. A later
 * borrow is therefore refused, but it is not filed as a double pledge: no
 * two lenders ever overlapped.
 */
 function test_aSettledLienBlocksTheAssetWithoutAccusingTheNextBorrower() public {
 registry.registerPledge(_harborPledge(1000 ether));
 registry.registerSettlement(_harborSettle());

 assertEq(
 uint8(registry.getStatus(assetKey).state),
 uint8(SingletonRegistry.AssetState.SETTLED),
 "the debt is repaid"
 );

 SingletonRegistry.Proof memory later = _meridianPledge(750 ether);

 vm.expectRevert(
 abi.encodeWithSelector(
 SingletonRegistry.AssetNotFree.selector, assetKey, address(harbor)
 )
 );
 registry.registerPledge(later);

 /*
 The asset is still blocked until the lender proves the release, which
 is caveat territory rather than a bug: the source chain, not the
 registry, decides when a lien is over. But the second borrow is not a
 collision, because the first debt was repaid before it happened, and
 filing it as one would accuse a borrower who did nothing wrong.
 */
 vm.expectRevert(
 abi.encodeWithSelector(SingletonRegistry.NoCollisionToReport.selector, assetKey)
 );
 registry.reportCollision(later);
 }

 /**
 * The earlier pledge can lose, and lose silently.
 *
 * Priority here is decided by which proof reaches Creditcoin first, not by
 * which pledge is older on the source chain, and the two come apart. A
 * pledge is unregistrable until the attested tip has passed it by the
 * confirmation depth, which is about twenty minutes, and the tip advances in
 * jumps of ten source blocks, so two pledges within the same ten block band
 * become registrable in the same instant with no head start for the earlier.
 *
 * Losing that race would be tolerable if it left a mark. It does not. The
 * later pledge takes the asset, the earlier one is refused as
 * `AssetNotFree`, and the refusal list will not take it either, because
 * `reportCollision` rejects anything older than the record on file. The
 * guard is right about what it was written for, an ancient closed lien filed
 * against whoever holds the asset today, and it cannot tell that case apart
 * from this one. So the honest earlier lender ends with no entry anywhere.
 */
 function test_theEarlierPledgeCanLoseTheRaceAndLeaveNoTrace() public {
 SingletonRegistry.Proof memory earlier = _harborPledge(1000 ether);
 SingletonRegistry.Proof memory later = _meridianPledge(750 ether);
 assertLt(earlier.height, later.height, "Harbor pledged first on the source chain");

 registry.registerPledge(later);

 vm.expectRevert(
 abi.encodeWithSelector(
 SingletonRegistry.AssetNotFree.selector, assetKey, address(meridian)
 )
 );
 registry.registerPledge(earlier);

 vm.expectRevert(
 abi.encodeWithSelector(
 SingletonRegistry.StaleCollision.selector, earlier.height, later.height
 )
 );
 registry.reportCollision(earlier);

 assertEq(registry.collisionCount(assetKey), 0, "and nothing on the refusal list either");
 }

 // ---------------------------------------------------------------- 3

 /**
 * The registry accepts a pledge from an emitter whose adapter has declared
 * that it cannot prove a release. Nothing the source chain does afterwards
 * gets the asset back: it emits the release, the registry refuses to read
 * it, and the record stands. The one thing that lifts it is the next test,
 * and it is not something any party to the lien can do.
 */
 function test_anAdapterWithoutAReleaseTrapsTheAssetUntilAnAdminActs() public {
 NoReleaseAdapter half = new NoReleaseAdapter();
 registry.setAdapter(SEPOLIA, address(atlas), address(half));

 vm.recordLogs();
 vm.prank(BORROWER);
 bytes32 positionId = atlas.lock(address(deed), TOKEN_ID, 1200 ether);
 registry.registerPledge(_relay(_log(half.LOCKED_SIG())));

 vm.recordLogs();
 atlas.clear(positionId);
 registry.registerSettlement(_relay(_log(half.CLEARED_SIG())));

 vm.recordLogs();
 atlas.unlock(positionId);
 SingletonRegistry.Proof memory release = _relay(_log(half.UNLOCKED_SIG()));

 vm.expectRevert(
 abi.encodeWithSelector(
 SingletonRegistry.TransitionUnsupported.selector, address(atlas), uint8(2)
 )
 );
 registry.registerRelease(release);

 // The source chain has handed the collateral back and the registry
 // still says the asset is taken. There is one path that changes it, and
 // it belongs to the administrator rather than to anybody involved.
 assertEq(
 uint8(registry.getStatus(assetKey).state),
 uint8(SingletonRegistry.AssetState.SETTLED),
 "stuck in SETTLED"
 );
 assertEq(
 registry.assetOfInstance(SEPOLIA, address(atlas), positionId),
 assetKey,
 "and the instance index is stuck with it"
 );
 assertEq(
 registry.certificateOf(assetKey),
 address(atlas),
 "and so is the certificate of priority"
 );

 SingletonRegistry.Proof memory honest = _harborPledge(1000 ether);
 vm.expectRevert(
 abi.encodeWithSelector(
 SingletonRegistry.AssetNotFree.selector, assetKey, address(atlas)
 )
 );
 registry.registerPledge(honest);
 }

 /**
 * The adapter power used to run backwards as well as forwards.
 *
 * `AdminPower.t.sol` shows the administrator writing a lien against an
 * asset whose owner was never involved. The same lever used to clear one:
 * swapping the half adapter for the reference one let the *real*
 * `CollateralUnlocked` log, already emitted on the source chain and already
 * refused here, go through and free the asset.
 *
 * That recovery is exactly the power caveat 9 now removes, on purpose: the
 * adapter freezes the first time it is actually used, in either direction,
 * so the same lever that could have lifted this trap can no longer be
 * pulled once the trap exists. A registry that needs its operator to
 * unstick it was not neutral at that moment, and removing the unstick is
 * the more neutral of the two trades, at the cost that this asset, once
 * trapped by an honest gap in the adapter rather than by anything
 * adversarial, now has no recovery path at all. Both halves are tested:
 * the trap still forms, and the swap that used to lift it now reverts.
 */
 function test_theTrapCannotBeLiftedOnceTheAdapterIsFrozen() public {
 NoReleaseAdapter half = new NoReleaseAdapter();
 registry.setAdapter(SEPOLIA, address(atlas), address(half));

 vm.recordLogs();
 vm.prank(BORROWER);
 bytes32 positionId = atlas.lock(address(deed), TOKEN_ID, 1200 ether);
 registry.registerPledge(_relay(_log(half.LOCKED_SIG())));

 vm.recordLogs();
 atlas.clear(positionId);
 registry.registerSettlement(_relay(_log(half.CLEARED_SIG())));

 vm.recordLogs();
 atlas.unlock(positionId);
 SingletonRegistry.Proof memory release = _relay(_log(half.UNLOCKED_SIG()));

 vm.expectRevert(
 abi.encodeWithSelector(
 SingletonRegistry.TransitionUnsupported.selector, address(atlas), uint8(2)
 )
 );
 registry.registerRelease(release);

 // Built before the expectation is armed: a CREATE is itself a call
 // Foundry's expectRevert can latch onto, and one that succeeds clears
 // the expectation before the call actually under test ever runs.
 address fuller = address(new LockedCollateralAdapter());
 vm.expectRevert(
 abi.encodeWithSelector(SingletonRegistry.AdapterFrozen.selector, SEPOLIA, address(atlas))
 );
 registry.setAdapter(SEPOLIA, address(atlas), fuller);

 assertEq(
 uint8(registry.getStatus(assetKey).state),
 uint8(SingletonRegistry.AssetState.SETTLED),
 "still stuck, and now permanently: the swap that would have freed it is blocked"
 );
 }

 // ---------------------------------------------------------------- 4

 /**
 * `registerPledge` insists the collateral is named and never that the
 * instance is. An adapter that cannot name one returns zero, and the
 * emitter is then limited to a single open lien across the whole registry:
 * every further pledge it makes is refused as an instance already open.
 */
 /**
 * Who holds the key to the exit, in the schema both demo lenders use.
 *
 * A settled lien still blocks the asset, which is pinned above. What is not
 * obvious is who can unblock it. Both emitters here separate repayment from
 * discharge, and in both the discharge is the lender's to give: Harbor's
 * `dischargeLien` is desk only and Meridian's `closePosition` is underwriter
 * only. A borrower who has repaid in full cannot produce the log that frees
 * their own asset, and neither can the registry. That is not a bug in the
 * registry, which is reading a chain and cannot be more available than what
 * it reads, but it is the shape of the risk, and it is the reason the two
 * shipped mainnet adapters map repayment itself to a release rather than
 * waiting for a second event that may never come.
 */
 function test_theBorrowerCannotFreeTheirOwnAssetAfterRepaying() public {
 registry.registerPledge(_meridianPledge(750 ether));

 vm.recordLogs();
 vm.prank(BORROWER);
 meridian.repay(0);
 registry.registerSettlement(_relay(_log(registry.SETTLED_SIG())));

 assertEq(
 uint8(registry.getStatus(assetKey).state),
 uint8(SingletonRegistry.AssetState.SETTLED),
 "repaid in full, and still not free"
 );

 vm.expectRevert();
 vm.prank(BORROWER);
 meridian.closePosition(0);

 vm.recordLogs();
 meridian.closePosition(0);
 registry.registerRelease(_relay(_log(registry.RELEASED_SIG())));

 assertEq(
 uint8(registry.getStatus(assetKey).state),
 uint8(SingletonRegistry.AssetState.FREE),
 "only the underwriter could produce the log that frees it"
 );

 registry.registerPledge(_harborPledge(1000 ether));
 registry.registerSettlement(_harborSettle());

 vm.expectRevert(HarborCredit.NotDesk.selector);
 vm.prank(BORROWER);
 harbor.dischargeLien(address(deed), TOKEN_ID);

 registry.registerRelease(_harborRelease());

 assertEq(
 uint8(registry.getStatus(assetKey).state),
 uint8(SingletonRegistry.AssetState.FREE),
 "the other lender's desk held the same key"
 );
 }

 function test_anEmitterWhoseInstanceIdRepeatsCanHoldOnlyOneLienAtATime() public {
 FlatInstanceAdapter flat = new FlatInstanceAdapter();
 registry.setAdapter(SEPOLIA, address(atlas), address(flat));

 vm.recordLogs();
 vm.prank(BORROWER);
 atlas.lock(address(deed), TOKEN_ID, 1200 ether);
 registry.registerPledge(_relay(_log(flat.LOCKED_SIG())));

 assertEq(
 registry.assetOfInstance(SEPOLIA, address(atlas), bytes32(0)),
 assetKey,
 "the zero instance is now taken"
 );

 // A different asset, a different borrower position, the same lender.
 vm.recordLogs();
 vm.prank(BORROWER);
 atlas.lock(address(deed), SECOND_TOKEN, 900 ether);
 SingletonRegistry.Proof memory second = _relay(_log(flat.LOCKED_SIG()));

 vm.expectRevert(
 abi.encodeWithSelector(
 SingletonRegistry.InstanceAlreadyOpen.selector, address(atlas), bytes32(0)
 )
 );
 registry.registerPledge(second);

 assertEq(
 uint8(
 registry.getStatus(registry.assetKeyOf(SEPOLIA, address(deed), SECOND_TOKEN)).state
 ),
 uint8(SingletonRegistry.AssetState.FREE),
 "a genuine first filing was refused and nothing records that it happened"
 );
 }
}

/// A protocol that publishes a lock and a clear, and cannot prove a release.
contract NoReleaseAdapter is IPledgeAdapter {
 bytes32 public constant LOCKED_SIG =
 keccak256("CollateralLocked(bytes32,address,address,uint256,uint256)");
 bytes32 public constant CLEARED_SIG =
 keccak256("ObligationCleared(bytes32,address,address,uint256,uint256)");
 bytes32 public constant UNLOCKED_SIG =
 keccak256("CollateralUnlocked(bytes32,address,address,uint256,uint256)");

 function signaturesFor(uint8 kind) external pure returns (bytes32[] memory signatures) {
 if (kind == 2) return new bytes32[](0);
 signatures = new bytes32[](1);
 signatures[0] = kind == 0 ? LOCKED_SIG : CLEARED_SIG;
 }

 function translate(uint8, EvmV1Decoder.LogEntry calldata log)
 external
 pure
 returns (address, uint256, address, uint256, bytes32)
 {
 (uint256 tokenId, uint256 amount) = abi.decode(log.data, (uint256, uint256));
 return (
 address(uint160(uint256(log.topics[2]))),
 tokenId,
 address(uint160(uint256(log.topics[3]))),
 amount,
 log.topics[1]
 );
 }
}

/// A protocol whose lifecycle events carry no id the adapter can lift.
contract FlatInstanceAdapter is IPledgeAdapter {
 bytes32 public constant LOCKED_SIG =
 keccak256("CollateralLocked(bytes32,address,address,uint256,uint256)");
 bytes32 public constant UNLOCKED_SIG =
 keccak256("CollateralUnlocked(bytes32,address,address,uint256,uint256)");

 function signaturesFor(uint8 kind) external pure returns (bytes32[] memory signatures) {
 if (kind == 1) return new bytes32[](0);
 signatures = new bytes32[](1);
 signatures[0] = kind == 0 ? LOCKED_SIG : UNLOCKED_SIG;
 }

 function translate(uint8, EvmV1Decoder.LogEntry calldata log)
 external
 pure
 returns (address, uint256, address, uint256, bytes32)
 {
 (uint256 tokenId, uint256 amount) = abi.decode(log.data, (uint256, uint256));
 return (
 address(uint160(uint256(log.topics[2]))),
 tokenId,
 address(uint160(uint256(log.topics[3]))),
 amount,
 bytes32(0)
 );
 }
}
