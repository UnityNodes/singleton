// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * The AttestorStash precompile at 0x0FD4.
 *
 * Reads the bonded attestor set that stands behind attestations for a source
 * chain. Every cross chain record inherits the security of the set that
 * attested it, and that number moves: a lien filed while seven attestors were
 * bonded and a lien filed while two were are worth different amounts, and on
 * every bridge and every oracle built so far they are written down identically.
 *
 * The selectors here are camelCase, unlike ChainInfo at 0x0fD3 whose selectors
 * are snake_case. That asymmetry is not a typo in this file, it is what the two
 * precompiles answer to. `get_attestors_count` returns "Unknown selector";
 * `getAttestorsCount` returns a number. Verified live on CC3 testnet.
 *
 * An unknown chain key answers zero rather than reverting, so a floor stated in
 * attestors doubles as a refusal to read a chain Creditcoin does not attest.
 */
interface IAttestorStash {
    /// How many attestors are bonded for this source chain right now.
    function getAttestorsCount(uint64 chainKey) external view returns (uint256 count);

    /// The bond each of them has to post, in wei of CTC.
    function getMinBondRequirement(uint64 chainKey) external view returns (uint256 bond);
}
