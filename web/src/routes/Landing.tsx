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
    line: "lends 1,000 against deed 42",
    note: "Sepolia block 11,510,076. The proof lands and the asset is claimed.",
    tx: "0xc10d2adecd8f6c55b64cc7eab7d7ac0c567ea78ed6b80713157d6ad61fabbd6e",
    on: "cc3" as const,
  },
  {
    party: "Meridian Credit",
    line: "lends 750 against the same deed",
    note: "A different contract. No shared code, no shared storage, no knowledge of Harbor.",
    tx: "0x8de34d47d39abdb46a05d1834964e1eb2ae4b3b3ce930f46259f8a1aae2e387b",
    on: "sepolia" as const,
  },
  {
    party: "Singleton",
    line: "refuses the second claim",
    note: "The proof is good. The asset is not free. The attempt stays on file for the next lender.",
    tx: "0xa9331fe3beb0633ddd69be208f35b65156574b142aff6cdd32f5067ae6dce908",
    on: "cc3" as const,
    refused: true,
  },
];

function Rule({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-4">
      <div className="h-px flex-1 bg-line" />
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
    <div className="min-h-full bg-ink">
      {/* ----------------------------------------------------------- header */}
      <header className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur">
        <div className="mx-auto flex h-[76px] max-w-[1240px] items-center gap-8 px-6">
          <Link to="/" className="h-8 shrink-0" aria-label="Singleton, home">
            <img src="/brand/singleton-wordmark-white.svg" alt="Singleton" className="wordmark" />
          </Link>

          <span className="label hidden md:block">a register of liens on creditcoin</span>

          <nav className="ml-auto flex items-center gap-6">
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
              className="rounded-sm bg-paper px-4 py-2 text-[13px] font-semibold text-ink transition-opacity hover:opacity-90"
            >
              open the register
            </Link>
          </nav>
        </div>
      </header>

      {/* ------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden border-b border-line">
        <Coil className="absolute -right-[14%] top-1/2 hidden h-[820px] w-[820px] -translate-y-1/2 text-line-2/90 lg:block xl:-right-[8%]" />

        <div className="relative mx-auto max-w-[1240px] px-6 pb-12 pt-20 lg:pb-16 lg:pt-24">
          <h1 className="display max-w-[13ch] text-[clamp(46px,8.4vw,92px)]">
            one asset,
            <br />
            one lien.
          </h1>

          <p className="mt-7 max-w-[54ch] text-[16px] leading-relaxed text-paper-2">
            Two lending protocols that never heard of each other will each lend against the same
            collateral, because neither can see what the other recorded. Singleton witnesses their
            pledges from the outside, asks them for nothing, and refuses the second claim.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              to="/register"
              className="rounded-sm bg-paper px-6 py-3 text-[14px] font-semibold text-ink transition-opacity hover:opacity-90"
            >
              check an asset
            </Link>
            <a
              href="https://github.com/UnityNodes/singleton"
              target="_blank"
              rel="noreferrer"
              className="rounded-sm border border-line-2 px-6 py-3 text-[14px] font-medium transition-colors hover:bg-surface"
            >
              read the contracts
            </a>
          </div>

          {/* the live record, sitting at the centre of the coil */}
          <div className="mt-14 grid gap-px border border-line bg-line lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
            {[
              {
                k: "asset on file",
                v: record ? `${nameOf(COLLATERAL, record.token) ?? "asset"} #${record.tokenId}` : null,
              },
              {
                k: "lien held by",
                v: claimed ? (nameOf(PROTOCOLS, record!.emitter) ?? short(record!.emitter, 6, 4)) : "none",
              },
              { k: "pledges refused", v: record ? String(record.collisions.length) : null, red: !!record?.collisions.length },
              {
                k: "proven from",
                v: claimed
                  ? `${SOURCES[record!.chainId].name} block ${num(record!.sourceHeight)}`
                  : "nothing on file",
              },
            ].map((cell) => (
              <div key={cell.k} className="bg-ink px-5 py-4">
                <div className="label">{cell.k}</div>
                <div
                  className={cn(
                    "mt-1.5 font-mono text-[15px]",
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
              <span key={id} className="label">
                {SOURCES[Number(id)].name.toLowerCase()} attested to{" "}
                <span className="tabular text-paper-2">{num(f.tip)}</span>, accepted {f.depth} deep
              </span>
            ))}
            {record && (
              <Link to="/register" className="label ml-auto transition-colors hover:text-paper">
                open the full record &rarr;
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- collision */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-[1240px] px-6 py-16 lg:py-24">
          <Rule label="what happened, on public networks" />

          <h2 className="display mt-8 max-w-[18ch] text-[clamp(30px,4.4vw,50px)]">
            one asset. two lenders. a refusal you can open yourself.
          </h2>

          <ol className="mt-12">
            {ACTS.map((act, i) => (
              <li
                key={act.tx}
                className={cn(
                  "grid gap-x-8 gap-y-3 border-t border-line py-7 md:grid-cols-[64px_minmax(0,1.1fr)_minmax(0,1fr)_auto]",
                  i === ACTS.length - 1 && "border-b",
                )}
              >
                <span className={cn("label pt-1 tabular", act.refused && "text-refused")}>
                  {String(i + 1).padStart(2, "0")}
                </span>

                <div>
                  <div
                    className={cn(
                      "text-[19px] font-semibold tracking-tight",
                      act.refused && "text-refused",
                    )}
                  >
                    {act.party}
                  </div>
                  <div
                    className={cn(
                      "mt-0.5 text-[19px] tracking-tight text-paper-2",
                      act.refused && "text-refused/90",
                    )}
                  >
                    {act.line}
                  </div>
                </div>

                <p className="max-w-[46ch] self-center text-[13.5px] leading-relaxed text-paper-2">
                  {act.note}
                </p>

                <a
                  className="self-center font-mono text-[12px] text-paper-3 transition-colors hover:text-paper"
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
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------- mechanism */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-[1240px] gap-14 px-6 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20 lg:py-24">
          <div>
            <Rule label="why it exists only here" />
            <h2 className="display mt-8 max-w-[16ch] text-[clamp(28px,3.6vw,44px)]">
              a contract cannot read a log. not even its own.
            </h2>
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
                  "grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 border-t border-line py-6",
                  i === 2 && "border-b",
                )}
              >
                <span className="label tabular pt-1">{String(i + 1).padStart(2, "0")}</span>
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
              <Rule label="said before anybody has to ask" />
              <h2 className="display mt-8 max-w-[20ch] text-[clamp(26px,3.2vw,40px)]">
                a positive record and a priority rule, not proof of absence.
              </h2>
              <p className="mt-7 max-w-[56ch] text-[15px] leading-relaxed text-paper-2">
                An asset the register calls free is one nobody has registered here, which is not the
                same as one nobody has pledged. Attestcoin proves that a transaction happened; it
                cannot prove that one did not. That is exactly how UCC-9 has governed a trillion
                dollar lien market for fifty years: prevention comes from priority and from the habit
                of checking before lending, not from omniscience.
              </p>
            </div>

            <div className="relative flex flex-col justify-center overflow-hidden border border-line bg-surface p-9">
              <Coil className="absolute -right-24 -top-24 h-72 w-72 text-line-2" rings={16} />
              <div className="relative">
                <div className="text-[20px] font-semibold tracking-tight">check before you lend</div>
                <p className="mt-3 max-w-[38ch] text-[14px] leading-relaxed text-paper-2">
                  Read only, no wallet, no backend. Every number is an{" "}
                  <span className="font-mono text-[13px] text-paper">eth_call</span> you can repeat.
                </p>
                <Link
                  to="/register"
                  className="mt-7 inline-block rounded-sm bg-paper px-6 py-3 text-[14px] font-semibold text-ink transition-opacity hover:opacity-90"
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
              className="h-9 w-auto opacity-90"
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
