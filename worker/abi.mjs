export const REGISTRY_ABI = [
  "function registerPledge((uint64 chainKey,uint64 height,bytes encodedTransaction,(bytes32 root,(bytes32 hash,bool isLeft)[] siblings) merkleProof,(bytes32 lowerEndpointDigest,bytes32[] roots) continuityProof) p) returns (bytes32 assetKey)",
  "function getStatus(bytes32 assetKey) view returns ((uint8 state,address emitter,address borrower,uint256 amount,bytes32 instanceId,uint64 chainKey,uint64 sourceHeight,uint64 recordedAt))",
  "function assetKeyOf(uint64 chainKey,address token,uint256 tokenId) pure returns (bytes32)",
  "function minConfirmations(uint64) view returns (uint64)",
  "function allowedEmitter(uint64,address) view returns (bool)",
  "function admin() view returns (address)",
  "function setEmitter(uint64 chainKey,address emitter,bool allowed)",
  "function setMinConfirmations(uint64 chainKey,uint64 depth)",
  "event PledgeRecorded(bytes32 indexed assetKey,address indexed emitter,address indexed borrower,uint64 chainKey,uint256 amount,bytes32 instanceId)",
  "event DoublePledge(bytes32 indexed assetKey,address indexed incumbent,address indexed rejected)",
  "error NotAdmin()",
  "error ProofRejected()",
  "error NotFinal(uint64 height,uint64 attestedTip,uint64 required)",
  "error SourceTransactionReverted()",
  "error NoPledgeLog()",
  "error AmbiguousPledgeLogs(uint256 found)",
  "error EmitterNotAllowed(uint64 chainKey,address emitter)",
  "error ProofAlreadyConsumed(bytes32 nullifier)",
  "error AssetNotFree(bytes32 assetKey,address incumbent)",
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

export const PLEDGED_ABI = [
  "event Pledged(address indexed collateralToken,uint256 indexed tokenId,address indexed borrower,uint256 amount,bytes32 pledgeInstanceId)",
];

export const STATE_NAMES = ["FREE", "PLEDGED", "SETTLED"];
