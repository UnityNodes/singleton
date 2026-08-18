import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatedBeam } from "@/components/magicui/animated-beam";
import { AnimatedShinyText } from "@/components/magicui/animated-shiny-text";
import { BlurFade } from "@/components/magicui/blur-fade";
import { DotPattern } from "@/components/magicui/dot-pattern";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { cn } from "@/lib/utils";
import { CFG, num, readChains, readLogs, type ChainFacts } from "@/lib/registry";

/* The three real transactions the collision story is made of. */
const ACT = [
  {
    who: "Harbor Credit",
    what: "lends 1,000 against deed 42 on Sepolia and files first",
    tx: "0xc10d2adecd8f6c55b64cc7eab7d7ac0c567ea78ed6b80713157d6ad61fabbd6e",
    tone: "kept" as const,
  },
  {
    who: "Meridian Credit",
    what: "has never heard of Harbor, and lends against the same deed",
    tx: "0x8de34d47d39abdb46a05d1834964e1eb2ae4b3b3ce930f46259f8a1aae2e387b",
    chain: "sepolia" as const,
    tone: "attempt" as const,
  },
  {
    who: "The register",
    what: "refuses the second claim and keeps the attempt on file",
    tx: "0xa9331fe3beb0633ddd69be208f35b65156574b142aff6cdd32f5067ae6dce908",
    tone: "refused" as const,
  },
];

function Node({
  innerRef,
  title,
  sub,
  accent,
}: {
  innerRef: React.RefObject<HTMLDivElement | null>;
  title: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div
      ref={innerRef}
      className={cn(
        "z-10 w-full rounded-lg border px-4 py-3 backdrop-blur-sm",
        accent
          ? "border-accent-bright/50 bg-accent-bright/10"
          : "border-night-line bg-night-2/70",
      )}
    >
      <div className="text-[13px] font-medium text-night-ink">{title}</div>
      <div className="mt-0.5 text-[12px] leading-snug text-night-ink-2">{sub}</div>
    </div>
  );
}

export default function Landing() {
  const container = useRef<HTMLDivElement>(null);
  const one = useRef<HTMLDivElement>(null);
  const two = useRef<HTMLDivElement>(null);
  const three = useRef<HTMLDivElement>(null);

  const [chains, setChains] = useState<Record<number, ChainFacts>>({});
  const [entries, setEntries] = useState<number | null>(null);

  useEffect(() => {
    readChains().then(setChains).catch(() => {});
    readLogs([]).then(({ logs }) => setEntries(logs.length)).catch(() => {});
  }, []);

  const sepolia = chains[11155111];
  const ethereum = chains[1];

  return (
    <div className="min-h-full bg-night text-night-ink">
      <header className="sticky top-0 z-30 border-b border-night-line/60 bg-night/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-5">
          <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden>
            <rect x="2" y="2" width="28" height="28" rx="6" fill="oklch(0.48 0.15 290)" />
            <rect x="10" y="10" width="12" height="12" rx="2" fill="none" stroke="#fff" strokeWidth="2.4" />
          </svg>
          <span className="font-semibold tracking-tight">Singleton</span>
          <span className="hidden text-[13px] text-night-ink-2 sm:inline">register of liens</span>
          <nav className="ml-auto flex items-center gap-2 text-[13px]">
            <a
              className="hidden rounded-md px-3 py-1.5 text-night-ink-2 transition-colors hover:text-night-ink sm:inline"
              href="https://github.com/UnityNodes/singleton"
              target="_blank"
              rel="noreferrer"
            >
              Code
            </a>
            <Link
              to="/register"
              className="rounded-md bg-white px-3.5 py-1.5 font-medium text-night transition-colors hover:bg-accent-bright"
            >
              Open the register
            </Link>
          </nav>
        </div>
      </header>

      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden border-b border-night-line/60">
        <DotPattern
          width={26}
          height={26}
          className={cn("[mask-image:radial-gradient(560px_circle_at_center,white,transparent)] fill-white/[0.09]")}
        />
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
          <BlurFade delay={0.05} inView>
            <div className="inline-flex items-center rounded-full border border-night-line bg-night-2/60 px-3 py-1 text-[12px]">
              <AnimatedShinyText className="text-night-ink-2">
                Live on Creditcoin testnet · reading Ethereum and Sepolia
              </AnimatedShinyText>
            </div>
          </BlurFade>

          <BlurFade delay={0.12} inView>
            <h1 className="mt-6 max-w-3xl text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
              An asset can be financed once.
            </h1>
          </BlurFade>

          <BlurFade delay={0.2} inView>
            <p className="mt-5 max-w-2xl text-pretty text-[15px] leading-relaxed text-night-ink-2 sm:text-base">
              Two lending protocols that have never heard of each other will each lend against the
              same collateral, because neither can see what the other recorded. Singleton witnesses
              their pledges from the outside, without asking them for anything, and refuses the
              second claim.
            </p>
          </BlurFade>

          <BlurFade delay={0.28} inView>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/register"
                className="rounded-md bg-white px-5 py-2.5 text-[14px] font-medium text-night transition-colors hover:bg-accent-bright"
              >
                Check an asset
              </Link>
              <a
                href={`${CFG.explorer}/address/${CFG.registry}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-night-line px-5 py-2.5 text-[14px] text-night-ink transition-colors hover:border-night-ink-2"
              >
                The registry on chain
              </a>
            </div>
          </BlurFade>

          <BlurFade delay={0.36} inView>
            <dl className="mt-14 grid max-w-3xl grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
              {[
                { k: "Ethereum attested to", v: ethereum?.tip },
                { k: "Sepolia attested to", v: sepolia?.tip },
                { k: "Entries in the register", v: entries ?? undefined },
                { k: "Protocols read, unmodified", v: 4 },
              ].map(({ k, v }) => (
                <div key={k}>
                  <dd className="tabular text-2xl font-medium">
                    {v === undefined ? (
                      <span className="inline-block h-7 w-24 animate-pulse rounded bg-night-2" />
                    ) : (
                      <NumberTicker value={v} className="text-night-ink" />
                    )}
                  </dd>
                  <dt className="mt-1 text-[12.5px] text-night-ink-2">{k}</dt>
                </div>
              ))}
            </dl>
          </BlurFade>
        </div>
      </section>

      {/* ------------------------------------------------------- mechanism */}
      <section className="border-b border-night-line/60">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Why this exists only here
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-night-ink-2">
                An EVM contract cannot read event logs. Not another contract's, and not its own.
                <code className="mx-1 rounded bg-night-2 px-1.5 py-0.5 font-mono text-[13px] text-night-ink">
                  LOG0
                </code>
                through
                <code className="mx-1 rounded bg-night-2 px-1.5 py-0.5 font-mono text-[13px] text-night-ink">
                  LOG4
                </code>
                are write only, receipts live in a trie execution never touches, and
                <code className="mx-1 rounded bg-night-2 px-1.5 py-0.5 font-mono text-[13px] text-night-ink">
                  BLOCKHASH
                </code>
                reaches back 256 blocks.
              </p>
              <p className="mt-4 text-[15px] leading-relaxed text-night-ink-2">
                So a neutral witness of somebody else's lending is either an off-chain indexer, which
                is a trusted party and therefore not neutral, or a contract that consumes an
                inclusion proof of that log. The second exists on Creditcoin, through the BlockProver
                precompile at{" "}
                <span className="font-mono text-[13px] text-night-ink">{CFG.prover}</span>.
              </p>
              <p className="mt-4 text-[15px] leading-relaxed text-night-ink-2">
                That is a property of the machine, not a positioning claim.
              </p>
            </div>

            <div ref={container} className="relative flex flex-col justify-center gap-7 py-2">
              <Node
                innerRef={one}
                title="A lending protocol emits its own log"
                sub="NFTfi, Blur Blend, or any lender on Ethereum. Unmodified, uncooperating, unaware."
              />
              <Node
                innerRef={two}
                title="BlockProver 0x0FD2 re-checks the inclusion proof"
                sub="Inside the same transaction that accepts the pledge, and only past the confirmation depth."
              />
              <Node
                innerRef={three}
                accent
                title="Singleton records the lien, or refuses it"
                sub="First to file wins. The second claim reverts, and the attempt is kept on file."
              />
              <AnimatedBeam
                containerRef={container}
                fromRef={one}
                toRef={two}
                curvature={-28}
                duration={3}
                gradientStartColor="#8b6ff0"
                gradientStopColor="#5f49ab"
                pathColor="#6b6a78"
                pathOpacity={0.25}
              />
              <AnimatedBeam
                containerRef={container}
                fromRef={two}
                toRef={three}
                curvature={28}
                duration={3}
                delay={0.6}
                gradientStartColor="#8b6ff0"
                gradientStopColor="#5f49ab"
                pathColor="#6b6a78"
                pathOpacity={0.25}
              />
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- the act */}
      <section className="border-b border-night-line/60">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            One asset, two lenders, live
          </h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-night-ink-2">
            Every hash below is a real transaction on a public testnet. Nothing is staged, and
            nothing was integrated: the two lenders share no code, no storage and no agreement.
          </p>

          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {ACT.map((step) => (
              <li
                key={step.tx}
                className={cn(
                    "flex h-full flex-col rounded-lg border bg-night-2/50 p-5",
                    step.tone === "refused" ? "border-danger/50" : "border-night-line",
                  )}
                >
                  <div
                    className={cn(
                      "text-[12px] font-medium",
                      step.tone === "refused" ? "text-danger" : "text-accent-bright",
                    )}
                  >
                    {step.tone === "kept" ? "First to file" : step.tone === "attempt" ? "Second pledge" : "Refused"}
                  </div>
                  <div className="mt-2 text-[15px] font-medium">{step.who}</div>
                  <p className="mt-1 flex-1 text-[13.5px] leading-relaxed text-night-ink-2">
                    {step.what}
                  </p>
                  <a
                    className="mt-4 font-mono text-[12px] text-accent-bright hover:underline"
                    href={
                      step.chain === "sepolia"
                        ? `https://sepolia.etherscan.io/tx/${step.tx}`
                        : `${CFG.explorer}/tx/${step.tx}`
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    {step.tx.slice(0, 12)}…{step.tx.slice(-6)}
                  </a>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------- the limit */}
      <section>
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                What this is not
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-night-ink-2">
                A positive record and a priority rule, not proof of absence. An asset the register
                calls free is one nobody has registered here, which is not the same as one nobody has
                pledged. Attestcoin proves that a transaction happened; it cannot prove that one did
                not.
              </p>
              <p className="mt-4 text-[15px] leading-relaxed text-night-ink-2">
                That is exactly how UCC-9 has governed a trillion dollar lien market for fifty years.
                Prevention comes from priority and from the habit of checking before lending, not
                from omniscience.
              </p>
            </div>

            <div className="flex flex-col justify-center gap-4 rounded-lg border border-night-line bg-night-2/40 p-7">
              <div className="text-[15px] font-medium">Check an asset before you lend against it</div>
              <p className="text-[13.5px] leading-relaxed text-night-ink-2">
                The register is read only and needs no wallet. Every number in it is an
                <code className="mx-1 font-mono text-[12.5px] text-night-ink">eth_call</code>
                you can repeat yourself.
              </p>
              <Link
                to="/register"
                className="mt-1 self-start rounded-md bg-white px-5 py-2.5 text-[14px] font-medium text-night transition-colors hover:bg-accent-bright"
              >
                Open the register
              </Link>
            </div>
          </div>

          <footer className="mt-16 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-night-line/60 pt-6 text-[12.5px] text-night-ink-2">
            <span>Built for BUIDL CTC 2026 on the Attestcoin protocol</span>
            <span>
              Registry{" "}
              <a
                className="font-mono text-night-ink hover:underline"
                href={`${CFG.explorer}/address/${CFG.registry}`}
                target="_blank"
                rel="noreferrer"
              >
                {CFG.registry.slice(0, 8)}…{CFG.registry.slice(-6)}
              </a>
            </span>
            {ethereum && <span className="tabular">Ethereum attested to {num(ethereum.tip)}</span>}
          </footer>
        </div>
      </section>
    </div>
  );
}
