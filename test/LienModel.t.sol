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
    function test_theRefusalStaysOnFileAgainstTheLenderThatLaterWonTheAsset() public {
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
        SingletonRegistry.Collision memory c = registry.collisionAt(assetKey, 0);

        assertEq(registry.collisionCount(assetKey), 1, "the refusal outlived the lien");
        assertEq(r.emitter, address(meridian), "the incumbent");
        assertEq(c.emitter, r.emitter, "and the refused second claimant are the same lender");
        assertEq(c.amount, r.amount, "for the same principal");
        assertEq(c.sourceHeight, r.sourceHeight, "proven from the same source block");
    }

    // ---------------------------------------------------------------- 2

    /**
     * SETTLED means the debt is repaid, and the registry still treats the asset
     * as taken. A lender that lends against it next is refused, and the refusal
     * is filed as a double pledge even though no two lenders ever overlapped.
     */
    function test_aSettledLienStillBlocksTheAssetAndFilesTheNextBorrowAsACollision() public {
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

        // The same proof, filed on the collision path, is accepted and recorded
        // as somebody trying to lend against a live lien.
        registry.reportCollision(later);
        assertEq(registry.collisionCount(assetKey), 1, "a repaid lien produced a collision");
    }

    // ---------------------------------------------------------------- 3

    /**
     * The registry accepts a pledge from an emitter whose adapter has declared
     * that it cannot prove a release, and there is no other way out of the
     * record. The asset is claimed forever.
     */
    function test_anAdapterWithoutAReleaseTrapsTheAssetPermanently() public {
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
        // still says the asset is taken, with no path that can change it.
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
            abi.encodeWithSelector(SingletonRegistry.AssetNotFree.selector, assetKey, address(atlas))
        );
        registry.registerPledge(honest);
    }

    // ---------------------------------------------------------------- 4

    /**
     * `registerPledge` insists the collateral is named and never that the
     * instance is. An adapter that cannot name one returns zero, and the
     * emitter is then limited to a single open lien across the whole registry:
     * every further pledge it makes is refused as an instance already open.
     */
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
            uint8(registry.getStatus(registry.assetKeyOf(SEPOLIA, address(deed), SECOND_TOKEN)).state),
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
