// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Vm} from "forge-std/Test.sol";
import {SourceChain} from "./support/SourceChain.sol";
import {SingletonRegistry} from "../src/SingletonRegistry.sol";
import {NftfiV3Adapter} from "../src/adapters/NftfiV3Adapter.sol";

/**
 * A real loan, from a real protocol, in real bytes.
 *
 * Every topic and every byte of data below was read from Ethereum mainnet: loan
 * 16928 on NFTfi's CollectionOfferLoan, taken in block 25,506,517 and repaid in
 * block 25,717,460. Nothing here is authored by the test, which is the point,
 * because a hand written fixture proves only that the adapter agrees with
 * whoever wrote the fixture.
 *
 * The heights are the real ones too, and they sit inside the finality window of
 * the attested Ethereum tip the model mirrors from live CC3.
 */
contract NftfiAdapterTest is SourceChain {
    address constant NFTFI = 0xB6adEc2ACc851d30d5fB64f3137234BCDCBBad0D;

    address constant COLLECTION = 0xd774557b647330C91Bf44cfEAB205095f7E6c367;
    uint256 constant NFT_ID = 7819;
    address constant BORROWER_ONCHAIN = 0x4BC5Fa56f2931E7A37417FA55Dda71E4b7c2f2a3;
    address constant OBLIGATION_HOLDER_AT_REPAYMENT = 0x6F457744d4A69c99824175fBf68EFf853C6f28E7;
    uint256 constant PRINCIPAL = 70_000_000_000_000_000;
    bytes32 constant LOAN_ID = bytes32(uint256(0x4220));

    uint64 constant STARTED_AT = 25_506_517;
    uint64 constant REPAID_AT = 25_717_460;

    SingletonRegistry registry;
    NftfiV3Adapter adapter;

    bytes32 assetKey;

    function setUp() public {
        _installPrecompiles();

        adapter = new NftfiV3Adapter();

        registry = new SingletonRegistry();
        registry.setMinConfirmations(ETHEREUM, MIN_CONF);
        registry.setMinAttestors(ETHEREUM, MIN_ATTESTORS);
        registry.setEmitter(ETHEREUM, NFTFI, true);
        registry.setAdapter(ETHEREUM, NFTFI, address(adapter));

        assetKey = registry.assetKeyOf(ETHEREUM, COLLECTION, NFT_ID);
    }

    // ------------------------------------------------- fixtures from mainnet

    /// LoanStarted, transaction 0xa089fd2817f18f845ce04b550edab846badc6ecacfa7db8808b09f4be89b6c36
    function _loanStarted() internal pure returns (Vm.Log memory entry) {
        bytes32[] memory topics = new bytes32[](4);
        topics[0] = 0x4d3634f72248e203ec6eab4996f443daca55feea347f82ff609b2d0f5bbaae5a;
        topics[1] = 0x0000000000000000000000000000000000000000000000000000000000004220;
        topics[2] = 0x0000000000000000000000004bc5fa56f2931e7a37417fa55dda71e4b7c2f2a3;
        topics[3] = 0x000000000000000000000000223ee0c3dc4be9fadb623c12e8be9443130e8377;

        entry.emitter = NFTFI;
        entry.topics = topics;
        entry.data = hex"00000000000000000000000000000000000000000000000000f8b0a10e470000"
            hex"0000000000000000000000000000000000000000000000000100a962bf212862"
            hex"0000000000000000000000000000000000000000000000000000000000001e8b"
            hex"000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
            hex"0000000000000000000000000000000000000000000000000000000000278d00"
            hex"0000000000000000000000000000000000000000000000000000000000000000"
            hex"0000000000000000000000000000000000000000000000000000000000000000"
            hex"0000000000000000000000000000000000000000000000000000000000000000"
            hex"000000000000000000000000f482890d6a27da5e6a38e2ae4d6f4b7a0dda7347"
            hex"000000000000000000000000000000000000000000000000000000006a51b0a7"
            hex"000000000000000000000000d774557b647330c91bf44cfeab205095f7e6c367"
            hex"0000000000000000000000004bc5fa56f2931e7a37417fa55dda71e4b7c2f2a3"
            hex"000000000000000000000000223ee0c3dc4be9fadb623c12e8be9443130e8377"
            hex"0000000000000000000000002ae3e46290ade43593eabd15642ebd67157f5351"
            hex"0000000000000000000000000000000000000000000000000000000000000000";
    }

    /// LoanRepaid, transaction 0x34632ee55588a9968385a0c8646700ed31cfc6d7e40430752db29b77e0ab4960
    function _loanRepaid() internal pure returns (Vm.Log memory entry) {
        bytes32[] memory topics = new bytes32[](4);
        topics[0] = 0x6ee3573bd905753c83bc1aaca3c15bfa36391db95b778bd825eb010645a7ee45;
        topics[1] = 0x0000000000000000000000000000000000000000000000000000000000004220;
        topics[2] = 0x0000000000000000000000006f457744d4a69c99824175fbf68eff853c6f28e7;
        topics[3] = 0x000000000000000000000000223ee0c3dc4be9fadb623c12e8be9443130e8377;

        entry.emitter = NFTFI;
        entry.topics = topics;
        entry.data = hex"00000000000000000000000000000000000000000000000000f8b0a10e470000"
            hex"0000000000000000000000000000000000000000000000000000000000001e8b"
            hex"0000000000000000000000000000000000000000000000000100a962bf212862"
            hex"0000000000000000000000000000000000000000000000000000000000000000"
            hex"000000000000000000000000d774557b647330c91bf44cfeab205095f7e6c367"
            hex"000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
    }

    // --------------------------------------------------------------- tests

    function test_aRealMainnetLoanIsReadIntoTheRegistry() public {
        bytes32 key = registry.registerPledge(_relayFrom(ETHEREUM, STARTED_AT, _loanStarted()));
        assertEq(key, assetKey, "the collateral resolves to its own asset key");

        SingletonRegistry.Record memory r = registry.getStatus(key);
        assertEq(uint8(r.state), uint8(SingletonRegistry.AssetState.PLEDGED));
        assertEq(r.emitter, NFTFI, "recorded against NFTfi, which never asked for this");
        assertEq(r.borrower, BORROWER_ONCHAIN, "borrower read out of the loan terms");
        assertEq(r.amount, PRINCIPAL, "0.07 WETH principal");
        assertEq(r.instanceId, LOAN_ID, "loan id becomes the instance id");
        assertEq(r.chainKey, ETHEREUM);
        assertEq(r.sourceHeight, STARTED_AT);
        assertEq(registry.certificateOf(key), NFTFI);
    }

    /// The repayment closes the same lien, two hundred thousand blocks later.
    function test_theRealRepaymentReleasesTheSameLien() public {
        registry.registerPledge(_relayFrom(ETHEREUM, STARTED_AT, _loanStarted()));
        registry.registerRelease(_relayFrom(ETHEREUM, REPAID_AT, _loanRepaid()));

        assertEq(
            uint8(registry.getStatus(assetKey).state), uint8(SingletonRegistry.AssetState.FREE)
        );
        assertEq(registry.certificateOf(assetKey), address(0), "certificate burned with the lien");
    }

    /// NFTfi has no settlement step, and the adapter says so rather than
    /// pretending one of its other events means that.
    function test_settlementIsUnsupportedForThisProtocol() public {
        registry.registerPledge(_relayFrom(ETHEREUM, STARTED_AT, _loanStarted()));

        SingletonRegistry.Proof memory repaid = _relayFrom(ETHEREUM, REPAID_AT, _loanRepaid());

        vm.expectRevert(
            abi.encodeWithSelector(
                SingletonRegistry.TransitionUnsupported.selector, NFTFI, uint8(1)
            )
        );
        registry.registerSettlement(repaid);
    }

    /// The obligation changed hands during this loan: the address in the
    /// repayment is not the borrower who took it. A release binds to the
    /// emitter and the loan id, so it closes anyway.
    function test_aTransferredObligationStillClosesItsLien() public {
        registry.registerPledge(_relayFrom(ETHEREUM, STARTED_AT, _loanStarted()));

        assertTrue(
            OBLIGATION_HOLDER_AT_REPAYMENT != BORROWER_ONCHAIN, "the fixture really does differ"
        );
        registry.registerRelease(_relayFrom(ETHEREUM, REPAID_AT, _loanRepaid()));
        assertEq(
            uint8(registry.getStatus(assetKey).state), uint8(SingletonRegistry.AssetState.FREE)
        );
    }

    /// Reading NFTfi never touches Sepolia's key space, so a mainnet lien
    /// cannot freeze the same collection and id on a testnet, or the reverse.
    function test_theMainnetLienIsSeparateFromTheSepoliaOne() public {
        registry.registerPledge(_relayFrom(ETHEREUM, STARTED_AT, _loanStarted()));

        bytes32 sepoliaKey = registry.assetKeyOf(SEPOLIA, COLLECTION, NFT_ID);
        assertTrue(sepoliaKey != assetKey);
        assertEq(
            uint8(registry.getStatus(sepoliaKey).state), uint8(SingletonRegistry.AssetState.FREE)
        );
    }
}
