// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Vm} from "forge-std/Test.sol";
import {SourceChain} from "./support/SourceChain.sol";
import {SingletonRegistry} from "../src/SingletonRegistry.sol";
import {RwaDeed} from "../src/emitters/RwaDeed.sol";
import {ConsentedCredit} from "../src/emitters/ConsentedCredit.sol";
import {ConsentedAdapter} from "../src/adapters/ConsentedAdapter.sol";
import {EvmV1Decoder} from "../src/vendor/EvmV1Decoder.sol";

/**
 * caveat 5's global freeze griefing, closed rather than merely bounded.
 *
 * Every other lender in this project keeps its own promise: Harbor and
 * Meridian check `ownerOf(tokenId) == msg.sender` before emitting a pledge,
 * and the registry trusts that check happened because it has no way to ask
 * otherwise. ConsentedCredit answers a harder question: what does Singleton
 * do when the emitter's own promise cannot be trusted at all. The owner signs
 * the exact asset, the signature travels in the log, and the adapter
 * recomputes the digest itself, on Creditcoin, from nothing but the log and
 * the emitter's own address. It never asks ConsentedCredit whether the
 * signature was valid, which is the whole point: it is independently true or
 * independently false.
 */
contract ConsentedCreditTest is SourceChain {
    SingletonRegistry registry;
    RwaDeed deed;
    ConsentedCredit credit;
    ConsentedAdapter adapter;

    uint256 constant OWNER_KEY = 0xA11CE;
    uint256 constant ATTACKER_KEY = 0xBAD;
    address owner;
    address attacker;

    uint256 constant DEED_ID = 900;

    function setUp() public {
        _installPrecompiles();

        owner = vm.addr(OWNER_KEY);
        attacker = vm.addr(ATTACKER_KEY);

        deed = new RwaDeed();
        deed.mint(owner, DEED_ID);

        credit = new ConsentedCredit();
        adapter = new ConsentedAdapter();

        registry = new SingletonRegistry();
        registry.setMinConfirmations(SEPOLIA, MIN_CONF);
        registry.setMinAttestors(SEPOLIA, MIN_ATTESTORS);
        registry.setEmitter(SEPOLIA, address(credit), true);
        registry.setAdapter(SEPOLIA, address(credit), address(adapter));
    }

    function _sign(uint256 key, address token, uint256 tokenId, address asOwner, uint256 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 digest = credit.consentDigest(token, tokenId, asOwner, nonce);
        (v, r, s) = vm.sign(key, digest);
    }

    /**
     * The transaction is sent by a stranger to both the owner and the desk, on
     * purpose: what makes this a pledge is the signature, not who paid the gas
     * to submit it.
     */
    function test_aSignedConsentRegistersThroughAnUninvolvedRelayer() public {
        (uint8 v, bytes32 r, bytes32 s) = _sign(OWNER_KEY, address(deed), DEED_ID, owner, 1);

        vm.recordLogs();
        address relayer = address(0xC0FFEE);
        vm.prank(relayer);
        credit.openLien(address(deed), DEED_ID, 500 ether, 1, v, r, s);
        Vm.Log memory entry = _log(adapter.PLEDGED_SIG());

        bytes32 assetKey = registry.registerPledge(_relay(entry));

        SingletonRegistry.Record memory rec = registry.getStatus(assetKey);
        assertEq(uint8(rec.state), uint8(SingletonRegistry.AssetState.PLEDGED));
        assertEq(rec.borrower, owner, "the signer, not the relayer, is the borrower on record");
        assertEq(rec.amount, 500 ether);
    }

    /// The desk itself refuses a consent from anybody but the token's real
    /// owner, which is the first of two independent checks, not the only one.
    function test_theEmitterRefusesAConsentSignedByAnybodyButTheOwner() public {
        (uint8 v, bytes32 r, bytes32 s) = _sign(ATTACKER_KEY, address(deed), DEED_ID, owner, 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                ConsentedCredit.ConsentDidNotMatchTheOwner.selector, attacker, owner
            )
        );
        credit.openLien(address(deed), DEED_ID, 500 ether, 1, v, r, s);
    }

    /// The same nonce cannot open a second lien once spent, so a signature
    /// captured once cannot be replayed against a later loan.
    function test_theEmitterRefusesAReusedNonce() public {
        (uint8 v, bytes32 r, bytes32 s) = _sign(OWNER_KEY, address(deed), DEED_ID, owner, 7);
        credit.openLien(address(deed), DEED_ID, 500 ether, 7, v, r, s);

        deed.mint(owner, DEED_ID + 1);
        vm.expectRevert(
            abi.encodeWithSelector(ConsentedCredit.NonceAlreadyUsed.selector, owner, 7)
        );
        credit.openLien(address(deed), DEED_ID + 1, 100 ether, 7, v, r, s);
    }

    /**
     * The adapter's check is independent, not decorative: it is exercised here
     * directly, against a log the emitter never actually wrote, because that
     * is the only way to prove it does not simply trust ConsentedCredit's own
     * front door. If this adapter were paired with a different, dishonest
     * emitter that skipped the check in `test_theEmitterRefusesAConsentSignedByAnybodyButTheOwner`
     * entirely, this is what would still stop it.
     */
    function test_theAdapterIndependentlyRefusesAForgedConsent() public {
        (uint8 v, bytes32 r, bytes32 s) = _sign(ATTACKER_KEY, address(deed), DEED_ID, owner, 1);

        bytes32[] memory topics = new bytes32[](4);
        topics[0] = adapter.PLEDGED_SIG();
        topics[1] = bytes32(uint256(uint160(address(deed))));
        topics[2] = bytes32(DEED_ID);
        topics[3] = bytes32(uint256(uint160(owner)));

        EvmV1Decoder.LogEntry memory forged = EvmV1Decoder.LogEntry({
            address_: address(credit),
            topics: topics,
            data: abi.encode(uint256(500 ether), bytes32(uint256(1)), uint256(1), v, r, s)
        });

        vm.expectRevert(
            abi.encodeWithSelector(ConsentedAdapter.ForgedConsent.selector, attacker, owner)
        );
        this._translate(forged);
    }

    /// external wrapper: EvmV1Decoder.LogEntry as calldata needs an external call.
    function _translate(EvmV1Decoder.LogEntry calldata log) external {
        adapter.translate(0, log);
    }

    /// A genuine signature over one asset does not authorise a different one.
    function test_theAdapterRefusesAConsentReplayedAgainstADifferentAsset() public {
        (uint8 v, bytes32 r, bytes32 s) = _sign(OWNER_KEY, address(deed), DEED_ID, owner, 1);

        bytes32[] memory topics = new bytes32[](4);
        topics[0] = adapter.PLEDGED_SIG();
        topics[1] = bytes32(uint256(uint160(address(deed))));
        topics[2] = bytes32(DEED_ID + 1);
        topics[3] = bytes32(uint256(uint160(owner)));

        EvmV1Decoder.LogEntry memory replayed = EvmV1Decoder.LogEntry({
            address_: address(credit),
            topics: topics,
            data: abi.encode(uint256(500 ether), bytes32(uint256(1)), uint256(1), v, r, s)
        });

        // The recovered signer is neither address once the digest changes under
        // it, and is not itself the point: any revert here is the adapter
        // refusing a signature that does not match what it is attached to.
        vm.expectRevert();
        this._translate(replayed);
    }
}
