import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CFG,
  COLLATERAL,
  ENTRY_WORDS,
  KNOWN_ASSETS,
  PROTOCOLS,
  SOURCES,
  TOPIC,
  ZERO,
  ago,
  assetKeyOf,
  ether,
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
      className="rounded p-1 text-ink-2 transition-colors hover:bg-accent-wash hover:text-accent"
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
        "inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 text-[12.5px] font-medium",
        state === "pledged" && "border-accent bg-accent-wash text-accent",
        state === "settled" && "border-good/45 bg-good/10 text-good",
        state === "free" && "border-line-strong bg-panel-2 text-ink-2",
      )}
    >
      <span
        className={cn(
          "size-2 rounded-[2px]",
          state === "pledged" && "bg-accent",
          state === "settled" && "bg-good",
          state === "free" && "bg-line-strong",
        )}
      />
      {state}
      {state === "pledged" && ", first to file"}
    </span>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[2px] p-3.5 shadow-[0_0_0_1px_var(--color-line)]">
      <dt className="text-[12px] text-ink-2">{term}</dt>
      <dd className="mt-0.5 text-[13.5px] break-words">{children}</dd>
    </div>
  );
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line p-3.5">
      <div className="text-[12px] text-ink-2">{title}</div>
      <div className="mt-1 text-[13px]">{children}</div>
    </div>
  );
}

export default function Register() {
  const [chains, setChains] = useState<Record<number, ChainFacts>>({});
  const [rail, setRail] = useState<RailAsset[] | null>(null);
  const [record, setRecord] = useState<Record_ | null>(null);
  const [logs, setLogs] = useState<RegistryLog[]>([]);
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
      try {
        const next = await readAsset(chain, chainId, token, tokenId);
        setRecord(next);
        const { logs: found } = await readLogs([null, next.assetKey]);
        setLogs(found);
      } catch (e) {
        setError((e as Error).message);
        setRecord(null);
      } finally {
        setLoading(false);
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
      <header className="flex h-13 items-center gap-4 border-b border-line bg-panel px-4 md:col-span-2">
        <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <svg width="17" height="17" viewBox="0 0 32 32" aria-hidden>
            <rect x="2" y="2" width="28" height="28" rx="6" fill="oklch(0.48 0.15 290)" />
            <rect x="10" y="10" width="12" height="12" rx="2" fill="none" stroke="#fff" strokeWidth="2.4" />
          </svg>
          Singleton
          <span className="hidden font-normal text-ink-2 sm:inline">register of liens</span>
        </Link>

        <div className="ml-auto hidden items-center gap-5 text-[12.5px] text-ink-2 lg:flex">
          {Object.entries(chains).map(([chainId, facts]) => (
            <span
              key={chainId}
              className="flex items-center gap-2"
              title={`Creditcoin has attested ${SOURCES[Number(chainId)].name} to this block. A pledge is accepted once it is ${facts.depth} blocks deep.`}
            >
              <span className="size-1.5 rounded-full bg-good" />
              {SOURCES[Number(chainId)].name} attested to{" "}
              <b className="tabular font-medium text-ink">{num(facts.tip)}</b>
            </span>
          ))}
        </div>

        <a
          className="ml-auto font-mono text-[12.5px] text-accent hover:underline lg:ml-0"
          href={`${CFG.explorer}/address/${CFG.registry}`}
          target="_blank"
          rel="noreferrer"
        >
          {short(CFG.registry, 6, 4)}
        </a>
      </header>

      {/* ---------------------------------------------------- mobile tabs */}
      <nav className="grid grid-cols-2 border-b border-line bg-panel md:hidden">
        {(["register", "record"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPane(p)}
            className={cn(
              "border-b-2 py-2.5 text-[13px] capitalize transition-colors",
              pane === p ? "border-accent text-accent" : "border-transparent text-ink-2",
            )}
          >
            {p}
          </button>
        ))}
      </nav>

      {/* ------------------------------------------------------------ rail */}
      <aside
        className={cn(
          "grid min-h-0 grid-rows-[auto_auto_1fr] border-line bg-panel md:border-r",
          pane === "record" && "hidden md:grid",
        )}
      >
        <form onSubmit={submit} className="grid gap-2 border-b border-line p-3.5" autoComplete="off">
          <label className="text-[12px] text-ink-2" htmlFor="token">
            Look up an asset
          </label>
          <input
            id="token"
            value={form.token}
            onChange={(e) => setForm({ ...form, token: e.target.value })}
            placeholder="collateral contract 0x..."
            spellCheck={false}
            className="w-full rounded-md border border-line-strong bg-white px-2.5 py-1.5 font-mono text-[12.5px] transition-colors placeholder:text-ink-2 hover:border-ink-2 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-wash"
          />
          <div className="grid grid-cols-[1fr_92px] gap-2">
            <select
              aria-label="Source chain"
              value={form.chainId}
              onChange={(e) => setForm({ ...form, chainId: e.target.value })}
              className="w-full rounded-md border border-line-strong bg-white px-2.5 py-1.5 text-[13px] transition-colors hover:border-ink-2 focus:border-accent focus:outline-none"
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
              className="w-full rounded-md border border-line-strong bg-white px-2.5 py-1.5 font-mono text-[12.5px] transition-colors placeholder:text-ink-2 hover:border-ink-2 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-wash"
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Check the register
          </button>
          {formError && <p className="text-[12.5px] text-danger">{formError}</p>}
        </form>

        <div className="flex items-baseline justify-between px-3.5 pb-2 pt-3 text-[12.5px] text-ink-2">
          <span>On file</span>
          <span>{rail ? `${rail.length} assets` : ""}</span>
        </div>

        <div className="min-h-0 overflow-auto px-2 pb-3">
          {!rail &&
            [0, 1, 2].map((i) => (
              <div key={i} className="px-2.5 py-3">
                <div className="h-3 w-3/4 animate-pulse rounded bg-panel-2" />
              </div>
            ))}

          {rail?.map((a) => (
            <button
              key={a.assetKey}
              onClick={() => select(a.chainId, a.token, a.tokenId)}
              aria-current={record?.assetKey === a.assetKey}
              className={cn(
                "grid w-full grid-cols-[8px_1fr_auto] items-center gap-2.5 rounded-md px-2.5 py-2.5 text-left transition-colors",
                record?.assetKey === a.assetKey ? "bg-accent-wash" : "hover:bg-panel-2",
              )}
            >
              <span
                className={cn(
                  "size-2 rounded-[2px]",
                  a.state === "pledged" && "bg-accent",
                  a.state === "settled" && "bg-good",
                  a.state === "free" && "bg-line-strong",
                )}
              />
              <span>
                <span
                  className={cn(
                    "block text-[13px]",
                    record?.assetKey === a.assetKey && "font-medium text-accent",
                  )}
                >
                  {label(a.token, a.tokenId)}
                </span>
                <span className="block text-[12px] text-ink-2">
                  {a.holder ?? "no lien on file"}
                  {a.collisions > 0 && ` · ${a.collisions} refused`}
                </span>
              </span>
              <span className="text-right text-[11.5px] text-ink-2">{a.when}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* ---------------------------------------------------------- record */}
      <main className={cn("min-h-0 overflow-auto", pane === "register" && "hidden md:block")}>
        {error && (
          <div className="max-w-[60ch] p-10 text-ink-2">
            <h2 className="mb-2 text-[15px] font-medium text-ink">The register did not answer</h2>
            <p className="text-[13.5px]">{error}</p>
            <p className="mt-2.5 text-[13.5px]">
              This page reads one Creditcoin node directly. If it is unreachable nothing can be
              shown, which is the honest failure for a tool with no backend.
            </p>
          </div>
        )}

        {!error && loading && (
          <div className="max-w-[1100px] p-6">
            <div className="h-5 w-56 animate-pulse rounded bg-panel-2" />
            <div className="mt-3 h-3 w-80 animate-pulse rounded bg-panel-2" />
            <div className="mt-7 grid gap-2.5">
              <div className="h-14 animate-pulse rounded bg-panel-2" />
              <div className="h-14 animate-pulse rounded bg-panel-2" />
            </div>
          </div>
        )}

        {!error && !loading && record && chain && source && (
          <div className="max-w-[1100px] px-6 pb-10 pt-5">
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex-1 basis-80">
                <h1 className="text-xl font-semibold tracking-tight">
                  {label(record.token, record.tokenId)}
                </h1>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                  <a
                    className="font-mono text-accent hover:underline"
                    href={srcUrl(record.chainId, `token/${record.token}`)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(record.token, 10, 8)}
                  </a>
                  on {source.name}
                  <span className="text-line-strong">/</span>
                  <span className="font-mono" title={record.assetKey}>
                    key {short(record.assetKey, 8, 6)}
                  </span>
                  <CopyKey value={record.assetKey} />
                </p>
              </div>
              <StateChip state={record.state} />
            </div>

            <dl className="mt-5 grid gap-px [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
              {record.state === "free" ? (
                <>
                  <Fact term="Standing">
                    {logs.length ? "Registered before, released since" : "Never registered here"}
                  </Fact>
                  <Fact term="Source chain">
                    {source.name}, chain key {chain.chainKey}
                  </Fact>
                  <Fact term="Collateral">
                    <a
                      className="font-mono text-accent hover:underline"
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
                  <Fact term="Lien held by">
                    {nameOf(PROTOCOLS, record.emitter) ?? ""}{" "}
                    <a
                      className="font-mono text-accent hover:underline"
                      href={srcUrl(record.chainId, `address/${record.emitter}`)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {short(record.emitter, 8, 6)}
                    </a>
                  </Fact>
                  <Fact term="Borrower">
                    <a
                      className="font-mono text-accent hover:underline"
                      href={srcUrl(record.chainId, `address/${record.borrower}`)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {short(record.borrower, 8, 6)}
                    </a>
                  </Fact>
                  <Fact term="Principal">
                    <span className="tabular">{ether(record.amount)}</span>{" "}
                    <span className="text-ink-2">in the protocol's own unit</span>
                  </Fact>
                  <Fact term="Lien instance">
                    <span className="font-mono">{short(record.instanceId, 10, 6)}</span>
                  </Fact>
                  <Fact term="Certificate">
                    {record.certificate === ZERO ? "none" : "soulbound, held by the lender"}
                  </Fact>
                  <Fact term="Recorded">
                    {new Date(record.recordedAt * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC
                  </Fact>
                </>
              )}
            </dl>

            {record.collisions.length > 0 && (
              <div className="mt-5 rounded-md border border-danger/35 bg-danger-wash p-4">
                <h2 className="text-[13.5px] font-semibold text-danger">
                  A second protocol tried to lend against this asset
                </h2>
                <p className="mt-1 max-w-[70ch] text-[13px]">
                  The first filing holds. The second was refused on chain and kept on file, because a
                  lender checking here wants to know that somebody already tried, not only that the
                  asset is taken.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2.5 text-[13px]">
                  <span className="rounded-md border border-line bg-white px-2.5 py-1.5">
                    <b className="font-medium">
                      {nameOf(PROTOCOLS, record.collisions.at(-1)!.emitter) ??
                        short(record.collisions.at(-1)!.emitter, 8, 6)}
                    </b>{" "}
                    tried to lend {ether(record.collisions.at(-1)!.amount)}, proven from {source.name}{" "}
                    block <span className="tabular">{num(record.collisions.at(-1)!.sourceHeight)}</span>
                  </span>
                  {refusal && (
                    <span className="text-ink-2">
                      refusal on chain in{" "}
                      <a
                        className="font-mono text-accent hover:underline"
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

            <h2 className="mt-7 flex items-baseline gap-2.5 text-[13px] font-semibold">
              How this is known
              <span className="font-normal text-[12.5px] text-ink-2">
                nobody was trusted for any step
              </span>
            </h2>
            <div className="mt-2.5 grid items-stretch gap-2.5 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:gap-0">
              <Step title="The protocol's own log">
                {record.state !== "free" ? (
                  <>
                    {source.name} block{" "}
                    <a
                      className="tabular text-accent hover:underline"
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
              <div className="hidden place-items-center px-3 text-line-strong lg:grid">
                <ArrowRight size={16} />
              </div>
              <Step title="Inclusion proof">
                re-checked on chain by BlockProver <span className="font-mono">{CFG.prover}</span>,
                accepted at {chain.depth} blocks deep
              </Step>
              <div className="hidden place-items-center px-3 text-line-strong lg:grid">
                <ArrowRight size={16} />
              </div>
              <Step title="The register">
                {opening ? (
                  <>
                    written in{" "}
                    <a
                      className="font-mono text-accent hover:underline"
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
                          className="font-mono text-accent hover:underline"
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

            <h2 className="mt-7 flex items-baseline gap-2.5 text-[13px] font-semibold">
              History
              <span className="font-normal text-[12.5px] text-ink-2">
                {logs.length} {logs.length === 1 ? "entry" : "entries"}
              </span>
            </h2>

            {logs.length ? (
              <table className="mt-2 w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    {["Entry", "What happened", "Protocol", "On Creditcoin"].map((h) => (
                      <th
                        key={h}
                        className="border-b border-line pb-1.5 pr-3 text-left text-[12px] font-medium text-ink-2"
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
                      <tr key={l.transactionHash + l.logIndex} className="hover:bg-panel">
                        <td className="border-b border-panel-2 py-2 pr-3">
                          <span
                            className={cn(
                              "inline-block rounded-full px-2 py-0.5 text-[11.5px] font-medium",
                              kind === "pledge" && "bg-accent-wash text-accent",
                              kind === "refused" && "bg-danger-wash text-danger",
                              kind === "settled" && "bg-good/10 text-good",
                              kind === "released" && "bg-panel-2 text-ink-2",
                            )}
                          >
                            {kind}
                          </span>
                        </td>
                        <td className="border-b border-panel-2 py-2 pr-3">{ENTRY_WORDS[kind]}</td>
                        <td className="border-b border-panel-2 py-2 pr-3">
                          {nameOf(PROTOCOLS, party) ?? (
                            <span className="font-mono">{short(party, 6, 4)}</span>
                          )}
                        </td>
                        <td className="border-b border-panel-2 py-2 pr-3">
                          <a
                            className="font-mono text-accent hover:underline"
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
            ) : (
              <p className="mt-1 max-w-[70ch] text-[13px] text-ink-2">
                This asset has never been registered here. That is not the same as never pledged: the
                register is a positive record, and Attestcoin cannot prove that something did not
                happen.
              </p>
            )}

            <p className="mt-7 max-w-[72ch] border-t border-line pt-3.5 text-[12.5px] text-ink-2">
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
