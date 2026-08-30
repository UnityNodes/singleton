import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Coil } from "@/components/Coil";
import { cn } from "@/lib/utils";
import { CFG, short } from "@/lib/registry";

const VIDEO = "/demo/singleton.mp4";
const RUNTIME = 113;

/**
 * Timecodes are read off frames of the recording in script/record-demo.mjs, not
 * off the plan in docs/DEMO.md. Re-record and every number here has to be
 * checked again, because a chapter that seeks a second early lands on the
 * previous screen and reads as broken.
 */
const CHAPTERS = [
  { at: 0, title: "one asset, one loan", line: "A borrower pledges a tokenised deed and takes a loan." },
  { at: 14, title: "and the same deed again", line: "An hour later, a second lender, no shared anything." },
  { at: 22, title: "why nobody notices", line: "An EVM contract cannot read another contract's logs." },
  { at: 31, title: "the register answers", line: "Deed 43 is claimed by Harbor, with one refusal on file." },
  { at: 47, title: "the refusal, on a public explorer", line: "A failed transaction decoding to AssetNotFree." },
  { at: 64, title: "what stood behind the record", line: "The attestor set the registry believed, kept with the lien." },
  { at: 87, title: "a lien ends more than one way", line: "The other asset, whose lien ran its whole life and closed." },
  { at: 98, title: "two protocols that never heard of us", line: "Real NFTfi and Blend loans read from Ethereum mainnet." },
  { at: 106, title: "what it does not claim", line: "A positive record and a priority rule, not proof of absence." },
];

const STACK = [
  "SOLIDITY 0.8.30",
  "FOUNDRY 1.7.1",
  "@GLUWA/USC-SDK 0.18.0",
  "CREDITCOIN CC3 102031",
  "REACT 19.2",
  "VITE 8.2",
];

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function Demo() {
  const video = useRef<HTMLVideoElement>(null);
  const [at, setAt] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const tick = () => setAt(el.currentTime);
    el.addEventListener("timeupdate", tick);
    return () => el.removeEventListener("timeupdate", tick);
  }, []);

  const seek = useCallback((seconds: number) => {
    const el = video.current;
    if (!el) return;
    el.currentTime = seconds;
    setStarted(true);
    void el.play();
  }, []);

  const active = CHAPTERS.reduce((found, c, i) => (at + 0.25 >= c.at ? i : found), 0);

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-line bg-ink/70 backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] max-w-[1240px] items-center gap-8 px-6">
          <Link to="/" className="h-8 shrink-0" aria-label="Singleton, home">
            <img src="/brand/singleton-wordmark-white.svg" alt="Singleton" className="wordmark" />
          </Link>
          <span className="label hidden items-center gap-2.5 md:flex">
            <span className="ping inline-block size-1.5 shrink-0 rounded-full bg-open text-open" />
            live on creditcoin cc3
          </span>
          <nav className="ml-auto flex items-center gap-6">
            <a
              className="label hidden transition-colors hover:text-paper sm:block"
              href="https://github.com/UnityNodes/singleton"
              target="_blank"
              rel="noreferrer"
            >
              source
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

      <section className="relative overflow-hidden">
        <Coil
          pulse
          className="absolute -right-[18%] -top-[30%] hidden h-[720px] w-[720px] text-line-2 lg:block"
          rings={22}
        />

        <div className="relative mx-auto max-w-[1240px] px-6 pb-16 pt-14">
          <h1 className="display max-w-[16ch] text-[clamp(34px,5vw,60px)]">
            Singleton, in under two minutes.
          </h1>

          <p className="mt-6 max-w-[62ch] text-[16px] leading-relaxed text-paper-2">
            Two lenders on Sepolia lend against one tokenised deed. The register witnesses both
            from the outside and refuses the second, and the refusal is a failed transaction on a
            public explorer that decodes to{" "}
            <span className="font-mono text-[14px] text-refused">AssetNotFree</span> with the asset
            key in it. Then the same registry reads live loans from NFTfi and Blur Blend on Ethereum
            mainnet, with nothing deployed there. No wallet is needed to follow any of it.
          </p>

          <div className="mt-7 flex flex-wrap gap-2">
            {STACK.map((chip) => (
              <span
                key={chip}
                className="border border-line px-2.5 py-1 font-mono text-[11px] text-paper-2"
              >
                {chip}
              </span>
            ))}
          </div>

          <div className="mt-10 grid gap-8 lg:grid-cols-[1.6fr_1fr]">
            <div>
              <div className="relative border border-line bg-ink">
                <video
                  ref={video}
                  className="block aspect-video w-full"
                  src={VIDEO}
                  poster="/demo/poster.jpg"
                  controls
                  preload="metadata"
                  playsInline
                  onPlay={() => setStarted(true)}
                />

                {!started && (
                  <>
                    <button
                      type="button"
                      aria-label="Play the demo"
                      onClick={() => seek(0)}
                      className="lit-paper absolute left-1/2 top-1/2 grid size-20 -translate-x-1/2 -translate-y-[calc(50%+22px)] place-items-center rounded-full bg-paper text-ink transition-transform hover:scale-105"
                    >
                      <svg viewBox="0 0 24 24" className="ml-1 size-7" fill="currentColor" aria-hidden>
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                    <span className="label absolute left-4 top-4 border border-line bg-ink/80 px-2.5 py-1 backdrop-blur">
                      {clock(RUNTIME)} &middot; voiced and captioned
                    </span>
                  </>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                <a className="label transition-colors hover:text-paper" href={VIDEO} download>
                  download the mp4
                </a>
                <Link to="/register" className="label transition-colors hover:text-paper">
                  open the register
                </Link>
                <a className="label transition-colors hover:text-paper" href="/singleton-deck.pdf">
                  the deck
                </a>
                <a className="label transition-colors hover:text-paper" href="/singleton-one-pager.pdf">
                  the one pager
                </a>
                <a
                  className="label hidden transition-colors hover:text-paper lg:inline"
                  href={`${CFG.explorer}/address/${CFG.registry}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  the registry, verified, {short(CFG.registry, 6, 4)}
                </a>
                <span className="label tabular ml-auto">
                  {clock(at)} / {clock(RUNTIME)}
                </span>
              </div>
            </div>

            <div className="border border-line">
              <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
                <span className="label">chapters</span>
                <span className="label tabular">
                  {CHAPTERS.length} &middot; {clock(RUNTIME)}
                </span>
              </div>
              <ol>
                {CHAPTERS.map((c, i) => (
                  <li key={c.at}>
                    <button
                      type="button"
                      onClick={() => seek(c.at)}
                      aria-current={i === active}
                      className={cn(
                        "grid w-full grid-cols-[46px_minmax(0,1fr)] gap-x-3 border-b border-line px-4 py-3 text-left transition-colors last:border-b-0",
                        i === active ? "bg-raised" : "hover:bg-surface/70",
                      )}
                    >
                      <span
                        className={cn(
                          "label tabular pt-0.5",
                          i === active && "text-paper",
                        )}
                      >
                        {clock(c.at)}
                      </span>
                      <span>
                        <span
                          className={cn(
                            "block text-[13.5px] tracking-tight",
                            i === active ? "font-medium text-paper" : "text-paper-2",
                          )}
                        >
                          {c.title}
                        </span>
                        <span className="mt-0.5 block text-[12.5px] leading-snug text-paper-3">
                          {c.line}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto max-w-[1240px] px-6 py-14">
          <h2 className="display max-w-[22ch] text-[clamp(24px,3vw,34px)]">
            three doors into the running thing.
          </h2>

          <div className="mt-8 grid gap-px bg-line md:grid-cols-3">
            {[
              {
                k: "check an asset yourself",
                v: "Paste any collateral contract and token id. Every number on the page is an eth_call against one Creditcoin node.",
                to: "/register",
              },
              {
                k: "read the refusal",
                v: "The failed transaction from the video, on Blockscout, decoding to AssetNotFree with the asset key and the incumbent lender.",
                href: `${CFG.explorer}/tx/0x9f3c0067f084e0fb5a512d2ba6f8cc8c2e41c6ba371f7ae836c984a72e73297b`,
              },
              {
                k: "read the contracts",
                v: "The registry, the adapters, 93 tests, and the caveats written before anybody had to ask for them.",
                href: "https://github.com/UnityNodes/singleton",
              },
            ].map((door) => {
              const body = (
                <>
                  <div className="font-mono text-[13px] text-paper">{door.k}</div>
                  <p className="mt-2.5 text-[13.5px] leading-relaxed text-paper-2">{door.v}</p>
                  <span className="mt-4 inline-block text-[13px] text-paper transition-transform group-hover:translate-x-1">
                    &rarr;
                  </span>
                </>
              );
              return door.to ? (
                <Link
                  key={door.k}
                  to={door.to}
                  className="group bg-ink p-6 transition-colors hover:bg-surface"
                >
                  {body}
                </Link>
              ) : (
                <a
                  key={door.k}
                  href={door.href}
                  target="_blank"
                  rel="noreferrer"
                  className="group bg-ink p-6 transition-colors hover:bg-surface"
                >
                  {body}
                </a>
              );
            })}
          </div>

          <footer className="mt-14 flex flex-wrap items-center gap-x-10 gap-y-5 border-t border-line pt-8">
            <img
              src="/brand/singleton-wordmark-white.svg"
              alt="Singleton"
              className="h-9 w-auto opacity-90"
            />
            <span className="label">buidl ctc 2026, on the attestcoin protocol</span>
            <Link to="/" className="label ml-auto transition-colors hover:text-paper">
              back to the front &rarr;
            </Link>
          </footer>
        </div>
      </section>
    </div>
  );
}
