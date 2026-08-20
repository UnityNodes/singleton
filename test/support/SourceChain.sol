// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, Vm} from "forge-std/Test.sol";
import {SingletonRegistry} from "../../src/SingletonRegistry.sol";
import {IBlockProver} from "../../src/interfaces/IBlockProver.sol";
import {EvmV1Decoder} from "../../src/vendor/EvmV1Decoder.sol";
import {AttestorStashModel, ProverModel, ChainInfoModel} from "../mocks/Precompiles.sol";

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
    address internal constant STASH_ADDR = 0x0000000000000000000000000000000000000fd4;

    uint64 internal constant SEPOLIA = 1;
    uint64 internal constant ETHEREUM = 3;
    uint64 internal constant MIN_CONF = 64;
    uint64 internal constant MIN_ATTESTORS = 3;
    uint64 internal constant TIP = 11_509_380;

    address internal constant BORROWER = address(0xB0110);
    uint256 internal constant TOKEN_ID = 42;

    ProverModel internal prover;
    AttestorStashModel internal stash;

    uint64 private _nextHeight = TIP - MIN_CONF - 500;
    uint256 private _nextRoot = 0xA0;

    function _installPrecompiles() internal {
        vm.etch(PROVER_ADDR, address(new ProverModel()).code);
        vm.etch(CHAININFO_ADDR, address(new ChainInfoModel()).code);
        vm.etch(STASH_ADDR, address(new AttestorStashModel()).code);
        prover = ProverModel(PROVER_ADDR);
        stash = AttestorStashModel(STASH_ADDR);
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

    /**
     * The same encoding for a receipt carrying several logs.
     *
     * A real transaction rarely holds exactly one, and the interesting cases
     * are the ones where it does not: a lender's own log beside a log some
     * other contract in the same call chose to emit.
     */
    function _encodeMany(Vm.Log[] memory entries, uint8 receiptStatus)
        internal
        pure
        returns (bytes memory)
    {
        bytes memory common = abi.encode(
            uint64(1), uint64(200000), BORROWER, false, entries[0].emitter, uint256(0), bytes("")
        );

        EvmV1Decoder.AccessListEntryBytes32[] memory accessList =
            new EvmV1Decoder.AccessListEntryBytes32[](0);
        bytes memory typeSpecific = abi.encode(
            uint64(1), uint128(1e9), uint128(3e10), accessList, uint8(0), bytes32(0), bytes32(0)
        );

        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](entries.length);
        for (uint256 i; i < entries.length; i++) {
            logs[i] = EvmV1Decoder.LogEntryTuple({
                address_: entries[i].emitter, topics: entries[i].topics, data: entries[i].data
            });
        }

        bytes memory receipt = abi.encode(receiptStatus, uint64(90000), logs, new bytes(256));

        bytes[] memory chunks = new bytes[](3);
        chunks[0] = common;
        chunks[1] = typeSpecific;
        chunks[2] = receipt;
        return abi.encode(uint8(2), chunks);
    }

    /// The caller names the log it is filing, because the registry no longer
    /// searches for one and a receipt may carry several.
    function _relayMany(Vm.Log[] memory entries, uint32 logIndex)
        internal
        returns (SingletonRegistry.Proof memory p)
    {
        bytes memory encoded = _encodeMany(entries, 1);
        bytes32 root = bytes32(_nextRoot++);
        uint64 height = _nextHeight++;

        prover.attest(SEPOLIA, height, encoded);

        IBlockProver.MerkleProofEntry[] memory siblings = new IBlockProver.MerkleProofEntry[](1);
        siblings[0] = IBlockProver.MerkleProofEntry({hash: root, isLeft: true});

        p = SingletonRegistry.Proof({
            chainKey: SEPOLIA,
            height: height,
            emitter: entries[logIndex].emitter,
            logIndex: logIndex,
            encodedTransaction: encoded,
            merkleProof: IBlockProver.MerkleProof({root: root, siblings: siblings}),
            continuityProof: IBlockProver.ContinuityProof({
                lowerEndpointDigest: bytes32(0), roots: new bytes32[](0)
            })
        });
    }

    /**
     * Several captured logs as one batch proof.
     *
     * Each entry becomes its own single log transaction at its own height, which
     * is what a relayer catching up on a range actually holds: many separate
     * source transactions, one continuity proof covering the span.
     */
    function _relayBatch(Vm.Log[] memory entries)
        internal
        returns (SingletonRegistry.BatchProof memory b)
    {
        uint256 count = entries.length;
        b.chainKey = SEPOLIA;
        b.heights = new uint64[](count);
        b.emitters = new address[](count);
        b.logIndexes = new uint32[](count);
        b.encodedTransactions = new bytes[](count);
        b.merkleProofs = new IBlockProver.MerkleProof[](count);
        b.sharedContinuityProof = IBlockProver.ContinuityProof({
            lowerEndpointDigest: bytes32(0), roots: new bytes32[](0)
        });

        for (uint256 i; i < count; i++) {
            bytes memory encoded = _encode(entries[i], 1);
            uint64 height = _nextHeight++;
            prover.attest(SEPOLIA, height, encoded);

            IBlockProver.MerkleProofEntry[] memory siblings = new IBlockProver.MerkleProofEntry[](1);
            siblings[0] = IBlockProver.MerkleProofEntry({hash: bytes32(_nextRoot++), isLeft: true});

            b.heights[i] = height;
            b.emitters[i] = entries[i].emitter;
            b.logIndexes[i] = 0;
            b.encodedTransactions[i] = encoded;
            b.merkleProofs[i] =
                IBlockProver.MerkleProof({root: siblings[0].hash, siblings: siblings});
        }
    }

    /// Packages a captured log as a proof the model prover will accept.
    function _relay(Vm.Log memory entry) internal returns (SingletonRegistry.Proof memory) {
        return _relay(entry, 1);
    }

    function _relay(Vm.Log memory entry, uint8 receiptStatus)
        internal
        returns (SingletonRegistry.Proof memory)
    {
        return _relayFrom(SEPOLIA, _nextHeight++, entry, receiptStatus);
    }

    /// The same, for a proof taken from a named chain at a named height, which
    /// is what a fixture captured from a live chain needs.
    function _relayFrom(uint64 chainKey, uint64 height, Vm.Log memory entry)
        internal
        returns (SingletonRegistry.Proof memory)
    {
        return _relayFrom(chainKey, height, entry, 1);
    }

    function _relayFrom(uint64 chainKey, uint64 height, Vm.Log memory entry, uint8 receiptStatus)
        internal
        returns (SingletonRegistry.Proof memory p)
    {
        bytes memory encoded = _encode(entry, receiptStatus);
        bytes32 root = bytes32(_nextRoot++);

        prover.attest(chainKey, height, encoded);

        IBlockProver.MerkleProofEntry[] memory siblings = new IBlockProver.MerkleProofEntry[](1);
        siblings[0] = IBlockProver.MerkleProofEntry({hash: root, isLeft: true});

        p = SingletonRegistry.Proof({
            chainKey: chainKey,
            height: height,
            emitter: entry.emitter,
            logIndex: 0,
            encodedTransaction: encoded,
            merkleProof: IBlockProver.MerkleProof({root: root, siblings: siblings}),
            continuityProof: IBlockProver.ContinuityProof({
                lowerEndpointDigest: bytes32(0), roots: new bytes32[](0)
            })
        });
    }
}
