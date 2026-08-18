export const REGISTRY_ABI = [
  "function registerPledge((uint64 chainKey,uint64 height,bytes encodedTransaction,(bytes32 root,(bytes32 hash,bool isLeft)[] siblings) merkleProof,(bytes32 lowerEndpointDigest,bytes32[] roots) continuityProof) p) returns (bytes32 assetKey)",
  "function registerSettlement((uint64 chainKey,uint64 height,bytes encodedTransaction,(bytes32 root,(bytes32 hash,bool isLeft)[] siblings) merkleProof,(bytes32 lowerEndpointDigest,bytes32[] roots) continuityProof) p) returns (bytes32 assetKey)",
  "function registerRelease((uint64 chainKey,uint64 height,bytes encodedTransaction,(bytes32 root,(bytes32 hash,bool isLeft)[] siblings) merkleProof,(bytes32 lowerEndpointDigest,bytes32[] roots) continuityProof) p) returns (bytes32 assetKey)",
  "function reportCollision((uint64 chainKey,uint64 height,bytes encodedTransaction,(bytes32 root,(bytes32 hash,bool isLeft)[] siblings) merkleProof,(bytes32 lowerEndpointDigest,bytes32[] roots) continuityProof) p) returns (uint256 index)",
  "function collisionCount(bytes32 assetKey) view returns (uint256)",
  "function collisionAt(bytes32 assetKey,uint256 index) view returns ((address emitter,address borrower,uint256 amount,bytes32 instanceId,uint64 chainKey,uint64 sourceHeight,uint64 reportedAt))",
  "function certificateOf(bytes32 assetKey) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function setAdapter(uint64 chainKey,address emitter,address adapter)",
  "function adapterOf(uint64,address) view returns (address)",
  "function getStatus(bytes32 assetKey) view returns ((uint8 state,address emitter,address borrower,uint256 amount,bytes32 instanceId,uint64 chainKey,uint64 sourceHeight,uint64 recordedAt))",
  "function assetKeyOf(uint64 chainKey,address token,uint256 tokenId) pure returns (bytes32)",
  "function minConfirmations(uint64) view returns (uint64)",
  "function allowedEmitter(uint64,address) view returns (bool)",
  "function admin() view returns (address)",
  "function setEmitter(uint64 chainKey,address emitter,bool allowed)",
  "function setMinConfirmations(uint64 chainKey,uint64 depth)",
  "event PledgeRecorded(bytes32 indexed assetKey,address indexed emitter,address indexed borrower,uint64 chainKey,uint256 amount,bytes32 instanceId)",
  "event DoublePledge(bytes32 indexed assetKey,address indexed incumbent,address indexed rejected,uint64 chainKey,uint64 sourceHeight)",
  "event LienSettled(bytes32 indexed assetKey,address indexed emitter,bytes32 instanceId)",
  "event LienReleased(bytes32 indexed assetKey,address indexed emitter,bytes32 instanceId)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "error NotAdmin()",
  "error ProofRejected()",
  "error NotFinal(uint64 height,uint64 attestedTip,uint64 required)",
  "error SourceTransactionReverted()",
  "error NoPledgeLog()",
  "error AmbiguousPledgeLogs(uint256 found)",
  "error EmitterNotAllowed(uint64 chainKey,address emitter)",
  "error ProofAlreadyConsumed(bytes32 nullifier)",
  "error AssetNotFree(bytes32 assetKey,address incumbent)",
  "error AssetNotPledged(bytes32 assetKey)",
  "error NotTheIncumbent(address incumbent,address claimant)",
  "error WrongInstance(bytes32 expected,bytes32 offered)",
  "error NoCollisionToReport(bytes32 assetKey)",
  "error TransitionUnsupported(address emitter,uint8 kind)",
  "error Soulbound()",
  "error NoCertificate(uint256 tokenId)",
];

export const HARBOR_ABI = [
  "function openLien(address collateral,uint256 tokenId,uint256 principal) returns (bytes32 instanceId)",
  "function repayLien(address collateral,uint256 tokenId)",
  "function dischargeLien(address collateral,uint256 tokenId)",
  "function lienState(address collateral,uint256 tokenId) view returns (uint8)",
];

export const MERIDIAN_ABI = [
  "function drawAgainst(address asset,uint256 assetId,uint256 amount) returns (uint256 positionId)",
  "function repay(uint256 positionId)",
  "function closePosition(uint256 positionId)",
  "function setCreditLimit(address obligor,uint256 limit)",
  "function creditLimitOf(address) view returns (uint256)",
  "function positionCount() view returns (uint256)",
];

export const SOURCE_EVENTS_ABI = [
  "event Pledged(address indexed collateralToken,uint256 indexed tokenId,address indexed borrower,uint256 amount,bytes32 pledgeInstanceId)",
  "event Settled(address indexed collateralToken,uint256 indexed tokenId,address indexed borrower,uint256 amount,bytes32 pledgeInstanceId)",
  "event Released(address indexed collateralToken,uint256 indexed tokenId,address indexed borrower,uint256 amount,bytes32 pledgeInstanceId)",
];

/// What each relay operation reads on the source chain and calls on the registry.
export const OPERATIONS = {
  pledge: { event: "Pledged", method: "registerPledge" },
  collision: { event: "Pledged", method: "reportCollision" },
  settle: { event: "Settled", method: "registerSettlement" },
  release: { event: "Released", method: "registerRelease" },
};

export const STATE_NAMES = ["FREE", "PLEDGED", "SETTLED"];
