// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IPledgeAdapter} from "../interfaces/IPledgeAdapter.sol";
import {EvmV1Decoder} from "../vendor/EvmV1Decoder.sol";

/**
 * Reads ConsentedCredit, and does not take its word for the pledge.
 *
 * Every other adapter in this project translates a log: it trusts that the
 * emitter's own logic already checked what needed checking, because the
 * source chain proved the log was written and the registry proves nothing
 * more than that. This one is different on purpose, because caveat 5's global
 * freeze griefing needs a different answer: a pledge against an asset the
 * emitter never held is possible precisely because nothing downstream
 * re-checks that the owner agreed.
 *
 * ConsentedCredit signs that agreement into the log, as an EIP-712 signature
 * over the exact asset. This adapter recomputes the same digest, independent
 * of anything the emitter's own `openLien` decided, using only what is in the
 * log itself and the emitter's own address, which the receipt already proves.
 * A signature that does not recover to the owner the log claims is refused
 * here, on Creditcoin, before the registry ever sees a token or a borrower.
 *
 * What this does and does not fix. It closes the fabrication caveat 5 names
 * for any emitter that ships this exact log shape, because a forged consent
 * cannot be produced without the owner's key, cryptography rather than trust
 * in a third party's code. It does not retrofit Harbor, Meridian, NFTfi or
 * Blend, none of which carry a signature in their logs, and it does not
 * change custodial protocols at all, which caveat 6 already closes a
 * different way. Opt-in, named as exactly that.
 */
contract ConsentedAdapter is IPledgeAdapter {
    /// The chain this desk lives on. Pinned rather than read from block.chainid,
    /// because this code runs on Creditcoin, reading a log made on Sepolia: the
    /// two chain ids are never the same value at the same call.
    uint256 internal constant SOURCE_CHAIN_ID = 11155111;

    bytes32 private constant DOMAIN_TYPE_HASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 private constant CONSENT_TYPE_HASH = keccak256(
        "PledgeConsent(address token,uint256 tokenId,address owner,uint256 principal,uint256 nonce)"
    );

    uint8 internal constant KIND_PLEDGE = 0;
    uint8 internal constant KIND_SETTLE = 1;
    uint8 internal constant KIND_RELEASE = 2;

    bytes32 public constant PLEDGED_SIG =
        keccak256("Pledged(address,uint256,address,uint256,bytes32,uint256,uint8,bytes32,bytes32)");

    bytes32 public constant SETTLED_SIG =
        keccak256("Settled(address,uint256,address,uint256,bytes32)");

    bytes32 public constant RELEASED_SIG =
        keccak256("Released(address,uint256,address,uint256,bytes32)");

    error UnsupportedKind(uint8 kind);
    error ForgedConsent(address recovered, address claimedOwner);

    function signaturesFor(uint8 kind) external pure returns (bytes32[] memory signatures) {
        signatures = new bytes32[](1);
        if (kind == KIND_PLEDGE) signatures[0] = PLEDGED_SIG;
        else if (kind == KIND_SETTLE) signatures[0] = SETTLED_SIG;
        else if (kind == KIND_RELEASE) signatures[0] = RELEASED_SIG;
        else revert UnsupportedKind(kind);
    }

    function translate(uint8 kind, EvmV1Decoder.LogEntry calldata log)
        external
        pure
        returns (
            address collateralToken,
            uint256 tokenId,
            address borrower,
            uint256 amount,
            bytes32 instanceId
        )
    {
        collateralToken = address(uint160(uint256(log.topics[1])));
        tokenId = uint256(log.topics[2]);
        borrower = address(uint160(uint256(log.topics[3])));

        if (kind == KIND_SETTLE || kind == KIND_RELEASE) {
            (amount, instanceId) = abi.decode(log.data, (uint256, bytes32));
            return (collateralToken, tokenId, borrower, amount, instanceId);
        }
        if (kind != KIND_PLEDGE) revert UnsupportedKind(kind);

        uint256 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
        (amount, instanceId, nonce, v, r, s) =
            abi.decode(log.data, (uint256, bytes32, uint256, uint8, bytes32, bytes32));

        /*
          The domain names the emitter that wrote this log, `log.address_`, not
          this adapter and not the registry. A signature is a promise made to
          one specific contract; recomputing it against any other address would
          accept a consent the owner gave to something else entirely.
        */
        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPE_HASH,
                keccak256(bytes("ConsentedCredit")),
                keccak256(bytes("1")),
                SOURCE_CHAIN_ID, // must equal ConsentedCredit.SEPOLIA_CHAIN_ID
                log.address_
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(CONSENT_TYPE_HASH, collateralToken, tokenId, borrower, amount, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        address recovered = ecrecover(digest, v, r, s);
        if (recovered != borrower) revert ForgedConsent(recovered, borrower);
    }
}
