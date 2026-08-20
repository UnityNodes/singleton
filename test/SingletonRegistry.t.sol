// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {SingletonRegistry} from "../src/SingletonRegistry.sol";
import {IBlockProver} from "../src/interfaces/IBlockProver.sol";
import {IChainInfo} from "../src/interfaces/IChainInfo.sol";
import {EvmV1Decoder} from "../src/vendor/EvmV1Decoder.sol";
import {AttestorStashModel, ProverModel, ChainInfoModel} from "./mocks/Precompiles.sol";

contract SingletonRegistryTest is Test {
    address constant PROVER_ADDR = 0x0000000000000000000000000000000000000FD2;
    address constant CHAININFO_ADDR = 0x0000000000000000000000000000000000000fD3;
    address constant STASH_ADDR = 0x0000000000000000000000000000000000000fd4;

    uint64 constant ETH = 3;
    uint64 constant SEPOLIA = 1;
    uint64 constant MIN_CONF = 64;
    uint64 constant MIN_ATTESTORS = 3;
    uint64 constant TIP = 25_776_130;

    /// Two genuinely different lenders. Different code, different addresses,
    /// no integration between them and no shared storage.
    address constant LENDER_A = address(0xA1);
    address constant LENDER_B = address(0xB2);
    address constant OUTSIDER = address(0xC3);

    address constant COLLATERAL = address(0x1155);
    uint256 constant TOKEN_ID = 42;
    address constant BORROWER = address(0xB0110);

    SingletonRegistry registry;
    ProverModel prover;
    ChainInfoModel info;
    AttestorStashModel stash;

    function setUp() public {
        vm.etch(PROVER_ADDR, address(new ProverModel()).code);
        vm.etch(CHAININFO_ADDR, address(new ChainInfoModel()).code);
        vm.etch(STASH_ADDR, address(new AttestorStashModel()).code);
        prover = ProverModel(PROVER_ADDR);
        info = ChainInfoModel(CHAININFO_ADDR);
        stash = AttestorStashModel(STASH_ADDR);

        registry = new SingletonRegistry();
        registry.setMinConfirmations(ETH, MIN_CONF);
        registry.setMinAttestors(ETH, MIN_ATTESTORS);
        registry.setMinConfirmations(SEPOLIA, MIN_CONF);
        registry.setMinAttestors(SEPOLIA, MIN_ATTESTORS);
        registry.setEmitter(ETH, LENDER_A, true);
        registry.setEmitter(ETH, LENDER_B, true);
    }

    // ------------------------------------------------------------- helpers

    function _encodePledgeTx(
        address emitter,
        address token,
        uint256 tokenId,
        address borrower,
        uint256 amount,
        bytes32 instanceId,
        uint8 receiptStatus
    ) internal pure returns (bytes memory) {
        bytes memory common = abi.encode(
            uint64(1), uint64(200000), borrower, false, emitter, uint256(0), bytes("")
        );

        EvmV1Decoder.AccessListEntryBytes32[] memory accessList =
            new EvmV1Decoder.AccessListEntryBytes32[](0);
        bytes memory typeSpecific = abi.encode(
            uint64(1), uint128(1e9), uint128(3e10), accessList, uint8(0), bytes32(0), bytes32(0)
        );

        bytes32[] memory topics = new bytes32[](4);
        topics[0] = registrySig();
        topics[1] = bytes32(uint256(uint160(token)));
        topics[2] = bytes32(tokenId);
        topics[3] = bytes32(uint256(uint160(borrower)));

        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = EvmV1Decoder.LogEntryTuple({
            address_: emitter, topics: topics, data: abi.encode(amount, instanceId)
        });

        bytes memory receipt = abi.encode(receiptStatus, uint64(90000), logs, new bytes(256));

        bytes[] memory chunks = new bytes[](3);
        chunks[0] = common;
        chunks[1] = typeSpecific;
        chunks[2] = receipt;
        return abi.encode(uint8(2), chunks);
    }

    function registrySig() internal pure returns (bytes32) {
        return keccak256("Pledged(address,uint256,address,uint256,bytes32)");
    }

    function _proof(uint64 chainKey, uint64 height, bytes memory encodedTx, bytes32 root)
        internal
        view
        returns (SingletonRegistry.Proof memory)
    {
        return _proof(chainKey, height, encodedTx, root, LENDER_A, 0);
    }

    function _proof(
        uint64 chainKey,
        uint64 height,
        bytes memory encodedTx,
        bytes32 root,
        address emitter,
        uint32 logIndex
    ) internal pure returns (SingletonRegistry.Proof memory) {
        IBlockProver.MerkleProofEntry[] memory siblings = new IBlockProver.MerkleProofEntry[](1);
        siblings[0] = IBlockProver.MerkleProofEntry({hash: root, isLeft: true});

        return SingletonRegistry.Proof({
            chainKey: chainKey,
            height: height,
            emitter: emitter,
            logIndex: logIndex,
            encodedTransaction: encodedTx,
            merkleProof: IBlockProver.MerkleProof({root: root, siblings: siblings}),
            continuityProof: IBlockProver.ContinuityProof({
                lowerEndpointDigest: bytes32(0), roots: new bytes32[](0)
            })
        });
    }

    function _final() internal pure returns (uint64) {
        return TIP - MIN_CONF - 100;
    }

    // ------------------------------------------------- control on the model

    /// Break the model on purpose. If a proof verifies under any chain key, every
    /// other test in this file proves nothing.
    function test_model_bindsChainKey() public {
        bytes memory t = _encodePledgeTx(LENDER_A, COLLATERAL, TOKEN_ID, BORROWER, 1e18, "i1", 1);
        prover.attest(ETH, _final(), t);

        SingletonRegistry.Proof memory p = _proof(ETH, _final(), t, bytes32(uint256(1)));
        assertTrue(
            prover.verify(ETH, _final(), t, p.merkleProof, p.continuityProof),
            "model must verify the chain it attested"
        );
        assertFalse(
            prover.verify(SEPOLIA, _final(), t, p.merkleProof, p.continuityProof),
            "model must not verify a different chain"
        );
    }

    // ------------------------------------------------------------ the core

    function test_firstPledgeIsRecorded() public {
        bytes memory t = _encodePledgeTx(LENDER_A, COLLATERAL, TOKEN_ID, BORROWER, 5e18, "i1", 1);
        prover.attest(ETH, _final(), t);

        bytes32 key = registry.registerPledge(_proof(ETH, _final(), t, bytes32(uint256(0xA))));

        SingletonRegistry.Record memory r = registry.getStatus(key);
        assertEq(uint8(r.state), uint8(SingletonRegistry.AssetState.PLEDGED));
        assertEq(r.emitter, LENDER_A);
        assertEq(r.borrower, BORROWER);
        assertEq(r.amount, 5e18);
        assertEq(key, registry.assetKeyOf(ETH, COLLATERAL, TOKEN_ID));
    }

    /**
     * The whole product, in one test.
     *
     * Lender A and lender B share no code, no storage and no integration. The
     * same asset pledged to both produces one key, and the second registration
     * is refused.
     */
    function test_secondPledgeFromAnUnrelatedLenderIsRefused() public {
        bytes memory first =
            _encodePledgeTx(LENDER_A, COLLATERAL, TOKEN_ID, BORROWER, 5e18, "i1", 1);
        prover.attest(ETH, _final(), first);
        bytes32 key = registry.registerPledge(_proof(ETH, _final(), first, bytes32(uint256(0xA))));

        bytes memory second =
            _encodePledgeTx(LENDER_B, COLLATERAL, TOKEN_ID, BORROWER, 9e18, "i2", 1);
        prover.attest(ETH, _final() + 1, second);

        vm.expectRevert(
            abi.encodeWithSelector(SingletonRegistry.AssetNotFree.selector, key, LENDER_A)
        );
        registry.registerPledge(
            _proof(ETH, _final() + 1, second, bytes32(uint256(0xB)), LENDER_B, 0)
        );

        SingletonRegistry.Record memory r = registry.getStatus(key);
        assertEq(r.emitter, LENDER_A, "incumbent keeps priority");
        assertEq(r.amount, 5e18, "record untouched by the rejected pledge");
    }

    /// A different token id is a different asset and must not collide.
    function test_differentAssetDoesNotCollide() public {
        bytes memory a = _encodePledgeTx(LENDER_A, COLLATERAL, 42, BORROWER, 5e18, "i1", 1);
        prover.attest(ETH, _final(), a);
        registry.registerPledge(_proof(ETH, _final(), a, bytes32(uint256(0xA))));

        bytes memory b = _encodePledgeTx(LENDER_B, COLLATERAL, 43, BORROWER, 5e18, "i2", 1);
        prover.attest(ETH, _final() + 1, b);
        bytes32 key = registry.registerPledge(
            _proof(ETH, _final() + 1, b, bytes32(uint256(0xB)), LENDER_B, 0)
        );

        assertEq(uint8(registry.getStatus(key).state), uint8(SingletonRegistry.AssetState.PLEDGED));
    }

    // --------------------------------------------------------- the guards

    function test_freshBlockIsRejectedByTheFinalityWindow() public {
        uint64 tooFresh = TIP - 10;
        bytes memory t = _encodePledgeTx(LENDER_A, COLLATERAL, TOKEN_ID, BORROWER, 1e18, "i1", 1);
        prover.attest(ETH, tooFresh, t);

        vm.expectRevert(
            abi.encodeWithSelector(SingletonRegistry.NotFinal.selector, tooFresh, TIP, MIN_CONF)
        );
        registry.registerPledge(_proof(ETH, tooFresh, t, bytes32(uint256(0xA))));
    }

    function test_unattestedProofIsRejected() public {
        bytes memory t = _encodePledgeTx(LENDER_A, COLLATERAL, TOKEN_ID, BORROWER, 1e18, "i1", 1);

        vm.expectRevert(SingletonRegistry.ProofRejected.selector);
        registry.registerPledge(_proof(ETH, _final(), t, bytes32(uint256(0xA))));
    }

    function test_emitterOutsideTheAllowlistIsRejected() public {
        bytes memory t = _encodePledgeTx(OUTSIDER, COLLATERAL, TOKEN_ID, BORROWER, 1e18, "i1", 1);
        prover.attest(ETH, _final(), t);

        vm.expectRevert(
            abi.encodeWithSelector(SingletonRegistry.EmitterNotAllowed.selector, ETH, OUTSIDER)
        );
        registry.registerPledge(_proof(ETH, _final(), t, bytes32(uint256(0xA)), OUTSIDER, 0));
    }

    /// Inclusion is not success. A reverted source transaction is in a block too.
    function test_revertedSourceTransactionIsRejected() public {
        bytes memory t = _encodePledgeTx(LENDER_A, COLLATERAL, TOKEN_ID, BORROWER, 1e18, "i1", 0);
        prover.attest(ETH, _final(), t);

        vm.expectRevert(SingletonRegistry.SourceTransactionReverted.selector);
        registry.registerPledge(_proof(ETH, _final(), t, bytes32(uint256(0xA))));
    }

    function test_theSameProofCannotBeReplayed() public {
        bytes memory t = _encodePledgeTx(LENDER_A, COLLATERAL, TOKEN_ID, BORROWER, 1e18, "i1", 1);
        prover.attest(ETH, _final(), t);

        registry.registerPledge(_proof(ETH, _final(), t, bytes32(uint256(0xA))));

        /*
          The nullifier is derived from the transaction's position and the log
          within it, not from the proof bytes, so naming the same log of the
          same transaction is refused however the proof was assembled. Asserting
          the specific error matters: a bare expectRevert here passed even while
          the guard was reachable for the wrong reason.

          What this cannot check is whether the live BlockProver admits two
          distinct valid proofs for one transaction. The model prover derives
          the index from the merkle root, so the question is not answerable in
          this suite and is not pretended to be.
        */
        bytes32 nullifier = keccak256(
            abi.encode(
                uint8(0), ETH, _final(), uint64(uint256(bytes32(uint256(0xA))) & 0xffff), uint32(0)
            )
        );
        vm.expectRevert(
            abi.encodeWithSelector(SingletonRegistry.ProofAlreadyConsumed.selector, nullifier)
        );
        registry.registerPledge(_proof(ETH, _final(), t, bytes32(uint256(0xA))));
    }

    /**
     * A pledge proven on Sepolia must never claim an asset on Ethereum. The chain
     * key is part of the asset key, so the two are different assets by
     * construction rather than by a check somebody has to remember.
     */
    function test_sepoliaPledgeDoesNotFreezeTheMainnetAsset() public {
        registry.setEmitter(SEPOLIA, LENDER_A, true);

        bytes memory onSepolia =
            _encodePledgeTx(LENDER_A, COLLATERAL, TOKEN_ID, BORROWER, 1e18, "i1", 1);
        uint64 sepoliaHeight = 11_509_380 - MIN_CONF - 100;
        prover.attest(SEPOLIA, sepoliaHeight, onSepolia);
        registry.registerPledge(_proof(SEPOLIA, sepoliaHeight, onSepolia, bytes32(uint256(0xA))));

        bytes memory onEthereum =
            _encodePledgeTx(LENDER_B, COLLATERAL, TOKEN_ID, BORROWER, 1e18, "i2", 1);
        prover.attest(ETH, _final(), onEthereum);
        bytes32 ethKey = registry.registerPledge(
            _proof(ETH, _final(), onEthereum, bytes32(uint256(0xB)), LENDER_B, 0)
        );

        assertTrue(
            ethKey != registry.assetKeyOf(SEPOLIA, COLLATERAL, TOKEN_ID),
            "the two chains must not share an asset key"
        );
        assertEq(registry.getStatus(ethKey).emitter, LENDER_B);
    }
}
