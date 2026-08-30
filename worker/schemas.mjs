import { ethers } from "ethers";

/**
 * The event schemas the relay can read on a source chain.
 *
 * The registry decides what a log means through an adapter contract. This is the
 * off-chain mirror of the same idea, and it exists for one reason: the relay has
 * to find the right log in a receipt before it can prove anything, and different
 * protocols put the same facts in different places.
 *
 * Both halves must agree. If they disagree, the registry refuses the proof,
 * which is the safe direction: the chain is the authority, not this file.
 */

const SINGLETON_ABI = [
  "event Pledged(address indexed collateralToken,uint256 indexed tokenId,address indexed borrower,uint256 amount,bytes32 pledgeInstanceId)",
  "event Settled(address indexed collateralToken,uint256 indexed tokenId,address indexed borrower,uint256 amount,bytes32 pledgeInstanceId)",
  "event Released(address indexed collateralToken,uint256 indexed tokenId,address indexed borrower,uint256 amount,bytes32 pledgeInstanceId)",
];

const NFTFI_V3_ABI = [
  "event LoanStarted(uint32 indexed loanId,address indexed borrower,address indexed lender,(uint256 loanPrincipalAmount,uint256 maximumRepaymentAmount,uint256 nftCollateralId,address loanERC20Denomination,uint32 loanDuration,uint16 loanInterestRateForDurationInBasisPoints,uint16 loanAdminFeeInBasisPoints,uint256 originationFee,address nftCollateralWrapper,uint64 loanStartTime,address nftCollateralContract,address borrower,address lender,address escrow,bool isProRata) loanTerms)",
  "event LoanRepaid(uint32 indexed loanId,address indexed borrower,address indexed lender,uint256 loanPrincipalAmount,uint256 nftCollateralId,uint256 amountPaidToLender,uint256 adminFee,address nftCollateralContract,address loanERC20Denomination)",
];

const BLEND_ABI = [
  "event LoanOfferTaken(bytes32 offerHash,uint256 lienId,address collection,address lender,address borrower,uint256 loanAmount,uint256 rate,uint256 tokenId,uint256 auctionDuration)",
  "event Repay(uint256 lienId,address collection)",
  "event Seize(uint256 lienId,address collection)",
];

/*
  ConsentedCredit's Pledged carries an EIP-712 signature next to the claim it
  backs, which the relay does not need to check: that check happens twice
  already, once in the emitter and independently again in ConsentedAdapter on
  Creditcoin. The relay only needs the same five fields every other schema
  reads. Settled and Released are byte identical to Harbor's shape.
*/
const CONSENTED_CREDIT_ABI = [
  "event Pledged(address indexed collateralToken,uint256 indexed tokenId,address indexed borrower,uint256 amount,bytes32 pledgeInstanceId,uint256 nonce,uint8 v,bytes32 r,bytes32 s)",
  "event Settled(address indexed collateralToken,uint256 indexed tokenId,address indexed borrower,uint256 amount,bytes32 pledgeInstanceId)",
  "event Released(address indexed collateralToken,uint256 indexed tokenId,address indexed borrower,uint256 amount,bytes32 pledgeInstanceId)",
];

export const SCHEMAS = [
  {
    name: "singleton",
    abi: SINGLETON_ABI,
    events: { pledge: "Pledged", collision: "Pledged", settle: "Settled", release: "Released" },
    read: (parsed) => ({
      token: parsed.args.collateralToken,
      tokenId: parsed.args.tokenId,
      borrower: parsed.args.borrower,
      amount: parsed.args.amount,
      instanceId: parsed.args.pledgeInstanceId,
    }),
  },
  {
    name: "nftfi-v3",
    abi: NFTFI_V3_ABI,
    // NFTfi returns the token in the same transaction that repays the loan, so
    // repayment is a release and there is no settlement to map.
    events: { pledge: "LoanStarted", collision: "LoanStarted", release: "LoanRepaid" },
    read: (parsed) => {
      if (parsed.name === "LoanStarted") {
        const t = parsed.args.loanTerms;
        return {
          token: t.nftCollateralContract,
          tokenId: t.nftCollateralId,
          borrower: t.borrower,
          amount: t.loanPrincipalAmount,
          instanceId: ethers.zeroPadValue(ethers.toBeHex(parsed.args.loanId), 32),
        };
      }
      return {
        token: parsed.args.nftCollateralContract,
        tokenId: parsed.args.nftCollateralId,
        borrower: parsed.args.borrower,
        amount: parsed.args.loanPrincipalAmount,
        instanceId: ethers.zeroPadValue(ethers.toBeHex(parsed.args.loanId), 32),
      };
    },
  },
  {
    name: "blend",
    abi: BLEND_ABI,
    // Blend indexes nothing, and its repayment names no token id, so a release
    // carries only the lien: the registry resolves it through its own index.
    // A Blend lien ends two ways: the borrower repays, or a failed auction lets
    // the lender seize the token. Both are releases and both logs read alike.
    events: {
      pledge: "LoanOfferTaken",
      collision: "LoanOfferTaken",
      release: ["Repay", "Seize"],
    },
    read: (parsed) => {
      if (parsed.name === "LoanOfferTaken") {
        return {
          token: parsed.args.collection,
          tokenId: parsed.args.tokenId,
          borrower: parsed.args.borrower,
          amount: parsed.args.loanAmount,
          instanceId: ethers.zeroPadValue(ethers.toBeHex(parsed.args.lienId), 32),
        };
      }
      return {
        token: ethers.ZeroAddress,
        tokenId: 0n,
        borrower: ethers.ZeroAddress,
        amount: 0n,
        instanceId: ethers.zeroPadValue(ethers.toBeHex(parsed.args.lienId), 32),
      };
    },
  },
  {
    name: "consented-credit",
    abi: CONSENTED_CREDIT_ABI,
    events: { pledge: "Pledged", collision: "Pledged", settle: "Settled", release: "Released" },
    read: (parsed) => ({
      token: parsed.args.collateralToken,
      tokenId: parsed.args.tokenId,
      borrower: parsed.args.borrower,
      amount: parsed.args.amount,
      instanceId: parsed.args.pledgeInstanceId,
    }),
  },
];

/**
 * Finds the single log in a receipt that carries the requested operation, under
 * whichever schema recognises it. Anything but exactly one match is refused
 * here rather than on chain, so the failure is legible.
 */
/**
 * The one log of this kind the emitter wrote.
 *
 * Scoped to the emitter, exactly as the registry scopes it. Topic zero is owned
 * by nobody, so a receipt can carry a matching log some other contract in the
 * same transaction chose to emit; counting those would make the worker refuse a
 * pledge the registry accepts, and disagreeing with the contract is the one
 * thing a mirror must never do.
 */
export function findSourceEvent(receipt, operation, emitter) {
  const hits = [];
  const own = emitter.toLowerCase();

  for (const schema of SCHEMAS) {
    const wanted = schema.events[operation];
    if (!wanted) continue;
    const names = Array.isArray(wanted) ? wanted : [wanted];
    const iface = new ethers.Interface(schema.abi);

    for (const [position, log] of receipt.logs.entries()) {
      if (log.address.toLowerCase() !== own) continue;
      let parsed;
      try {
        parsed = iface.parseLog(log);
      } catch {
        continue;
      }
      if (!parsed || !names.includes(parsed.name)) continue;
      /*
        `position` is the log's place in this receipt, which is what the
        registry indexes. `log.index` is its place in the whole block, and
        passing that instead is a fifty log error on a busy block.
      */
      hits.push({ schema, log, position, parsed, fields: schema.read(parsed, log) });
    }
  }

  /*
    Two schemas naming the same event shape is not ambiguity, it is two names
    for one fact: `consented-credit`'s Settled and Released are declared byte
    identical to `singleton`'s on purpose, and adding that schema made every
    Harbor and Meridian settle or release match both, which used to throw here
    as "found 2" before this ran a single real settlement. Collapsed by
    position instead, and only collapsed when every schema that matched a
    given log actually agrees on what it means; two schemas disagreeing about
    the same log is the one case still worth throwing on.
  */
  const byPosition = new Map();
  const same = (a, b) =>
    JSON.stringify(a, (_, v) => (typeof v === "bigint" ? v.toString() : v))
    === JSON.stringify(b, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  for (const hit of hits) {
    const existing = byPosition.get(hit.position);
    if (!existing) {
      byPosition.set(hit.position, hit);
      continue;
    }
    if (existing.parsed.name !== hit.parsed.name || !same(existing.fields, hit.fields)) {
      throw new Error(
        `log at position ${hit.position} from ${emitter} means two different things: ` +
          `${existing.schema.name} reads ${existing.parsed.name} ${JSON.stringify(existing.fields)}, ` +
          `${hit.schema.name} reads ${hit.parsed.name} ${JSON.stringify(hit.fields)}`,
      );
    }
  }
  const deduped = [...byPosition.values()];

  if (deduped.length !== 1) {
    const seen = deduped.map((h) => `${h.schema.name}:${h.parsed.name}`).join(", ") || "none";
    throw new Error(
      `expected exactly one ${operation} log from ${emitter}, found ${deduped.length} (${seen})`,
    );
  }
  return deduped[0];
}
