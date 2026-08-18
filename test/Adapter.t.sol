// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {SourceChain} from "./support/SourceChain.sol";
import {SingletonRegistry} from "../src/SingletonRegistry.sol";
import {LockedCollateralAdapter} from "../src/adapters/LockedCollateralAdapter.sol";
import {RwaDeed} from "../src/emitters/RwaDeed.sol";
import {HarborCredit} from "../src/emitters/HarborCredit.sol";
import {AtlasVault} from "./mocks/AtlasVault.sol";
import {IPledgeAdapter} from "../src/interfaces/IPledgeAdapter.sol";
import {EvmV1Decoder} from "../src/vendor/EvmV1Decoder.sol";

/**
 * Reading a protocol that speaks its own schema.
 *
 * Atlas emits nothing the registry understands natively. With an adapter behind
 * it, its liens land in the same key space as Harbor's, which is the point: an
 * asset pledged in one protocol and then in an unrelated protocol with an
 * unrelated event still collides.
 */
contract AdapterTest is SourceChain {
    SingletonRegistry registry;
    LockedCollateralAdapter adapter;
    RwaDeed deed;
    HarborCredit harbor;
    AtlasVault atlas;

    bytes32 assetKey;

    function setUp() public {
        _installPrecompiles();

        deed = new RwaDeed();
        harbor = new HarborCredit();
        atlas = new AtlasVault();
        adapter = new LockedCollateralAdapter();

        deed.mint(BORROWER, TOKEN_ID);

        registry = new SingletonRegistry();
        registry.setMinConfirmations(SEPOLIA, MIN_CONF);
        registry.setEmitter(SEPOLIA, address(harbor), true);
        registry.setEmitter(SEPOLIA, address(atlas), true);
        registry.setAdapter(SEPOLIA, address(atlas), address(adapter));

        assetKey = registry.assetKeyOf(SEPOLIA, address(deed), TOKEN_ID);
    }

    // ------------------------------------------------------------- helpers

    function _atlasLock(uint256 principal)
        internal
        returns (bytes32 positionId, SingletonRegistry.Proof memory p)
    {
        vm.recordLogs();
        vm.prank(BORROWER);
        positionId = atlas.lock(address(deed), TOKEN_ID, principal);
        p = _relay(_log(adapter.LOCKED_SIG()));
    }

    function _harborPledge(uint256 amount) internal returns (SingletonRegistry.Proof memory) {
        vm.recordLogs();
        vm.prank(BORROWER);
        harbor.openLien(address(deed), TOKEN_ID, amount);
        return _relay(_log(registry.PLEDGED_SIG()));
    }

    // --------------------------------------------------------------- tests

    function test_aForeignSchemaIsReadThroughItsAdapter() public {
        (bytes32 positionId, SingletonRegistry.Proof memory p) = _atlasLock(1200 ether);
        assertEq(registry.registerPledge(p), assetKey, "same key space as the native schema");

        SingletonRegistry.Record memory r = registry.getStatus(assetKey);
        assertEq(uint8(r.state), uint8(SingletonRegistry.AssetState.PLEDGED));
        assertEq(r.emitter, address(atlas));
        assertEq(r.borrower, BORROWER);
        assertEq(r.amount, 1200 ether, "amount read from the data tail");
        assertEq(r.instanceId, positionId, "instance id read from the leading topic");
    }

    /// The collision that matters: two protocols, two event schemas, one asset.
    function test_aForeignPledgeCollidesWithANativeOne() public {
        registry.registerPledge(_harborPledge(1000 ether));

        (, SingletonRegistry.Proof memory foreign) = _atlasLock(1200 ether);

        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.AssetNotFree.selector, assetKey, address(harbor)
            )
        );
        registry.registerPledge(foreign);

        registry.reportCollision(foreign);
        assertEq(registry.collisionAt(assetKey, 0).emitter, address(atlas));
    }

    function test_theForeignLifecycleRunsThroughTheSameEntryPoints() public {
        (bytes32 positionId, SingletonRegistry.Proof memory pledge) = _atlasLock(1200 ether);
        registry.registerPledge(pledge);

        vm.recordLogs();
        atlas.clear(positionId);
        registry.registerSettlement(_relay(_log(adapter.CLEARED_SIG())));
        assertEq(
            uint8(registry.getStatus(assetKey).state), uint8(SingletonRegistry.AssetState.SETTLED)
        );

        vm.recordLogs();
        atlas.unlock(positionId);
        registry.registerRelease(_relay(_log(adapter.UNLOCKED_SIG())));
        assertEq(
            uint8(registry.getStatus(assetKey).state), uint8(SingletonRegistry.AssetState.FREE)
        );
        assertEq(registry.certificateOf(assetKey), address(0), "certificate burned");
    }

    /// Without the adapter the log is simply invisible: the registry looks for a
    /// signature this protocol never emits.
    function test_theSameLogIsUnreadableOnceTheAdapterIsRemoved() public {
        registry.setAdapter(SEPOLIA, address(atlas), address(0));

        (, SingletonRegistry.Proof memory p) = _atlasLock(1200 ether);

        vm.expectRevert(SingletonRegistry.NoPledgeLog.selector);
        registry.registerPledge(p);
    }

    function test_anAdapterWithoutATransitionRefusesThatTransition() public {
        HalfAdapter half = new HalfAdapter();
        registry.setAdapter(SEPOLIA, address(atlas), address(half));

        (bytes32 positionId, SingletonRegistry.Proof memory pledge) = _atlasLock(1200 ether);
        registry.registerPledge(pledge);

        vm.recordLogs();
        atlas.clear(positionId);
        SingletonRegistry.Proof memory settlement = _relay(_log(adapter.CLEARED_SIG()));

        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.TransitionUnsupported.selector, address(atlas), uint8(1)
            )
        );
        registry.registerSettlement(settlement);
    }
}

/// An adapter for a protocol that publishes a lock event and nothing else.
contract HalfAdapter is IPledgeAdapter {
    bytes32 public constant LOCKED_SIG =
        keccak256("CollateralLocked(bytes32,address,address,uint256,uint256)");

    function signaturesFor(uint8 kind) external pure returns (bytes32[] memory signatures) {
        if (kind != 0) return new bytes32[](0);
        signatures = new bytes32[](1);
        signatures[0] = LOCKED_SIG;
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
