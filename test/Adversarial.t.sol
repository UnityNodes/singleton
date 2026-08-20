// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Vm} from "forge-std/Test.sol";
import {SourceChain} from "./support/SourceChain.sol";
import {SingletonRegistry} from "../src/SingletonRegistry.sol";
import {RwaDeed} from "../src/emitters/RwaDeed.sol";
import {HarborCredit} from "../src/emitters/HarborCredit.sol";
import {MeridianCredit} from "../src/emitters/MeridianCredit.sol";

/**
 * What an attacker gets to try.
 *
 * The registry's whole safety claim is that the sender carries no authority and
 * the proof carries all of it. These are the ways to attack that claim which do
 * not require breaking the precompile itself.
 */
contract AdversarialTest is SourceChain {
    SingletonRegistry registry;
    RwaDeed deed;
    HarborCredit harbor;
    MeridianCredit meridian;

    address constant ATTACKER = address(0xBAD);

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

    function _harborPledge(uint256 amount) internal returns (SingletonRegistry.Proof memory) {
        vm.recordLogs();
        vm.prank(BORROWER);
        harbor.openLien(address(deed), TOKEN_ID, amount);
        return _relay(_log(registry.PLEDGED_SIG()));
    }

    /// Anybody may relay, and that is the design: authority is in the bytes.
    function test_aStrangerMayRelaySomebodyElsesPledge() public {
        SingletonRegistry.Proof memory p = _harborPledge(1000 ether);

        vm.prank(ATTACKER);
        registry.registerPledge(p);

        assertEq(registry.getStatus(assetKey).emitter, address(harbor), "recorded for the lender");
        assertEq(registry.certificateOf(assetKey), address(harbor), "not for the relayer");
    }

    /// A log the attacker wrote themselves is not from an allowlisted address.
    function test_aForgedLogFromAnUnknownContractIsRefused() public {
        Impostor impostor = new Impostor();

        vm.recordLogs();
        impostor.forgePledge(address(deed), TOKEN_ID, ATTACKER, 1 ether);
        SingletonRegistry.Proof memory forged = _relay(_log(registry.PLEDGED_SIG()));

        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.EmitterNotAllowed.selector, SEPOLIA, address(impostor)
            )
        );
        registry.registerPledge(forged);
    }

    /// The proof binds the chain it was taken from, so a Sepolia lien cannot
    /// freeze the same token contract and id on mainnet.
    function test_aSepoliaProofDoesNotSettleTheMainnetAsset() public {
        registry.registerPledge(_harborPledge(1000 ether));

        bytes32 mainnetKey = registry.assetKeyOf(3, address(deed), TOKEN_ID);
        assertTrue(mainnetKey != assetKey, "different chains, different keys");
        assertEq(
            uint8(registry.getStatus(mainnetKey).state), uint8(SingletonRegistry.AssetState.FREE)
        );
    }

    /// A settlement the attacker relays for a lien that is not theirs changes
    /// nothing, even though the log itself is genuine.
    function test_aGenuineSettlementFromTheWrongLenderChangesNothing() public {
        registry.registerPledge(_harborPledge(1000 ether));

        vm.prank(BORROWER);
        meridian.drawAgainst(address(deed), TOKEN_ID, 750 ether);
        vm.recordLogs();
        vm.prank(BORROWER);
        meridian.repay(0);
        SingletonRegistry.Proof memory foreign = _relay(_log(registry.SETTLED_SIG()));

        vm.prank(ATTACKER);
        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.NotTheIncumbent.selector, address(harbor), address(meridian)
            )
        );
        registry.registerSettlement(foreign);

        assertEq(
            uint8(registry.getStatus(assetKey).state), uint8(SingletonRegistry.AssetState.PLEDGED)
        );
    }

    /// The admin cannot mint a certificate or write a record directly. What an
    /// adapter lets them do instead is in AdminPower.t.sol, which is the honest
    /// version of this claim.
    function test_theAdminCannotWriteALienDirectly() public {
        assertEq(registry.admin(), address(this));

        vm.expectRevert();
        registry.ownerOf(uint256(assetKey));

        registry.setEmitter(SEPOLIA, address(harbor), false);
        SingletonRegistry.Proof memory p = _harborPledge(1000 ether);

        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.EmitterNotAllowed.selector, SEPOLIA, address(harbor)
            )
        );
        registry.registerPledge(p);

        assertEq(
            uint8(registry.getStatus(assetKey).state), uint8(SingletonRegistry.AssetState.FREE)
        );
    }

    function test_onlyTheAdminMovesTheAllowlist() public {
        vm.prank(ATTACKER);
        vm.expectRevert(SingletonRegistry.NotAdmin.selector);
        registry.setEmitter(SEPOLIA, ATTACKER, true);

        vm.prank(ATTACKER);
        vm.expectRevert(SingletonRegistry.NotAdmin.selector);
        registry.setAdapter(SEPOLIA, address(harbor), ATTACKER);
    }
}

/// Emits the registry's event shape from a contract nobody allowlisted.
contract Impostor {
    event Pledged(
        address indexed collateralToken,
        uint256 indexed tokenId,
        address indexed borrower,
        uint256 amount,
        bytes32 pledgeInstanceId
    );

    function forgePledge(address token, uint256 tokenId, address borrower, uint256 amount)
        external
    {
        emit Pledged(token, tokenId, borrower, amount, keccak256("forged"));
    }
}
