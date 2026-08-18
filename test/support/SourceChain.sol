// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, Vm} from "forge-std/Test.sol";
import {SingletonRegistry} from "../../src/SingletonRegistry.sol";
import {IBlockProver} from "../../src/interfaces/IBlockProver.sol";
import {EvmV1Decoder} from "../../src/vendor/EvmV1Decoder.sol";
import {ProverModel, ChainInfoModel} from "../mocks/Precompiles.sol";

/**
 * A source chain the tests can pledge on.
 *
 * Logs are never authored here. A lender contract is called, its real log is
 * captured with vm.recordLogs and repacked into the transaction encoding the
 * BlockProver attests to. So a lender whose event drifts from what the registry
 * decodes fails the suite, which is the one kind of drift a compiler cannot
 * catch across two chains.
 *
 * Each relayed proof takes the next height and a fresh merkle root, because the
 * replay nullifier is derived from both and reusing them would collide by
 * accident rather than by test.
 */
abstract contract SourceChain is Test {
    address internal constant PROVER_ADDR = 0x0000000000000000000000000000000000000FD2;
    address internal constant CHAININFO_ADDR = 0x0000000000000000000000000000000000000fD3;

    uint64 internal constant SEPOLIA = 1;
    uint64 internal constant MIN_CONF = 64;
    uint64 internal constant TIP = 11_509_380;

    address internal constant BORROWER = address(0xB0110);
    uint256 internal constant TOKEN_ID = 42;

    ProverModel internal prover;

    uint64 private _nextHeight = TIP - MIN_CONF - 500;
    uint256 private _nextRoot = 0xA0;

    function _installPrecompiles() internal {
        vm.etch(PROVER_ADDR, address(new ProverModel()).code);
        vm.etch(CHAININFO_ADDR, address(new ChainInfoModel()).code);
        prover = ProverModel(PROVER_ADDR);
    }

    function _log(bytes32 signature) internal view returns (Vm.Log memory) {
        Vm.Log[] memory entries = vm.getRecordedLogs();
        for (uint256 i; i < entries.length; i++) {
            if (entries[i].topics.length > 0 && entries[i].topics[0] == signature) {
                return entries[i];
            }
        }
        revert("no log with that signature was emitted");
    }

    function _encode(Vm.Log memory entry, uint8 receiptStatus)
        internal
        pure
        returns (bytes memory)
    {
        bytes memory common = abi.encode(
            uint64(1), uint64(200000), BORROWER, false, entry.emitter, uint256(0), bytes("")
        );

        EvmV1Decoder.AccessListEntryBytes32[] memory accessList =
            new EvmV1Decoder.AccessListEntryBytes32[](0);
        bytes memory typeSpecific = abi.encode(
            uint64(1), uint128(1e9), uint128(3e10), accessList, uint8(0), bytes32(0), bytes32(0)
        );

        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = EvmV1Decoder.LogEntryTuple({
            address_: entry.emitter, topics: entry.topics, data: entry.data
        });

        bytes memory receipt = abi.encode(receiptStatus, uint64(90000), logs, new bytes(256));

        bytes[] memory chunks = new bytes[](3);
        chunks[0] = common;
        chunks[1] = typeSpecific;
        chunks[2] = receipt;
        return abi.encode(uint8(2), chunks);
    }

    /// Packages a captured log as a proof the model prover will accept.
    function _relay(Vm.Log memory entry) internal returns (SingletonRegistry.Proof memory) {
        return _relay(entry, 1);
    }

    function _relay(Vm.Log memory entry, uint8 receiptStatus)
        internal
        returns (SingletonRegistry.Proof memory p)
    {
        bytes memory encoded = _encode(entry, receiptStatus);
        uint64 height = _nextHeight++;
        bytes32 root = bytes32(_nextRoot++);

        prover.attest(SEPOLIA, height, encoded);

        IBlockProver.MerkleProofEntry[] memory siblings = new IBlockProver.MerkleProofEntry[](1);
        siblings[0] = IBlockProver.MerkleProofEntry({hash: root, isLeft: true});

        p = SingletonRegistry.Proof({
            chainKey: SEPOLIA,
            height: height,
            encodedTransaction: encoded,
            merkleProof: IBlockProver.MerkleProof({root: root, siblings: siblings}),
            continuityProof: IBlockProver.ContinuityProof({
                lowerEndpointDigest: bytes32(0), roots: new bytes32[](0)
            })
        });
    }
}
