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
];

/**
 * Finds the single log in a receipt that carries the requested operation, under
 * whichever schema recognises it. Anything but exactly one match is refused
 * here rather than on chain, so the failure is legible.
 */
export function findSourceEvent(receipt, operation) {
  const hits = [];

  for (const schema of SCHEMAS) {
    const wanted = schema.events[operation];
    if (!wanted) continue;
    const names = Array.isArray(wanted) ? wanted : [wanted];
    const iface = new ethers.Interface(schema.abi);

    for (const log of receipt.logs) {
      let parsed;
      try {
        parsed = iface.parseLog(log);
      } catch {
        continue;
      }
      if (!parsed || !names.includes(parsed.name)) continue;
      hits.push({ schema, log, parsed, fields: schema.read(parsed, log) });
    }
  }

  if (hits.length !== 1) {
    const seen = hits.map((h) => `${h.schema.name}:${h.parsed.name}`).join(", ") || "none";
    throw new Error(`expected exactly one ${operation} log, found ${hits.length} (${seen})`);
  }
  return hits[0];
}
