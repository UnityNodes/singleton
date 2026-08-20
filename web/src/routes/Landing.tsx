import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Coil } from "@/components/Coil";
import { cn } from "@/lib/utils";
import {
  CFG,
  COLLATERAL,
  KNOWN_ASSETS,
  PROTOCOLS,
  SOURCES,
  nameOf,
  ctc,
  num,
  readAsset,
  readChains,
  short,
  txUrl,
  type ChainFacts,
  type Record_,
} from "@/lib/registry";

/** The collision, as it actually happened, with the hashes to prove it. */
const ACTS = [
  {
    party: "Harbor Credit",
    line: "lends 1,200 against deed 43",
    note: "Sepolia block 11,528,165. The proof lands and the asset is claimed.",
    tx: "0x14a445f857bbb368923d7777b41f503aeeefe3480bbc402cf9143407ed55e6a1",
    on: "cc3" as const,
  },
  {
    party: "Meridian Credit",
    line: "lends against the same deed",
    note: "A different contract. No shared code, no shared storage, no knowledge of Harbor.",
    tx: "0xe0c7e6a4252fbf5bab42f58ca1103df830b4ef81e7846a80e8bfbb3cf6471e85",
    on: "sepolia" as const,
  },
  {
    party: "Singleton",
    line: "refuses the second claim",
    note: "A failed transaction decoding to AssetNotFree, with the asset key and the incumbent in it.",
    tx: "0xe6b94874151481ab7f52c0d73662028104358de9434a5c21eee4115803cb3eda",
    on: "cc3" as const,
    refused: true,
  },
];

function Rule({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-4">
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-line to-line-2" />
      {label && <span className="label shrink-0">{label}</span>}
      <div className="h-px w-10 bg-line" />
    </div>
  );
}

export default function Landing() {
  const [chains, setChains] = useState<Record<number, ChainFacts>>({});
  const [record, setRecord] = useState<Record_ | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const facts = await readChains();
        if (dead) return;
        setChains(facts);
        const a = KNOWN_ASSETS[0];
        const r = await readAsset(facts[a.chainId], a.chainId, a.token, a.tokenId);
        if (!dead) setRecord(r);
      } catch {
        /* the page reads fine without live data */
      }
    })();
    return () => {
      dead = true;
    };
  }, []);

  const claimed = record && record.state !== "free";

  return (
    <div className="min-h-full">
      {/* ----------------------------------------------------------- header */}
      <header className="sticky top-0 z-30 border-b border-line bg-ink/70 backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] max-w-[1240px] items-center gap-8 px-6">
          <Link to="/" className="h-8 shrink-0" aria-label="Singleton, home">
            <img src="/brand/singleton-wordmark-white.svg" alt="Singleton" className="wordmark" />
          </Link>

          <span className="label hidden items-center gap-2.5 md:flex">
            <span className="ping inline-block size-1.5 shrink-0 rounded-full bg-open text-open" />
            a register of liens on creditcoin
          </span>

          <nav className="ml-auto flex items-center gap-6">
            <Link className="label transition-colors hover:text-paper" to="/demo">
              demo
            </Link>
            <a
              className="label hidden transition-colors hover:text-paper sm:block"
              href="https://github.com/UnityNodes/singleton"
              target="_blank"
              rel="noreferrer"
            >
              source
            </a>
            <a
              className="label hidden transition-colors hover:text-paper sm:block"
              href={`${CFG.explorer}/address/${CFG.registry}`}
              target="_blank"
              rel="noreferrer"
            >
              on chain
            </a>
            <Link
              to="/register"
              className="sheen rounded-sm bg-paper px-4 py-2 text-[13px] font-semibold text-ink transition-shadow hover:[box-shadow:0_0_28px_-8px_color-mix(in_oklch,var(--color-paper)_60%,transparent)]"
            >
              open the register
            </Link>
          </nav>
        </div>
      </header>

      {/* ------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden border-b border-line">
        <Coil
          pulse
          spin
          className="absolute -right-[14%] top-1/2 hidden h-[820px] w-[820px] -translate-y-1/2 text-line-2 lg:block xl:-right-[8%]"
        />

        <div className="relative mx-auto max-w-[1240px] px-6 pb-12 pt-20 lg:pb-16 lg:pt-24">
          <h1 className="display max-w-[13ch] text-[clamp(46px,8.4vw,92px)]">
            <span className="rise block" style={{ "--d": "0.05s" } as React.CSSProperties}>
              one asset,
            </span>
            <span className="rise block" style={{ "--d": "0.16s" } as React.CSSProperties}>
              one lien.
            </span>
          </h1>

          <p
            className="rise mt-7 max-w-[54ch] text-[16px] leading-relaxed text-paper-2"
            style={{ "--d": "0.3s" } as React.CSSProperties}
          >
            Two lending protocols that never heard of each other will each lend against the same
            collateral, because neither can see what the other recorded. Singleton witnesses their
            pledges from the outside, asks them for nothing, and refuses the second claim.
          </p>

          <div
            className="rise mt-10 flex flex-wrap items-center gap-3"
            style={{ "--d": "0.42s" } as React.CSSProperties}
          >
            <Link
              to="/register"
              className="sheen rounded-sm bg-paper px-6 py-3 text-[14px] font-semibold text-ink transition-shadow hover:[box-shadow:0_0_36px_-8px_color-mix(in_oklch,var(--color-paper)_65%,transparent)]"
            >
              check an asset
            </Link>
            <Link
              to="/demo"
              className="rounded-sm border border-line-2 px-6 py-3 text-[14px] font-medium transition-colors hover:border-paper-3 hover:bg-surface"
            >
              watch it in ninety seconds
            </Link>
          </div>

          {/* the live record, sitting at the centre of the coil */}
          {/*
            The strip mounts once and then only warms: replaying an entrance when
            the chain answers turns a normal read into a flicker.
          */}
          <div
            className={cn(
              "rise mt-14 grid gap-px border border-line bg-line transition-shadow duration-1000 ease-out lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)]",
              claimed && "lit-live",
            )}
            style={{ "--d": "0.54s" } as React.CSSProperties}
          >
            {[
              {
                k: "asset on file",
                v: record ? `${nameOf(COLLATERAL, record.token) ?? "asset"} #${record.tokenId}` : null,
              },
              {
                /*
                  Null, not "none", when the chain has not answered. The two are
                  different sentences: one says the register holds nothing
                  against this asset, the other says we do not know yet. Saying
                  the first while the node is down is the exact falsehood this
                  page tells lenders not to accept from anybody else.
                */
                k: "lien held by",
                v: !record
                  ? null
                  : claimed
                    ? (nameOf(PROTOCOLS, record.emitter) ?? short(record.emitter, 6, 4))
                    : "none",
                lit: !!claimed,
              },
              {
                k: "pledges refused",
                v: record ? String(record.collisions.length) : null,
                red: !!record?.collisions.length,
              },
              {
                k: "proven from",
                v: !record
                  ? null
                  : claimed
                    ? `${SOURCES[record.chainId]?.name ?? "source"} block ${num(record.sourceHeight)}`
                    : "nothing on file",
              },
            ].map((cell) => (
              <div key={cell.k} className="bg-ink/60 px-5 py-4 backdrop-blur-sm">
                <div className="label">{cell.k}</div>
                <div
                  className={cn(
                    "mt-1.5 font-mono text-[15px] tabular transition-colors duration-700",
                    cell.lit && "text-live",
                    cell.red && "text-refused",
                    !cell.v && "text-paper-3",
                  )}
                >
                  {cell.v ?? "reading the chain"}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-2">
            {Object.entries(chains).map(([id, f]) => (
              <span key={id} className="label inline-flex items-center gap-2">
                <span className="ping inline-block size-1 shrink-0 rounded-full bg-settled text-settled" />
                <span>
                  {SOURCES[Number(id)].name.toLowerCase()} attested to{" "}
                  <span className="tabular text-paper-2">{num(f.tip)}</span>, accepted {f.depth} deep
                  {f.attestors > 0 && (
                    <>
                      , by <span className="tabular text-paper-2">{f.attestors}</span> attestors
                      bonded {ctc(f.bond)}
                    </>
                  )}
                </span>
              </span>
            ))}
            {record && (
              <Link
                to="/register"
                className="label group ml-auto transition-colors hover:text-paper"
              >
                open the full record{" "}
                <span className="inline-block transition-transform group-hover:translate-x-1">
                  &rarr;
                </span>
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- collision */}
      <section className="relative overflow-hidden border-b border-line">
        <Coil
          pulse
          className="absolute -bottom-[38%] -left-[16%] hidden h-[620px] w-[620px] text-refused/25 lg:block"
          rings={20}
        />
        <div className="relative mx-auto max-w-[1240px] px-6 py-16 lg:py-24">
          <h2 className="display max-w-[18ch] text-[clamp(30px,4.4vw,50px)]">
            one asset. two lenders. a refusal you can open yourself.
          </h2>

          <div className="mt-11">
            <Rule label="what happened, on public networks" />
          </div>

          <ol>
            {ACTS.map((act, i) => (
              <li
                key={act.tx}
                className={cn(
                  "reveal group relative grid gap-x-8 gap-y-4 border-b border-line transition-colors md:grid-cols-[minmax(76px,104px)_minmax(0,1.15fr)_minmax(0,1fr)]",
                  act.refused ? "py-10 lg:py-14" : "py-8 lg:py-10",
                  act.refused ? "hover:bg-refused-dim/12" : "hover:bg-surface/50",
                )}
              >
                {act.refused && (
                  <span
                    aria-hidden
                    className="verdict pointer-events-none absolute -left-24 top-1/2 h-64 w-[620px] -translate-y-1/2 rounded-full bg-refused/14 blur-3xl"
                  />
                )}

                <span
                  className={cn(
                    "display tabular self-start text-[clamp(36px,4.8vw,64px)] leading-[0.85]",
                    act.refused ? "text-refused" : "text-paper-3",
                  )}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>

                <div>
                  <div
                    className={cn(
                      "display",
                      act.refused
                        ? "text-refused text-[clamp(26px,3vw,38px)]"
                        : "text-[clamp(22px,2.4vw,30px)]",
                    )}
                  >
                    {act.party}
                  </div>
                  <div
                    className={cn(
                      "mt-1.5 tracking-tight",
                      act.refused
                        ? "text-refused/85 text-[clamp(19px,2vw,24px)]"
                        : "text-paper-2 text-[clamp(17px,1.6vw,20px)]",
                    )}
                  >
                    {act.line}
                  </div>
                </div>

                <div className="self-center">
                  <p className="max-w-[46ch] text-[13.5px] leading-relaxed text-paper-2">
                    {act.note}
                  </p>
                  <a
                    className="mt-3 inline-block font-mono text-[12px] text-paper-3 transition-colors hover:text-paper"
                    href={
                      act.on === "sepolia"
                        ? `https://sepolia.etherscan.io/tx/${act.tx}`
                        : txUrl(act.tx)
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    {act.tx.slice(0, 10)}…{act.tx.slice(-6)}
                  </a>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------- mechanism */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-[1240px] gap-14 px-6 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20 lg:py-24">
          <div>
            <h2 className="display max-w-[16ch] text-[clamp(28px,3.6vw,44px)]">
              a contract cannot read a log. not even its own.
            </h2>
            <div className="mt-8">
              <Rule label="why it exists only here" />
            </div>
            <p className="mt-7 max-w-[52ch] text-[15px] leading-relaxed text-paper-2">
              <span className="font-mono text-[13.5px] text-paper">LOG0</span> through{" "}
              <span className="font-mono text-[13.5px] text-paper">LOG4</span> are write only,
              receipts live in a trie execution never touches, and{" "}
              <span className="font-mono text-[13.5px] text-paper">BLOCKHASH</span> reaches back 256
              blocks.
            </p>
            <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-paper-2">
              So a neutral witness of somebody else's lending is either an off-chain indexer, which
              is a trusted party and therefore not neutral, or a contract that consumes an inclusion
              proof of that log. The second exists here, and nowhere else.
            </p>
          </div>

          <ol className="self-center">
            {[
              {
                k: "the log",
                v: "A lender emits its own event. NFTfi and Blur Blend are read on mainnet, unmodified and unaware.",
              },
              {
                k: `blockprover ${CFG.prover}`,
                v: "The precompile re-checks the inclusion proof inside the transaction that accepts the pledge, past the confirmation depth.",
              },
              {
                k: "the register",
                v: "First to file is recorded and given a soulbound certificate. Anything second reverts.",
              },
            ].map((step, i) => (
              <li
                key={step.k}
                className={cn(
                  "group grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 border-t border-line py-6 transition-colors hover:bg-surface/60",
                  i === 2 && "border-b",
                )}
              >
                <span className="label tabular pt-1 transition-colors group-hover:text-paper">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <div className="font-mono text-[13px] text-paper">{step.k}</div>
                  <p className="mt-2 text-[14px] leading-relaxed text-paper-2">{step.v}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ----------------------------------------------------------- limits */}
      <section>
        <div className="mx-auto max-w-[1240px] px-6 py-16 lg:py-24">
          <div className="grid gap-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-20">
            <div>
              <h2 className="display max-w-[20ch] text-[clamp(26px,3.2vw,40px)]">
                a positive record and a priority rule, not proof of absence.
              </h2>
              <div className="mt-8">
                <Rule label="said before anybody has to ask" />
              </div>
              <p className="mt-7 max-w-[56ch] text-[15px] leading-relaxed text-paper-2">
                An asset the register calls free is one nobody has registered here, which is not the
                same as one nobody has pledged. Attestcoin proves that a transaction happened; it
                cannot prove that one did not. That is exactly how UCC-9 has governed a trillion
                dollar lien market for fifty years: prevention comes from priority and from the habit
                of checking before lending, not from omniscience.
              </p>
            </div>

            <div className="relative flex flex-col justify-center overflow-hidden border border-line bg-surface/70 p-9 backdrop-blur-sm">
              <Coil
                pulse
                className="absolute -right-32 -top-32 h-96 w-96 text-open/55"
                rings={16}
              />
              <span
                aria-hidden
                className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-open/12 blur-3xl"
              />
              <div className="relative">
                <div className="text-[20px] font-semibold tracking-tight">check before you lend</div>
                <p className="mt-3 max-w-[38ch] text-[14px] leading-relaxed text-paper-2">
                  Read only, no wallet, no backend. Every number is an{" "}
                  <span className="font-mono text-[13px] text-paper">eth_call</span> you can repeat.
                </p>
                <Link
                  to="/register"
                  className="sheen mt-7 inline-block rounded-sm bg-paper px-6 py-3 text-[14px] font-semibold text-ink transition-shadow hover:[box-shadow:0_0_36px_-8px_color-mix(in_oklch,var(--color-paper)_65%,transparent)]"
                >
                  open the register
                </Link>
              </div>
            </div>
          </div>

          <footer className="mt-20 flex flex-wrap items-center gap-x-10 gap-y-5 border-t border-line pt-9">
            <img
              src="/brand/singleton-wordmark-white.svg"
              alt="Singleton"
              className="h-9 w-auto opacity-90 transition-opacity hover:opacity-100"
            />
            <span className="label">buidl ctc 2026, on the attestcoin protocol</span>
            <a
              className="label transition-colors hover:text-paper"
              href={`${CFG.explorer}/address/${CFG.registry}`}
              target="_blank"
              rel="noreferrer"
            >
              {short(CFG.registry, 8, 6)}
            </a>
            {chains[1] && (
              <span className="label ml-auto tabular">ethereum attested to {num(chains[1].tip)}</span>
            )}
          </footer>
        </div>
      </section>
    </div>
  );
}
