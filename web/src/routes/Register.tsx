import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Coil } from "@/components/Coil";
import { ArrowRight, Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CFG,
  GENESIS,
  COLLATERAL,
  ENTRY_WORDS,
  KNOWN_ASSETS,
  PROTOCOLS,
  SOURCES,
  TOPIC,
  ZERO,
  ago,
  assetKeyOf,
  amount,
  ctc,
  nameOf,
  num,
  readAsset,
  readChains,
  readLogs,
  readState,
  short,
  srcUrl,
  txUrl,
  type AssetState,
  type ChainFacts,
  type Record_,
  type RegistryLog,
} from "@/lib/registry";

interface RailAsset {
  chainId: number;
  token: string;
  tokenId: string;
  assetKey: string;
  state: AssetState;
  holder: string | null;
  collisions: number;
  when: string;
}

const label = (token: string, tokenId: string) =>
  `${nameOf(COLLATERAL, token) ?? short(token, 6, 4)} #${tokenId}`;

function CopyKey({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy asset key"
      className="rounded p-1 text-paper-2 transition-colors hover:bg-raised hover:text-paper"
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

function StateChip({ state }: { state: AssetState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2.5 whitespace-nowrap border px-4 py-2 font-mono text-[13px]",
        state === "pledged" && "border-live/50 bg-live-dim/25 text-live lit-live",
        state === "settled" && "border-live/40 bg-live-dim/15 text-live lit-live",
        state === "free" && "border-open/50 bg-open-dim/25 text-open lit-open",
      )}
    >
      <span
        className={cn(
          "ping size-2 rounded-full",
          state === "free" ? "bg-open text-open" : "bg-live text-live",
        )}
      />
      {state === "free" ? "free to lend against" : state === "pledged" ? "claimed, first to file" : "settled, still on file"}
    </span>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="bg-ink/60 p-4 shadow-[0_0_0_1px_var(--color-line)] backdrop-blur-sm transition-shadow hover:shadow-[0_0_0_1px_var(--color-line-2)]">
      <dt className="label">{term}</dt>
      <dd className="mt-0.5 text-[13.5px] break-words">{children}</dd>
    </div>
  );
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-line p-4 transition-colors hover:border-line-2 hover:bg-surface/60">
      <div className="label">{title}</div>
      <div className="mt-1 text-[13px]">{children}</div>
    </div>
  );
}

export default function Register() {
  const [chains, setChains] = useState<Record<number, ChainFacts>>({});
  const [rail, setRail] = useState<RailAsset[] | null>(null);
  const [record, setRecord] = useState<Record_ | null>(null);
  const [logs, setLogs] = useState<RegistryLog[]>([]);
  const [swept, setSwept] = useState<
    { from: number; head: number; missed: number } | "reading" | "unreadable"
  >("reading");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pane, setPane] = useState<"register" | "record">("record");

  const [form, setForm] = useState({ chainId: "11155111", token: "", tokenId: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const select = useCallback(
    async (chainId: number, token: string, tokenId: string, facts = chains) => {
      const chain = facts[chainId];
      if (!chain) return;
      setLoading(true);
      setError(null);
      setPane("record");
      setForm({ chainId: String(chainId), token, tokenId });
      setLogs([]);
      setSwept("reading");
      let next;
      try {
        next = await readAsset(chain, chainId, token, tokenId);
        setRecord(next);
      } catch (e) {
        setError((e as Error).message);
        setRecord(null);
        return;
      } finally {
        setLoading(false);
      }
      /*
        The state of the asset is four eth_calls and the history behind it is a
        sweep of the register's whole life, which is an order of magnitude
        slower. Holding the answer back until the trail is assembled would put
        the reader in front of a spinner for the part they came for.
      */
      try {
        const { logs: found, from, head, missed } = await readLogs([null, next.assetKey]);
        setLogs(found);
        setSwept({ from, head, missed });
      } catch {
        setSwept("unreadable");
      }
    },
    [chains],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const facts = await readChains();
        if (cancelled) return;
        setChains(facts);

        const assets = await Promise.all(
          KNOWN_ASSETS.filter((a) => facts[a.chainId]).map(async (a) => {
            const key = await assetKeyOf(facts[a.chainId].chainKey, a.token, a.tokenId);
            const s = await readState(key);
            return {
              ...a,
              assetKey: key,
              state: s.state,
              collisions: s.collisions,
              holder:
                s.state === "free" ? null : (nameOf(PROTOCOLS, s.emitter) ?? short(s.emitter, 6, 4)),
              when: s.state === "free" ? "released" : ago(s.recordedAt),
            } as RailAsset;
          }),
        );
        if (cancelled) return;
        setRail(assets);

        const first =
          assets.find((a) => a.state !== "free" && a.collisions > 0) ??
          assets.find((a) => a.state !== "free") ??
          assets[0];
        if (first) await select(first.chainId, first.token, first.tokenId, facts);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // select is stable enough here: it only reads chains, which this effect sets
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const opening = useMemo(() => logs.find((l) => TOPIC[l.topics[0]] === "pledge"), [logs]);
  const closing = useMemo(
    () => logs.find((l) => ["released", "settled"].includes(TOPIC[l.topics[0]])),
    [logs],
  );
  const refusal = useMemo(() => logs.find((l) => TOPIC[l.topics[0]] === "refused"), [logs]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^0x[0-9a-fA-F]{40}$/.test(form.token)) return setFormError("That is not a contract address");
    if (!/^\d+$/.test(form.tokenId)) return setFormError("Token id must be a number");
    setFormError(null);
    select(Number(form.chainId), form.token, form.tokenId);
  };

  const chain = record ? chains[record.chainId] : undefined;
  const source = record ? SOURCES[record.chainId] : undefined;

  return (
    <div className="grid h-full grid-rows-[auto_auto_1fr] md:grid-cols-[340px_1fr] md:grid-rows-[auto_1fr] md:overflow-hidden">
      {/* -------------------------------------------------------- top bar */}
      <header className="flex h-[68px] items-center gap-5 border-b border-line bg-surface/70 px-4 backdrop-blur-xl md:col-span-2">
        <Link to="/" className="flex h-7 items-center gap-3.5" aria-label="Singleton, home">
          <img src="/brand/singleton-wordmark-white.svg" alt="Singleton" className="wordmark" />
          <span className="hidden text-[13px] font-normal text-paper-2 sm:inline">
            register of liens
          </span>
        </Link>

        <div className="ml-auto hidden items-center gap-5 text-[12.5px] text-paper-2 lg:flex">
          {Object.entries(chains).map(([chainId, facts]) => (
            <span
              key={chainId}
              className="flex items-center gap-2"
              title={`Creditcoin has attested ${SOURCES[Number(chainId)].name} to this block. ${facts.attestors} attestors are bonded for it right now, which is the number a record filed now would carry. A pledge is accepted once it is ${facts.depth} blocks deep, and only while at least ${facts.floor} are bonded.`}
            >
              <span
                className={`ping inline-block size-1.5 shrink-0 rounded-full ${
                  facts.attestors >= facts.floor
                    ? "bg-settled text-settled"
                    : "bg-refused text-refused"
                }`}
              />
              {SOURCES[Number(chainId)].name} attested to{" "}
              <b className="tabular font-medium text-paper">{num(facts.tip)}</b>
              <span className="text-paper-3">
                by <b className="tabular font-medium text-paper-2">{facts.attestors}</b>
              </span>
            </span>
          ))}
        </div>

        <Link className="label ml-auto transition-colors hover:text-paper lg:ml-0" to="/demo">
          demo
        </Link>

        <a
          className="font-mono text-[12.5px] text-paper hover:underline"
          href={`${CFG.explorer}/address/${CFG.registry}`}
          target="_blank"
          rel="noreferrer"
        >
          {short(CFG.registry, 6, 4)}
        </a>
      </header>

      {/* ---------------------------------------------------- mobile tabs */}
      <nav className="grid grid-cols-2 border-b border-line bg-surface/70 backdrop-blur-xl md:hidden">
        {(["register", "record"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPane(p)}
            className={cn(
              "border-b-2 py-2.5 text-[13px] capitalize transition-colors",
              pane === p ? "border-paper text-paper" : "border-transparent text-paper-2",
            )}
          >
            {p}
          </button>
        ))}
      </nav>

      {/* ------------------------------------------------------------ rail */}
      <aside
        className={cn(
          "grid min-h-0 grid-rows-[auto_auto_1fr] border-line bg-surface/70 backdrop-blur-xl md:border-r",
          pane === "record" && "hidden md:grid",
        )}
      >
        <form onSubmit={submit} className="grid gap-2 border-b border-line p-3.5" autoComplete="off">
          <label className="label" htmlFor="token">
            look up an asset
          </label>
          <input
            id="token"
            value={form.token}
            onChange={(e) => setForm({ ...form, token: e.target.value })}
            placeholder="collateral contract 0x..."
            spellCheck={false}
            className="w-full rounded-none border border-line-2 bg-ink px-2.5 py-1.5 font-mono text-[12.5px] transition-colors placeholder:text-paper-2 hover:border-line-2 focus:border-paper focus:outline-none focus:ring-3 focus:ring-line-2"
          />
          <div className="grid grid-cols-[1fr_92px] gap-2">
            <select
              aria-label="Source chain"
              value={form.chainId}
              onChange={(e) => setForm({ ...form, chainId: e.target.value })}
              className="w-full rounded-none border border-line-2 bg-ink px-2.5 py-1.5 text-[13px] transition-colors hover:border-line-2 focus:border-paper focus:outline-none"
            >
              {Object.keys(chains).map((id) => (
                <option key={id} value={id}>
                  {SOURCES[Number(id)].name}
                </option>
              ))}
            </select>
            <input
              aria-label="Token id"
              value={form.tokenId}
              onChange={(e) => setForm({ ...form, tokenId: e.target.value })}
              placeholder="token id"
              spellCheck={false}
              className="w-full rounded-none border border-line-2 bg-ink px-2.5 py-1.5 font-mono text-[12.5px] transition-colors placeholder:text-paper-2 hover:border-line-2 focus:border-paper focus:outline-none focus:ring-3 focus:ring-line-2"
            />
          </div>
          <button
            type="submit"
            className="sheen rounded-none bg-paper px-3.5 py-1.5 text-[13px] font-medium text-ink transition-shadow hover:[box-shadow:0_0_26px_-8px_color-mix(in_oklch,var(--color-paper)_65%,transparent)]"
          >
            check the register
          </button>
          {formError && <p className="text-[12.5px] text-refused">{formError}</p>}
        </form>

        <div className="flex items-baseline justify-between border-b border-line px-3.5 pb-2.5 pt-3">
          <span className="label">assets this page tracks</span>
          <span className="label">{rail ? `${rail.length}` : ""}</span>
        </div>

        <div className="min-h-0 overflow-auto px-2 pb-3">
          {!rail &&
            [0, 1, 2].map((i) => (
              <div key={i} className="px-2.5 py-3">
                <div className="skeleton h-3 w-3/4 rounded" />
              </div>
            ))}

          {rail?.map((a) => (
            <button
              key={a.assetKey}
              onClick={() => select(a.chainId, a.token, a.tokenId)}
              aria-current={record?.assetKey === a.assetKey}
              className={cn(
                "relative grid w-full grid-cols-[8px_1fr_auto] items-center gap-2.5 px-2.5 py-2.5 text-left transition-colors",
                record?.assetKey === a.assetKey ? "bg-raised" : "hover:bg-raised/60",
              )}
            >
              <span
                className={cn(
                  "absolute inset-y-0 left-0 w-px transition-colors",
                  record?.assetKey !== a.assetKey
                    ? "bg-transparent"
                    : a.state === "free"
                      ? "bg-open"
                      : "bg-live",
                )}
              />
              <span
                className={cn(
                  "size-2 rounded-full",
                  a.state === "free" ? "bg-open text-open" : "bg-live text-live",
                  record?.assetKey === a.assetKey && "ping",
                )}
              />
              <span>
                <span
                  className={cn(
                    "block text-[13px]",
                    record?.assetKey === a.assetKey && "font-medium text-paper",
                  )}
                >
                  {label(a.token, a.tokenId)}
                </span>
                <span className="block font-mono text-[11.5px]">
                  <span className={a.state === "free" ? "text-open" : "text-live"}>
                    {a.state === "free" ? "free" : (a.holder ?? "claimed")}
                  </span>
                  {a.collisions > 0 && <span className="text-refused"> · {a.collisions} refused</span>}
                </span>
              </span>
              <span className="text-right text-[11.5px] text-paper-2">{a.when}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* ---------------------------------------------------------- record */}
      <main className={cn("min-h-0 overflow-auto", pane === "register" && "hidden md:block")}>
        {rail && (
          <div className="grid grid-cols-3 border-b border-line">
            {[
              { k: "assets tracked here", v: String(rail.length), tone: "", glow: false },
              {
                k: "of those, claimed",
                v: String(rail.filter((a) => a.state !== "free").length),
                tone: "text-live",
                glow: rail.some((a) => a.state !== "free"),
              },
              {
                k: "refusals on their file",
                v: String(rail.reduce((n, a) => n + a.collisions, 0)),
                tone: "text-refused",
                glow: rail.some((a) => a.collisions > 0),
              },
            ].map((cell, i) => (
              <div
                key={cell.k}
                className="rise border-r border-line px-6 py-3 last:border-r-0"
                style={{ "--d": `${i * 0.08}s` } as React.CSSProperties}
              >
                <div className="label">{cell.k}</div>
                <div
                  className={cn(
                    "mt-0.5 font-mono text-[17px] tabular",
                    cell.tone,
                    cell.glow && "[text-shadow:0_0_20px_currentColor]",
                  )}
                >
                  {cell.v}
                </div>
              </div>
            ))}
          </div>
        )}
        {error && (
          <div className="max-w-[60ch] p-10 text-paper-2">
            <h2 className="mb-2 text-[15px] font-medium text-paper">The register did not answer</h2>
            <p className="text-[13.5px]">{error}</p>
            <p className="mt-2.5 text-[13.5px]">
              This page reads one Creditcoin node directly. If it is unreachable nothing can be
              shown, which is the honest failure for a tool with no backend.
            </p>
          </div>
        )}

        {!error && loading && (
          <div className="max-w-[1100px] p-6">
            <div className="skeleton h-5 w-56 rounded" />
            <div className="skeleton mt-3 h-3 w-80 rounded" />
            <div className="mt-7 grid gap-2.5">
              <div className="skeleton h-14 rounded" />
              <div className="skeleton h-14 rounded" />
            </div>
          </div>
        )}

        {!error && !loading && record && chain && source && (
          <div key={record.assetKey} className="rise relative max-w-[1100px] px-6 pb-10 pt-6">
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute -top-40 right-0 h-[440px] w-[640px] rounded-full blur-3xl",
                record.state === "free" ? "bg-open/12" : "bg-live/12",
              )}
            />
            <Coil
              pulse
              className={cn(
                "pointer-events-none absolute -right-40 -top-24 hidden h-[460px] w-[460px] xl:block",
                record.state === "free" ? "text-open/35" : "text-live/30",
              )}
              rings={18}
            />
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex-1 basis-80">
                <h1 className="display text-[clamp(26px,3vw,34px)]">
                  {label(record.token, record.tokenId)}
                </h1>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-paper-2">
                  <a
                    className="font-mono text-paper hover:underline"
                    href={srcUrl(record.chainId, `token/${record.token}`)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(record.token, 10, 8)}
                  </a>
                  on {source.name}
                  <span className="text-line-2">/</span>
                  <span className="font-mono" title={record.assetKey}>
                    key {short(record.assetKey, 8, 6)}
                  </span>
                  <CopyKey value={record.assetKey} />
                </p>
              </div>
              <StateChip state={record.state} />
            </div>

            <dl className="mt-6 grid gap-px [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
              {record.state === "free" ? (
                <>
                  <Fact term="standing">
                    {logs.length ? "registered before, released since" : "never registered here"}
                  </Fact>
                  <Fact term="source chain">
                    {source.name}, chain key {chain.chainKey}
                  </Fact>
                  <Fact term="collateral">
                    <a
                      className="font-mono text-paper hover:underline"
                      href={srcUrl(record.chainId, `token/${record.token}`)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {short(record.token, 10, 6)}
                    </a>
                  </Fact>
                </>
              ) : (
                <>
                  <Fact term="lien held by">
                    {nameOf(PROTOCOLS, record.emitter) ?? ""}{" "}
                    <a
                      className="font-mono text-paper hover:underline"
                      href={srcUrl(record.chainId, `address/${record.emitter}`)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {short(record.emitter, 8, 6)}
                    </a>
                  </Fact>
                  <Fact term="borrower">
                    <a
                      className="font-mono text-paper hover:underline"
                      href={srcUrl(record.chainId, `address/${record.borrower}`)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {short(record.borrower, 8, 6)}
                    </a>
                  </Fact>
                  <Fact term="principal">
                    <span className="tabular">{amount(record.amount)}</span>{" "}
                    <span className="text-paper-2">as the protocol wrote it, no decimals assumed</span>
                  </Fact>
                  <Fact term="lien instance">
                    <span className="font-mono">{short(record.instanceId, 10, 6)}</span>
                  </Fact>
                  <Fact term="certificate">
                    {record.certificate === ZERO ? "none" : "soulbound, held by the lender"}
                  </Fact>
                  <Fact term="recorded">
                    {new Date(record.recordedAt * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC
                  </Fact>
                </>
              )}
            </dl>

            {record.collisions.length > 0 && (
              <div className="lit-refused mt-6 border border-refused/40 bg-refused-dim/25 p-4">
                <h2 className="font-mono text-[13px] text-refused">
                  a second protocol tried to lend against this asset
                </h2>
                <p className="mt-1 max-w-[70ch] text-[13px]">
                  The first filing holds. The second was refused on chain and kept on file, because a
                  lender checking here wants to know that somebody already tried, not only that the
                  asset is taken.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2.5 text-[13px]">
                  <span className="border border-line bg-ink px-2.5 py-1.5">
                    <b className="font-medium">
                      {nameOf(PROTOCOLS, record.collisions.at(-1)!.emitter) ??
                        short(record.collisions.at(-1)!.emitter, 8, 6)}
                    </b>{" "}
                    tried to lend {amount(record.collisions.at(-1)!.amount)}, proven from {source.name}{" "}
                    block <span className="tabular">{num(record.collisions.at(-1)!.sourceHeight)}</span>
                  </span>
                  {refusal && (
                    <span className="text-paper-2">
                      refusal on chain in{" "}
                      <a
                        className="font-mono text-paper hover:underline"
                        href={txUrl(refusal.transactionHash)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {short(refusal.transactionHash, 8, 6)}
                      </a>
                    </span>
                  )}
                </div>
              </div>
            )}

            {record.state === "free" && (
              <div className="lit-open mt-6 border border-open/35 bg-open-dim/15 p-5">
                <div className="font-mono text-[13px] text-open">nothing on file against this asset</div>
                <p className="mt-2 max-w-[76ch] text-[13.5px] leading-relaxed text-paper-2">
                  No allowlisted protocol has a lien recorded here.{" "}
                  {logs.length > 0
                    ? "It carried one before and the lender released it, which is the history below."
                    : "No entry for it in the blocks this page swept."}{" "}
                  That is a positive record and a priority rule, not proof of absence: Attestcoin
                  proves that a transaction happened, never that one did not. This page answers
                  about a key, not about an asset, so it reads the same for a token that is
                  unencumbered and for one that was never minted.</p>
                <p className="mt-2 max-w-[76ch] text-[13.5px] leading-relaxed text-paper-2">
                  Checking that the asset exists is one call to its own contract on its own chain,
                  and deliberately not made here: every number on this page is an eth_call against
                  one Creditcoin node, which is the property that makes it repeatable.
                </p>
              </div>
            )}

            <div className="mt-8 flex items-center gap-4">
              <span className="label shrink-0">how this is known</span>
              <div className="h-px flex-1 bg-line" />
              <span className="label shrink-0">nobody was trusted for any step</span>
            </div>
            <div className="mt-3 grid items-stretch gap-2.5 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:gap-0">
              <Step title="the protocol's own log">
                {record.state !== "free" ? (
                  <>
                    {source.name} block{" "}
                    <a
                      className="tabular text-paper hover:underline"
                      href={srcUrl(record.chainId, `block/${record.sourceHeight}`)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {num(record.sourceHeight)}
                    </a>
                  </>
                ) : opening ? (
                  `a lien on ${source.name}, since closed`
                ) : (
                  "nothing on file"
                )}
              </Step>
              <div className="hidden place-items-center px-3 text-line-2 lg:grid">
                <ArrowRight size={16} className="breathe" />
              </div>
              <Step title="inclusion proof">
                re-checked on chain by BlockProver <span className="font-mono">{CFG.prover}</span>,
                accepted at {chain.depth} blocks deep
                {opening && record.security.attestors > 0 && (
                  <>
                    , with{" "}
                    <b className="tabular font-medium text-paper">{record.security.attestors}</b>{" "}
                    attestors bonded {ctc(record.security.minBond)} each on this chain when the
                    record was filed
                  </>
                )}
              </Step>
              <div className="hidden place-items-center px-3 text-line-2 lg:grid">
                <ArrowRight size={16} className="breathe" />
              </div>
              <Step title="the register">
                {opening ? (
                  <>
                    written in{" "}
                    <a
                      className="font-mono text-paper hover:underline"
                      href={txUrl(opening.transactionHash)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {short(opening.transactionHash, 8, 6)}
                    </a>
                    {record.state === "free" && closing && (
                      <>
                        , closed in{" "}
                        <a
                          className="font-mono text-paper hover:underline"
                          href={txUrl(closing.transactionHash)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {short(closing.transactionHash, 8, 6)}
                        </a>
                      </>
                    )}
                  </>
                ) : (
                  "nothing written"
                )}
              </Step>
            </div>

            <div className="mt-8 flex items-center gap-4">
              <span className="label shrink-0">history</span>
              <div className="h-px flex-1 bg-line" />
              <span className="label shrink-0">
                {swept === "reading"
                  ? "reading"
                  : `${logs.length} ${logs.length === 1 ? "entry" : "entries"}`}
              </span>
            </div>

            {typeof swept === "object" && (
              <p className="mt-2 text-[12px] text-paper-2">
                Swept blocks {swept.from.toLocaleString()} to {swept.head.toLocaleString()}
                {GENESIS
                  ? ", the whole life of this register"
                  : ", a lookback rather than the whole register, because this address was named in the URL"}
                {swept.missed > 0 &&
                  `. ${swept.missed} ${swept.missed === 1 ? "window" : "windows"} went unanswered by the public node, so this table may be short`}
                .
              </p>
            )}

            {logs.length ? (
              <table className="mt-3 w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    {["entry", "what happened", "protocol", "on creditcoin"].map((h) => (
                      <th
                        key={h}
                        className="label border-b border-line pb-2 pr-3 text-left"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => {
                    const kind = TOPIC[l.topics[0]];
                    const party = "0x" + (kind === "refused" ? l.topics[3] : l.topics[2]).slice(26);
                    return (
                      <tr key={l.transactionHash + l.logIndex} className="transition-colors hover:bg-raised/50">
                        <td className="border-b border-surface py-2 pr-3">
                          <span
                            className={cn(
                              "inline-block px-2 py-0.5 font-mono text-[11px]",
                              kind === "pledge" && "bg-raised text-paper",
                              kind === "refused" && "bg-refused-dim/30 text-refused",
                              kind === "settled" && "bg-settled/10 text-settled",
                              kind === "released" && "bg-raised text-paper-2",
                            )}
                          >
                            {kind}
                          </span>
                        </td>
                        <td className="border-b border-surface py-2 pr-3">{ENTRY_WORDS[kind]}</td>
                        <td className="border-b border-surface py-2 pr-3">
                          {nameOf(PROTOCOLS, party) ?? (
                            <span className="font-mono">{short(party, 6, 4)}</span>
                          )}
                        </td>
                        <td className="border-b border-surface py-2 pr-3">
                          <a
                            className="font-mono text-paper hover:underline"
                            href={txUrl(l.transactionHash)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {short(l.transactionHash, 8, 6)}
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : swept === "reading" ? (
              <p className="mt-1 max-w-[70ch] text-[13px] text-paper-2">
                Sweeping the register for this asset. The state above is already read; this is the
                trail of proofs behind it.
              </p>
            ) : swept === "unreadable" ? (
              <p className="mt-1 max-w-[70ch] text-[13px] text-paper-2">
                The public node would not answer the log queries behind this table. That says nothing
                about the record above, which is a direct call and is already read.
              </p>
            ) : (
              <p className="mt-1 max-w-[70ch] text-[13px] text-paper-2">
                No entry for this asset in the blocks this page swept, which is not the same as never
                registered, and neither is the same as never pledged. The register is a positive
                record, and Attestcoin cannot prove that something did not happen.
              </p>
            )}

            <p className="mt-7 max-w-[72ch] border-t border-line pt-3.5 text-[12.5px] text-paper-2">
              Everything above is an <span className="font-mono">eth_call</span> against Creditcoin
              that anybody can repeat. There is no backend and no indexer between this page and the
              chain.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
