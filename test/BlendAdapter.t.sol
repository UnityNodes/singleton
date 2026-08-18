// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Vm} from "forge-std/Test.sol";
import {SourceChain} from "./support/SourceChain.sol";
import {SingletonRegistry} from "../src/SingletonRegistry.sol";
import {BlendAdapter} from "../src/adapters/BlendAdapter.sol";
import {NftfiV3Adapter} from "../src/adapters/NftfiV3Adapter.sol";

/**
 * Blur's Blend, in real bytes.
 *
 * Lien 435829 on mainnet: a Pudgy Penguin put up for 3.29 ether in block
 * 25,711,377 and repaid in block 25,721,378. Neither log indexes anything and
 * the repayment names no token id, which is exactly why this protocol is worth
 * testing rather than the one that fits.
 */
contract BlendAdapterTest is SourceChain {
    address constant BLEND = 0x29469395eAf6f95920E59F858042f0e28D98a20B;
    address constant NFTFI = 0xB6adEc2ACc851d30d5fB64f3137234BCDCBBad0D;

    address constant COLLECTION = 0xBd3531dA5CF5857e7CfAA92426877b022e612cf8;
    uint256 constant TOKEN = 8189;
    address constant OBLIGOR = 0xeb83E695adCac2e83f290d2d2815FC58e6491d7A;
    uint256 constant PRINCIPAL = 3_290_000_000_000_000_000;
    bytes32 constant LIEN_ID = bytes32(uint256(0x6a675));

    uint64 constant TAKEN_AT = 25_711_377;
    uint64 constant REPAID_AT = 25_721_378;

    uint256 constant SEIZED_TOKEN = 4271;
    bytes32 constant SEIZED_LIEN_ID = bytes32(uint256(0x6b2ac));
    uint64 constant SEIZED_TAKEN_AT = 25_550_390;
    uint64 constant SEIZED_AT = 25_651_509;

    SingletonRegistry registry;
    BlendAdapter adapter;

    bytes32 assetKey;

    function setUp() public {
        _installPrecompiles();

        adapter = new BlendAdapter();

        registry = new SingletonRegistry();
        registry.setMinConfirmations(ETHEREUM, MIN_CONF);
        registry.setEmitter(ETHEREUM, BLEND, true);
        registry.setAdapter(ETHEREUM, BLEND, address(adapter));

        assetKey = registry.assetKeyOf(ETHEREUM, COLLECTION, TOKEN);
    }

    // ------------------------------------------------- fixtures from mainnet

    /// LoanOfferTaken, transaction 0xb1de5da8a64d1f0791799712c2fd9378a483e68a5c83ccaa71801692cb7acb14
    function _loanOfferTaken() internal pure returns (Vm.Log memory entry) {
        bytes32[] memory topics = new bytes32[](1);
        topics[0] = 0x06a333c2d6fe967ca967f7a35be2eb45e8caeb6cf05e16f55d42b91b5fe31255;

        entry.emitter = BLEND;
        entry.topics = topics;
        entry.data =
            hex"9b5777a1633dd5d60d5b40cbf8ba5f4b907ad259aa4aefb13ac702a38db1f6f0"
            hex"000000000000000000000000000000000000000000000000000000000006a675"
            hex"000000000000000000000000bd3531da5cf5857e7cfaa92426877b022e612cf8"
            hex"000000000000000000000000d22be1c0ae3e0e87a69f149cb1948309846d2332"
            hex"000000000000000000000000eb83e695adcac2e83f290d2d2815fc58e6491d7a"
            hex"0000000000000000000000000000000000000000000000002da86d919f090000"
            hex"00000000000000000000000000000000000000000000000000000000000006fe"
            hex"0000000000000000000000000000000000000000000000000000000000001ffd"
            hex"0000000000000000000000000000000000000000000000000000000000002328";
    }

    /// Repay, transaction 0x568aae92f2a4052fc516d0e2260cc0d157f35fcf22646a7e1de3c2906dfe21e4
    function _repay() internal pure returns (Vm.Log memory entry) {
        bytes32[] memory topics = new bytes32[](1);
        topics[0] = 0x2469cc9e12e74c63438d5b1117b318cd3a4cdaf9d659d9eac6d975d14d963254;

        entry.emitter = BLEND;
        entry.topics = topics;
        entry.data =
            hex"000000000000000000000000000000000000000000000000000000000006a675"
            hex"000000000000000000000000bd3531da5cf5857e7cfaa92426877b022e612cf8";
    }

    // --------------------------------------------------------------- tests

    function test_aBlendLienIsReadFromDataAlone() public {
        bytes32 key = registry.registerPledge(_relayFrom(ETHEREUM, TAKEN_AT, _loanOfferTaken()));
        assertEq(key, assetKey, "collection and token id come out of the data");

        SingletonRegistry.Record memory r = registry.getStatus(key);
        assertEq(r.emitter, BLEND);
        assertEq(r.borrower, OBLIGOR);
        assertEq(r.amount, PRINCIPAL, "3.29 ether");
        assertEq(r.instanceId, LIEN_ID, "lien id becomes the instance id");
        assertEq(registry.assetOfInstance(ETHEREUM, BLEND, LIEN_ID), key, "indexed by instance");
    }

    /// The repayment names no token id at all. The lien still closes, because
    /// the registry remembers which asset this emitter opened under this id.
    function test_aRepaymentWithoutATokenIdStillClosesTheLien() public {
        registry.registerPledge(_relayFrom(ETHEREUM, TAKEN_AT, _loanOfferTaken()));
        registry.registerRelease(_relayFrom(ETHEREUM, REPAID_AT, _repay()));

        assertEq(uint8(registry.getStatus(assetKey).state), uint8(SingletonRegistry.AssetState.FREE));
        assertEq(registry.certificateOf(assetKey), address(0));
        assertEq(registry.assetOfInstance(ETHEREUM, BLEND, LIEN_ID), bytes32(0), "index cleared");
    }

    /// Each emitter is read under its own schema, so Blend's repayment carried
    /// under NFTfi's address is not a repayment at all: the registry looks for
    /// what NFTfi emits, finds nothing, and the Blend lien is untouched.
    function test_oneProtocolCannotResolveIntoAnothersLien() public {
        NftfiV3Adapter nftfi = new NftfiV3Adapter();
        registry.setEmitter(ETHEREUM, NFTFI, true);
        registry.setAdapter(ETHEREUM, NFTFI, address(nftfi));

        registry.registerPledge(_relayFrom(ETHEREUM, TAKEN_AT, _loanOfferTaken()));

        SingletonRegistry.Proof memory repay = _relayFrom(ETHEREUM, REPAID_AT, _repayFrom(NFTFI));

        vm.expectRevert(SingletonRegistry.NoPledgeLog.selector);
        registry.registerRelease(repay);

        assertEq(
            uint8(registry.getStatus(assetKey).state),
            uint8(SingletonRegistry.AssetState.PLEDGED),
            "the lien stands"
        );
        assertEq(registry.assetOfInstance(ETHEREUM, BLEND, LIEN_ID), assetKey);
    }

    /// A lien that was never opened cannot be closed by naming its id.
    function test_aRepaymentForAnUnknownLienIsRefused() public {
        SingletonRegistry.Proof memory repay = _relayFrom(ETHEREUM, REPAID_AT, _repay());

        vm.expectRevert(
            abi.encodeWithSelector(SingletonRegistry.UnknownInstance.selector, BLEND, LIEN_ID)
        );
        registry.registerRelease(repay);
    }

    /// Blend reuses no lien id while a lien is open, and the registry does not
    /// take the protocol's word for it.
    function test_theSameOpenInstanceCannotBeOpenedTwice() public {
        registry.registerPledge(_relayFrom(ETHEREUM, TAKEN_AT, _loanOfferTaken()));

        SingletonRegistry.Proof memory again =
            _relayFrom(ETHEREUM, TAKEN_AT + 1, _loanOfferTaken());

        vm.expectRevert(
            abi.encodeWithSelector(SingletonRegistry.AssetNotFree.selector, assetKey, BLEND)
        );
        registry.registerPledge(again);
    }

    /// A seized lien, in real bytes: lien 438956, Pudgy Penguin 4271, taken for
    /// 3.868 ether in block 25,550,390 and taken away in block 25,651,509 when
    /// the auction failed. Blend ends a lien two ways and both are proven.
    function test_aSeizedLienIsClosedToo() public {
        registry.registerPledge(_relayFrom(ETHEREUM, SEIZED_TAKEN_AT, _seizedLoanTaken()));

        bytes32 seizedKey = registry.assetKeyOf(ETHEREUM, COLLECTION, SEIZED_TOKEN);
        assertEq(
            uint8(registry.getStatus(seizedKey).state), uint8(SingletonRegistry.AssetState.PLEDGED)
        );

        registry.registerRelease(_relayFrom(ETHEREUM, SEIZED_AT, _seize()));

        assertEq(uint8(registry.getStatus(seizedKey).state), uint8(SingletonRegistry.AssetState.FREE));
        assertEq(registry.assetOfInstance(ETHEREUM, BLEND, SEIZED_LIEN_ID), bytes32(0));
    }

    /// LoanOfferTaken, transaction 0xa4e776eeca5fd7f35209c94f92523847920d2c113f21baee7d13ee50c3a79e8c
    function _seizedLoanTaken() internal pure returns (Vm.Log memory entry) {
        bytes32[] memory topics = new bytes32[](1);
        topics[0] = 0x06a333c2d6fe967ca967f7a35be2eb45e8caeb6cf05e16f55d42b91b5fe31255;

        entry.emitter = BLEND;
        entry.topics = topics;
        entry.data =
            hex"c0d37f3496d3a1eee34b7a04a3fbb2e258fcb4c8e633978a42473a9455855d7d"
            hex"000000000000000000000000000000000000000000000000000000000006b2ac"
            hex"000000000000000000000000bd3531da5cf5857e7cfaa92426877b022e612cf8"
            hex"000000000000000000000000223ee0c3dc4be9fadb623c12e8be9443130e8377"
            hex"0000000000000000000000002d5b791946e6602df44c511610f984b0884ff6f5"
            hex"00000000000000000000000000000000000000000000000035aee9f75243ac8e"
            hex"0000000000000000000000000000000000000000000000000000000000000186"
            hex"00000000000000000000000000000000000000000000000000000000000010af"
            hex"0000000000000000000000000000000000000000000000000000000000002328";
    }

    /// Seize, transaction 0xf6605120155b6b3e6edb8b97b6a6c70a9f3e6b0044dd126e4827627983172a33
    function _seize() internal pure returns (Vm.Log memory entry) {
        bytes32[] memory topics = new bytes32[](1);
        topics[0] = 0xb71caf41fe0e019dbe21a1ae3493f11a729c31548ed1e304ae7f6e8c8df275de;

        entry.emitter = BLEND;
        entry.topics = topics;
        entry.data =
            hex"000000000000000000000000000000000000000000000000000000000006b2ac"
            hex"000000000000000000000000bd3531da5cf5857e7cfaa92426877b022e612cf8";
    }

    /// A repayment log from a contract nobody allowlisted resolves to nothing.
    function _repayFrom(address emitter) internal pure returns (Vm.Log memory entry) {
        entry = _repay();
        entry.emitter = emitter;
    }
}
