import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatedBeam } from "@/components/magicui/animated-beam";
import { cn } from "@/lib/utils";
import {
  CFG,
  COLLATERAL,
  KNOWN_ASSETS,
  PROTOCOLS,
  SOURCES,
  ether,
  nameOf,
  num,
  readAsset,
  readChains,
  short,
  txUrl,
  type ChainFacts,
  type Record_,
} from "@/lib/registry";

/** The three transactions the collision is actually made of. */
const SEQUENCE = [
  {
    lead: "Harbor Credit lends first",
    body: "1,000 against deed 42 on Sepolia. The lien is proven to Creditcoin and the asset is claimed.",
    tx: "0xc10d2adecd8f6c55b64cc7eab7d7ac0c567ea78ed6b80713157d6ad61fabbd6e",
    where: "cc3" as const,
  },
  {
    lead: "Meridian Credit lends against the same deed",
    body: "A different contract, no shared code, no shared storage, no knowledge of Harbor. On chain this transaction succeeds.",
    tx: "0x8de34d47d39abdb46a05d1834964e1eb2ae4b3b3ce930f46259f8a1aae2e387b",
    where: "sepolia" as const,
  },
  {
    lead: "The register refuses the second claim",
    body: "The proof is good, the asset is not free, and the attempt is kept on file for the next lender to see.",
    tx: "0xa9331fe3beb0633ddd69be208f35b65156574b142aff6cdd32f5067ae6dce908",
    where: "cc3" as const,
    refused: true,
  },
];

function LiveRecord({ record, chains }: { record: Record_ | null; chains: Record<number, ChainFacts> }) {
  if (!record) {
    return (
      <div className="rounded-lg border border-line bg-surface p-6">
        <div className="h-3 w-28 animate-pulse rounded bg-raised" />
        <div className="mt-4 h-6 w-52 animate-pulse rounded bg-raised" />
        <div className="mt-6 space-y-3">
          <div className="h-3 w-full animate-pulse rounded bg-raised" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-raised" />
        </div>
      </div>
    );
  }

  const source = SOURCES[record.chainId];
  const holder = nameOf(PROTOCOLS, record.emitter);
  const claimed = record.state !== "free";

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="text-[12px] text-paper-2">Live from the register</span>
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11.5px] font-medium",
            claimed ? "bg-paper text-ink" : "bg-raised text-paper-2",
          )}
        >
          <span className={cn("size-1.5 rounded-full", claimed ? "bg-ink" : "bg-free")} />
          {claimed ? "claimed" : "free"}
        </span>
      </div>

      <div className="px-5 py-5">
        <div className="text-[19px] font-medium tracking-tight">
          {nameOf(COLLATERAL, record.token) ?? short(record.token, 6, 4)} #{record.tokenId}
        </div>
        <div className="mt-1 font-mono text-[12px] text-paper-3">
          key {short(record.assetKey, 10, 8)}
        </div>

        <dl className="mt-5 space-y-2.5 text-[13px]">
          {claimed && (
            <>
              <div className="flex justify-between gap-4">
                <dt className="text-paper-2">Lien held by</dt>
                <dd>{holder ?? short(record.emitter, 6, 4)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-paper-2">Principal</dt>
                <dd className="tabular">{ether(record.amount)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-paper-2">Proven from</dt>
                <dd className="tabular">
                  {source.name} block {num(record.sourceHeight)}
                </dd>
              </div>
            </>
          )}
          <div className="flex justify-between gap-4">
            <dt className="text-paper-2">Pledges refused</dt>
            <dd className={cn("tabular", record.collisions.length && "text-refused")}>
              {record.collisions.length}
            </dd>
          </div>
        </dl>
      </div>

      <Link
        to="/register"
        className="flex items-center justify-between border-t border-line px-5 py-3 text-[13px] text-paper-2 transition-colors hover:bg-raised hover:text-paper"
      >
        Open the full record
        <span aria-hidden>&rarr;</span>
      </Link>

      {chains[record.chainId] && (
        <div className="border-t border-line px-5 py-2.5 text-[11.5px] text-paper-3">
          {SOURCES[record.chainId].name} attested to{" "}
          <span className="tabular">{num(chains[record.chainId].tip)}</span>, accepted at{" "}
          {chains[record.chainId].depth} blocks deep
        </div>
      )}
    </div>
  );
}

export default function Landing() {
  const container = useRef<HTMLDivElement>(null);
  const one = useRef<HTMLDivElement>(null);
  const two = useRef<HTMLDivElement>(null);
  const three = useRef<HTMLDivElement>(null);

  const [chains, setChains] = useState<Record<number, ChainFacts>>({});
  const [record, setRecord] = useState<Record_ | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const facts = await readChains();
        if (cancelled) return;
        setChains(facts);
        const demo = KNOWN_ASSETS[0];
        const next = await readAsset(facts[demo.chainId], demo.chainId, demo.token, demo.tokenId);
        if (!cancelled) setRecord(next);
      } catch {
        /* the page still reads without live data */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-full bg-ink">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-ink/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
          <Link to="/" className="h-5 shrink-0" aria-label="Singleton, home">
            <img src="/brand/singleton-wordmark-white.svg" alt="Singleton" className="wordmark" />
          </Link>
          <nav className="ml-auto flex items-center gap-1 text-[13px]">
            <a
              className="hidden rounded-md px-3 py-2 text-paper-2 transition-colors hover:text-paper sm:block"
              href="https://github.com/UnityNodes/singleton"
              target="_blank"
              rel="noreferrer"
            >
              Code
            </a>
            <a
              className="hidden rounded-md px-3 py-2 text-paper-2 transition-colors hover:text-paper sm:block"
              href={`${CFG.explorer}/address/${CFG.registry}`}
              target="_blank"
              rel="noreferrer"
            >
              On chain
            </a>
            <Link
              to="/register"
              className="rounded-md bg-paper px-4 py-2 font-medium text-ink transition-opacity hover:opacity-90"
            >
              Open the register
            </Link>
          </nav>
        </div>
      </header>

      {/* ------------------------------------------------------------- hero */}
      <section className="border-b border-line/70">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center lg:gap-20 lg:py-24">
          <div>
            <h1 className="text-balance text-4xl font-semibold leading-[1.06] tracking-tight sm:text-[56px]">
              An asset can be financed once.
            </h1>
            <p className="mt-6 max-w-xl text-pretty text-[15.5px] leading-relaxed text-paper-2">
              Two lending protocols that have never heard of each other will each lend against the
              same collateral, because neither can see what the other recorded. Singleton witnesses
              their pledges from the outside, without asking them for anything, and refuses the
              second claim.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                to="/register"
                className="rounded-md bg-paper px-5 py-2.5 text-[14px] font-medium text-ink transition-opacity hover:opacity-90"
              >
                Check an asset
              </Link>
              <a
                href="https://github.com/UnityNodes/singleton"
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-line px-5 py-2.5 text-[14px] text-paper transition-colors hover:border-line-2 hover:bg-surface"
              >
                Read the contracts
              </a>
            </div>

            <p className="mt-8 text-[13px] text-paper-3">
              Live on Creditcoin testnet, reading Ethereum and Sepolia. Four lending protocols are
              read unmodified, two of them real ones on mainnet.
            </p>
          </div>

          <LiveRecord record={record} chains={chains} />
        </div>
      </section>

      {/* ------------------------------------------------------- the moment */}
      <section className="border-b border-line/70">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <h2 className="max-w-2xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            One asset, two lenders, and a refusal anybody can check
          </h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-paper-2">
            Every hash below is a real transaction on a public network. Nothing is staged and nothing
            is integrated: the lenders share no code, and neither knows this register exists.
          </p>

          <ol className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3">
            {SEQUENCE.map((step, i) => (
              <li key={step.tx} className="flex flex-col bg-ink p-6">
                <div
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full text-[12px] font-medium",
                    step.refused ? "bg-refused-dim/30 text-refused" : "bg-raised text-paper",
                  )}
                >
                  {i + 1}
                </div>
                <h3
                  className={cn(
                    "mt-4 text-[15px] font-medium",
                    step.refused ? "text-refused" : "text-paper",
                  )}
                >
                  {step.lead}
                </h3>
                <p className="mt-2 flex-1 text-[13.5px] leading-relaxed text-paper-2">{step.body}</p>
                <a
                  className="mt-5 font-mono text-[12px] text-paper-3 transition-colors hover:text-paper"
                  href={
                    step.where === "sepolia"
                      ? `https://sepolia.etherscan.io/tx/${step.tx}`
                      : txUrl(step.tx)
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {step.tx.slice(0, 14)}…{step.tx.slice(-8)}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------------------------------------------------- the mechanism */}
      <section className="border-b border-line/70">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-20">
            <div>
              <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
                Why this exists only on Creditcoin
              </h2>
              <p className="mt-5 text-[15px] leading-relaxed text-paper-2">
                An EVM contract cannot read event logs. Not another contract's, and not its own.
                <code className="mx-1.5 rounded bg-surface px-1.5 py-0.5 font-mono text-[13px] text-paper">
                  LOG0
                </code>
                through
                <code className="mx-1.5 rounded bg-surface px-1.5 py-0.5 font-mono text-[13px] text-paper">
                  LOG4
                </code>
                are write only, receipts live in a trie execution never touches, and
                <code className="mx-1.5 rounded bg-surface px-1.5 py-0.5 font-mono text-[13px] text-paper">
                  BLOCKHASH
                </code>
                reaches back 256 blocks.
              </p>
              <p className="mt-4 text-[15px] leading-relaxed text-paper-2">
                So a neutral witness of somebody else's lending is either an off-chain indexer, which
                is a trusted party and therefore not neutral, or a contract that consumes an
                inclusion proof of that log. The second exists here, through the BlockProver
                precompile at <span className="font-mono text-[13.5px] text-paper">{CFG.prover}</span>.
              </p>
              <p className="mt-4 text-[15px] leading-relaxed text-paper-2">
                That is a property of the machine, not a claim about positioning.
              </p>
            </div>

            <div ref={container} className="relative flex flex-col justify-center gap-8">
              {[
                {
                  ref: one,
                  title: "A lender emits its own log",
                  sub: "NFTfi or Blur Blend on Ethereum. Unmodified, uncooperating, unaware.",
                },
                {
                  ref: two,
                  title: `BlockProver ${CFG.prover} re-checks the inclusion proof`,
                  sub: "Inside the transaction that accepts the pledge, and only past the confirmation depth.",
                },
                {
                  ref: three,
                  title: "Singleton records the lien, or refuses it",
                  sub: "First to file wins. The second claim reverts and the attempt is kept.",
                  accent: true,
                },
              ].map((node) => (
                <div
                  key={node.title}
                  ref={node.ref}
                  className={cn(
                    "z-10 rounded-lg border px-5 py-4",
                    node.accent ? "border-paper/35 bg-raised" : "border-line bg-surface",
                  )}
                >
                  <div className="text-[13.5px] font-medium">{node.title}</div>
                  <div className="mt-1 text-[12.5px] leading-snug text-paper-2">{node.sub}</div>
                </div>
              ))}

              <AnimatedBeam
                containerRef={container}
                fromRef={one}
                toRef={two}
                curvature={-26}
                duration={3}
                pathColor="#5a5a5e"
                pathOpacity={0.5}
                gradientStartColor="#fafafb"
                gradientStopColor="#86868a"
              />
              <AnimatedBeam
                containerRef={container}
                fromRef={two}
                toRef={three}
                curvature={26}
                duration={3}
                delay={0.7}
                pathColor="#5a5a5e"
                pathOpacity={0.5}
                gradientStartColor="#fafafb"
                gradientStopColor="#86868a"
              />
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- the limit */}
      <section>
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-20">
            <div>
              <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
                What this is not
              </h2>
              <p className="mt-5 text-[15px] leading-relaxed text-paper-2">
                A positive record and a priority rule, not proof of absence. An asset the register
                calls free is one nobody has registered here, which is not the same as one nobody has
                pledged. Attestcoin proves that a transaction happened; it cannot prove that one did
                not.
              </p>
              <p className="mt-4 text-[15px] leading-relaxed text-paper-2">
                That is exactly how UCC-9 has governed a trillion dollar lien market for fifty years.
                Prevention comes from priority and from the habit of checking before lending, not
                from omniscience.
              </p>
            </div>

            <div className="flex flex-col justify-center gap-4 rounded-lg border border-line bg-surface p-8">
              <img
                src="/brand/singleton-icon-white.svg"
                alt=""
                aria-hidden
                className="h-9 w-9 opacity-90"
              />
              <div className="text-[16px] font-medium">Check before you lend</div>
              <p className="text-[13.5px] leading-relaxed text-paper-2">
                The register is read only and needs no wallet. Every number in it is an{" "}
                <span className="font-mono text-[13px] text-paper">eth_call</span> you can repeat
                yourself.
              </p>
              <Link
                to="/register"
                className="mt-1 self-start rounded-md bg-paper px-5 py-2.5 text-[14px] font-medium text-ink transition-opacity hover:opacity-90"
              >
                Open the register
              </Link>
            </div>
          </div>

          <footer className="mt-16 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-line/70 pt-7 text-[12.5px] text-paper-3">
            <img src="/brand/singleton-icon-white.svg" alt="" aria-hidden className="h-4 w-4 opacity-70" />
            <span>Built for BUIDL CTC 2026 on the Attestcoin protocol</span>
            <a
              className="font-mono transition-colors hover:text-paper"
              href={`${CFG.explorer}/address/${CFG.registry}`}
              target="_blank"
              rel="noreferrer"
            >
              {short(CFG.registry, 8, 6)}
            </a>
            {chains[1] && <span className="tabular">Ethereum attested to {num(chains[1].tip)}</span>}
          </footer>
        </div>
      </section>
    </div>
  );
}
