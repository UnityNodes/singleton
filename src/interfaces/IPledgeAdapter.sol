// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {EvmV1Decoder} from "../vendor/EvmV1Decoder.sol";

/**
 * Maps a protocol's own event onto the tuple the registry keys on.
 *
 * Most protocols will not emit Singleton's `Pledged` shape, and asking them to
 * change is the integration this product exists to avoid. An adapter is a thin,
 * pure contract that reads their native log instead.
 *
 * This is the weakest link in the trust chain and is named as one in caveat 9.
 * The allowlist only decides which logs are read; an adapter decides what they
 * mean, which is derived truth. Adapters stay minimal, pure, and readable in one
 * sitting for exactly that reason.
 */
interface IPledgeAdapter {
    /// Topic zero of the protocol's own pledge, settlement and release events.
    /// A zero signature means the protocol has no such event and the
    /// corresponding transition cannot be proven for it.
    function eventSignatures()
        external
        view
        returns (bytes32 pledgeSig, bytes32 settleSig, bytes32 releaseSig);

    /// Reads one native log into the registry's tuple. Must not depend on state.
    function translate(uint8 kind, EvmV1Decoder.LogEntry calldata log)
        external
        view
        returns (
            address collateralToken,
            uint256 tokenId,
            address borrower,
            uint256 amount,
            bytes32 instanceId
        );
}
