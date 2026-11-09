"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Download,
  Expand,
  ExternalLink,
  FileJson,
  FolderOpen,
  GitBranch,
  GitCompareArrows,
  Layers,
  List,
  LoaderCircle,
  Maximize2,
  Network,
  Pin,
  Plus,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  addressSchema,
  aggregate,
  allTransfers,
  assetTotals,
  csvExport,
  formatAmount,
  graphData,
  investigationSchema,
  mergeNeighborhood,
  neighborhoodSchema,
  shortAddress,
  snapshotSchema,
  type Address,
  type Connection,
  type Filters,
  type Investigation,
  type Neighborhood,
  type Snapshot,
  type Transfer,
} from "@/lib/domain";
import { chainIdSchema, networks, type ChainId } from "@/lib/networks";
import {
  deleteInvestigation,
  downloadFile,
  listInvestigations,
  saveInvestigation,
} from "@/lib/storage";
import {
  SAMPLE_SECOND,
  sampleInvestigation,
  sampleNeighborhood,
} from "@/lib/sample";

const Graph = dynamic(() => import("./graph"), {
  ssr: false,
  loading: () => (
    <div className="center-state">
      <LoaderCircle className="spin" />
    </div>
  ),
});
type Selection =
  | { kind: "address"; address: Address }
  | { kind: "connection"; id: string }
  | null;
const errorSchema = z.object({ error: z.string() });
const autoResultSchema = z.object({
  snapshot: snapshotSchema,
  first: neighborhoodSchema,
  incomplete: z.array(chainIdSchema),
});
async function api<T>(
  path: string,
  body: object,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const parsed = errorSchema.safeParse(result);
    throw new Error(
      parsed.success
        ? parsed.data.error
        : "The request could not be completed.",
    );
  }
  return schema.parse(result);
}
function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
const date = (value: string) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const assetName = (t: Transfer) =>
  `${t.asset.symbol}${t.asset.contract ? ` · ${shortAddress(t.asset.contract)}` : ""}`;

function nextBranchAddresses(investigation: Investigation, nodes: Address[]) {
  const loaded = new Set(
    investigation.neighborhoods.map((page) => page.address),
  );
  return nodes
    .filter((address) => !loaded.has(address) && !/^0x0{40}$/.test(address))
    .slice(0, Math.min(4, Math.max(0, 100 - loaded.size)));
}

async function loadNeighborhood(
  investigation: Investigation,
  address: Address,
  signal: AbortSignal,
  options?: {
    after?: { incoming: string | null; outgoing: string | null };
    preview?: boolean;
  },
): Promise<Neighborhood> {
  if (investigation.mode === "sample") return sampleNeighborhood(address);
  return api(
    "neighborhood",
    { address, queryToken: investigation.snapshot.queryToken, ...options },
    neighborhoodSchema,
    signal,
  );
}

export default function Explorer() {
  const [investigation, setInvestigation] = useState<Investigation | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [queryChainId, setQueryChainId] = useState<ChainId | "auto">("auto");
  const [days, setDays] = useState("30");
  const [queryAsset, setQueryAsset] = useState("all");
  const [token, setToken] = useState("");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [filters, setFilters] = useState<Filters>({
    asset: "all",
    direction: "both",
    minimum: "",
  });
  const [selection, setSelection] = useState<Selection>(null);
  const [view, setView] = useState<"graph" | "table">("graph");
  const [showAllConnections, setShowAllConnections] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const [saved, setSaved] = useState<Investigation[]>([]);
  const [modal, setModal] = useState<"saved" | "compare" | "help" | null>(null);
  const [compare, setCompare] = useState("");
  const [zoom, setZoom] = useState(0);
  const [fit, setFit] = useState(0);
  const [undo, setUndo] = useState<Investigation[]>([]);
  const [balance, setBalance] = useState<{
    address: Address;
    raw: string;
  } | null>(null);
  const [transferLimit, setTransferLimit] = useState(40);
  const abort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const importer = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const notify = (text: string, kind: "error" | "success" = "success") =>
    setMessage({ text, kind });
  const activeNetwork =
    networks[
      investigation?.snapshot.chainId ??
        (queryChainId === "auto" ? 1 : queryChainId)
    ];
  const graph = useMemo(
    () => (investigation ? graphData(investigation, filters) : null),
    [investigation, filters],
  );
  const graphConnections = graph
    ? showAllConnections
      ? graph.connections
      : graph.pathConnections
    : [];
  const extraConnections = graph
    ? graph.connections.length - graph.pathConnections.length
    : 0;
  const connectionToggleLabel = showAllConnections
    ? "Show paths only"
    : "Show all connections";
  const toggleConnections = () => setShowAllConnections((value) => !value);
  const branchAddresses =
    investigation && graph
      ? nextBranchAddresses(investigation, graph.nodes)
      : [];
  const records = useMemo(
    () => (investigation ? allTransfers(investigation) : []),
    [investigation],
  );
  const assets = useMemo(
    () => [...new Map(records.map((t) => [t.asset.id, t.asset])).values()],
    [records],
  );
  const selectedAddress =
    selection?.kind === "address" ? selection.address : null;
  const selectedDepth = selectedAddress
    ? graph?.depths.get(selectedAddress)
    : undefined;
  const selectedConnection =
    selection?.kind === "connection"
      ? (graph?.connections.find((c) => c.id === selection.id) ??
        aggregate(graph?.transfers ?? []).find((c) => c.id === selection.id))
      : null;
  const neighborhood = investigation?.neighborhoods.find(
    (n) => n.address === selectedAddress,
  );
  const partial = investigation?.neighborhoods.some(
    (n) => n.incoming.status !== "complete" || n.outgoing.status !== "complete",
  );
  const selectedTransfers =
    selectedConnection?.transfers ??
    (selectedAddress
      ? graph?.transfers.filter(
          (t) => t.from === selectedAddress || t.to === selectedAddress,
        )
      : []) ??
    [];

  useEffect(() => {
    if (modal) dialog.current?.showModal();
    else dialog.current?.close();
  }, [modal]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!fullScreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    canvas.current
      ?.querySelector<HTMLButtonElement>(".canvas-screen-button")
      ?.focus();
    const exit = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFullScreen(false);
        setFit((value) => value + 1);
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          canvas.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ) ?? [],
        );
        const index = controls.findIndex(
          (control) => control === document.activeElement,
        );
        if (
          index === -1 ||
          (event.shiftKey ? index === 0 : index === controls.length - 1)
        ) {
          event.preventDefault();
          (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
        }
      }
    };
    window.addEventListener("keydown", exit);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", exit);
    };
  }, [fullScreen]);
  const change = (
    update: (current: Investigation) => Investigation,
    remember = true,
  ) => {
    if (remember && investigation)
      setUndo((items) => [...items.slice(-14), investigation]);
    setInvestigation((current) => (current ? update(current) : null));
  };
  const position = useCallback(
    (address: string, p: { x: number; y: number }) =>
      setInvestigation((i) =>
        i ? { ...i, positions: { ...i.positions, [address]: p } } : i,
      ),
    [],
  );
  const select = useCallback((kind: "address" | "connection", id: string) => {
    setTransferLimit(40);
    if (kind === "address") {
      const a = addressSchema.safeParse(id);
      if (a.success) setSelection({ kind: "address", address: a.data });
    } else setSelection({ kind: "connection", id });
  }, []);
  function reset(next: Investigation) {
    generation.current++;
    abort.current?.abort();
    setBusy(null);
    setFullScreen(false);
    setShowAllConnections(false);
    setInvestigation(next);
    setSelection(
      next.roots[0] ? { kind: "address", address: next.roots[0] } : null,
    );
    setFilters({ asset: "all", direction: "both", minimum: "" });
    setUndo([]);
    setMessage(null);
    setQuery(next.roots[0] ?? "");
    setQueryChainId(next.snapshot.chainId);
    setZoom(0);
    setBalance(null);
    setTransferLimit(40);
  }
  async function expandBranches(
    current: Investigation,
    addresses: Address[],
    controller: AbortController,
    currentGeneration: number,
  ) {
    if (!addresses.length) return;
    setBusy("Loading connected wallets…");
    let merged = current;
    let addedBranch = false;
    const warnings = new Set<string>();
    await Promise.all(
      addresses.map(async (address) => {
        try {
          const page = await loadNeighborhood(
            current,
            address,
            controller.signal,
            { preview: true },
          );
          if (
            generation.current !== currentGeneration ||
            controller.signal.aborted
          )
            return;
          merged = mergeNeighborhood(merged, page);
          const neighborhoods = merged.neighborhoods;
          if (!addedBranch)
            setUndo((history) => [...history.slice(-14), current]);
          addedBranch = true;
          setInvestigation((previous) =>
            previous?.id === current.id
              ? {
                  ...previous,
                  neighborhoods,
                  expansions: [
                    ...previous.expansions.filter(
                      (expansion) => expansion.address !== address,
                    ),
                    { address, active: true, reveal: 20 },
                  ],
                }
              : previous,
          );
          setFit((value) => value + 1);
          for (const warning of page.warnings) warnings.add(warning);
        } catch (error) {
          warnings.add(errorMessage(error));
        }
      }),
    );
    if (
      warnings.size &&
      generation.current === currentGeneration &&
      !controller.signal.aborted
    ) {
      notify([...warnings].join(" "), "error");
    }
  }

  async function exploreNextHop() {
    if (!investigation || busy || !branchAddresses.length) return;
    if (investigation.mode === "live" && !investigation.snapshot.queryToken) {
      return notify(
        "Use Explore wallet to load more addresses from this saved snapshot.",
        "error",
      );
    }
    const currentGeneration = generation.current;
    const controller = new AbortController();
    abort.current = controller;
    setMessage(null);
    try {
      await expandBranches(
        investigation,
        branchAddresses,
        controller,
        currentGeneration,
      );
    } finally {
      if (generation.current === currentGeneration) setBusy(null);
    }
  }
  async function search(event?: React.FormEvent) {
    event?.preventDefault();
    const address = addressSchema.safeParse(query.trim());
    if (!address.success)
      return notify(
        address.error.issues[0]?.message ?? "Invalid address.",
        "error",
      );
    let asset = queryAsset;
    if (queryAsset === "token") {
      const parsed = addressSchema.safeParse(token.trim());
      if (!parsed.success)
        return notify("Enter a valid token contract address.", "error");
      asset = parsed.data;
    }
    const now = new Date();
    const end = days === "custom" ? new Date(`${customEnd}T00:00:00Z`) : now;
    const start =
      days === "custom"
        ? new Date(`${customStart}T00:00:00Z`)
        : new Date(now.getTime() - Number(days) * 86400000);
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      start >= end ||
      end.getTime() - start.getTime() > 90 * 86400000
    )
      return notify(
        "Choose a start and end date up to 90 days apart. The end date is exclusive.",
        "error",
      );
    generation.current++;
    const currentGeneration = generation.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(
      queryChainId === "auto"
        ? "Comparing networks…"
        : "Resolving finalized snapshot…",
    );
    setMessage(null);
    try {
      const request = {
        address: address.data,
        start: start.toISOString(),
        end: end.toISOString(),
        asset,
      };
      let snapshot: Snapshot;
      let first: Neighborhood;
      let autoResult: z.infer<typeof autoResultSchema> | undefined;
      if (queryChainId === "auto") {
        autoResult = await api(
          "explore",
          {
            ...request,
            preferredChainId: investigation?.snapshot.chainId ?? 1,
          },
          autoResultSchema,
          controller.signal,
        );
        ({ snapshot, first } = autoResult);
      } else {
        snapshot = await api(
          "snapshot",
          { ...request, chainId: queryChainId },
          snapshotSchema,
          controller.signal,
        );
        if (generation.current !== currentGeneration) return;
        setBusy("Loading transfers and verifying ETH receipts…");
        first = await api(
          "neighborhood",
          { address: address.data, queryToken: snapshot.queryToken },
          neighborhoodSchema,
          controller.signal,
        );
      }
      if (generation.current !== currentGeneration) return;
      const next: Investigation = {
        version: 1,
        id: crypto.randomUUID(),
        title: `${shortAddress(address.data)} investigation`,
        mode: "live",
        roots: [address.data],
        snapshot,
        neighborhoods: [first],
        expansions: [{ address: address.data, active: true, reveal: 20 }],
        pinned: [],
        hidden: [],
        notes: {},
        positions: {},
        savedAt: now.toISOString(),
      };
      setInvestigation((current) => ({
        ...next,
        notes:
          current?.snapshot.chainId === snapshot.chainId ? current.notes : {},
      }));
      setSelection({ kind: "address", address: address.data });
      setShowAllConnections(false);
      setFilters({ asset: "all", direction: "both", minimum: "" });
      setUndo([]);
      setBalance(null);
      setTransferLimit(40);
      if (autoResult) {
        const warnings = [...first.warnings];
        if (autoResult.incomplete.length) {
          warnings.push(
            `Could not fully check ${autoResult.incomplete.map((id) => networks[id].name).join(", ")}.`,
          );
        }
        if (warnings.length) notify(warnings.join(" "), "error");
        else if (!first.transfers.length)
          notify("Auto found no matching transfers in the pages checked.");
      } else if (first.warnings.length) {
        notify(first.warnings.join(" "), "error");
      }
      const initialGraph = graphData(next, {
        asset: "all",
        direction: "both",
        minimum: "",
      });
      await expandBranches(
        next,
        nextBranchAddresses(next, initialGraph.nodes),
        controller,
        currentGeneration,
      );
    } catch (error) {
      if (!controller.signal.aborted) notify(errorMessage(error), "error");
    } finally {
      if (generation.current === currentGeneration) setBusy(null);
    }
  }
  async function expandAddress(
    address: Address,
    more = false,
    asSecond = false,
    restart = false,
  ) {
    if (!investigation || busy) return;
    const existing = investigation.neighborhoods.find(
      (n) => n.address === address,
    );
    if (!more && existing && !restart) {
      change((i) => ({
        ...i,
        roots: asSecond ? [i.roots[0] ?? address, address] : i.roots,
        hidden: i.hidden.filter((a) => a !== address),
        expansions: [
          ...i.expansions.filter((e) => e.address !== address),
          { address, active: true, reveal: 20 },
        ],
      }));
      setSelection({ kind: "address", address });
      setTransferLimit(40);
      setModal(null);
      return;
    }
    if (investigation.mode === "live" && !investigation.snapshot.queryToken)
      return notify(
        "This imported snapshot opens offline. Use Explore wallet to start a fresh live query.",
        "error",
      );
    if (investigation.neighborhoods.length >= 100 && !existing)
      return notify(
        "Address limit reached. Start a new investigation or narrow the query.",
        "error",
      );
    const currentGeneration = generation.current;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(more ? "Loading older transfers…" : "Expanding address…");
    setMessage(null);
    try {
      const next = await loadNeighborhood(
        investigation,
        address,
        controller.signal,
        more && existing
          ? {
              after: {
                incoming: existing.incoming.cursor,
                outgoing: existing.outgoing.cursor,
              },
            }
          : undefined,
      );
      if (generation.current !== currentGeneration) return;
      const merged = mergeNeighborhood(investigation, next);
      setUndo((u) => [...u.slice(-14), investigation]);
      setInvestigation((current) =>
        current?.id === investigation.id
          ? {
              ...current,
              neighborhoods: merged.neighborhoods,
              roots: asSecond
                ? [investigation.roots[0] ?? address, address]
                : current.roots,
              expansions: [
                ...current.expansions.filter((e) => e.address !== address),
                { address, active: true, reveal: 20 },
              ],
              hidden: current.hidden.filter((a) => a !== address),
            }
          : current,
      );
      setModal(null);
      setSelection({ kind: "address", address });
      setFit((value) => value + 1);
      if (next.warnings.length) notify(next.warnings.join(" "), "error");
    } catch (error) {
      if (!controller.signal.aborted) notify(errorMessage(error), "error");
    } finally {
      if (generation.current === currentGeneration) setBusy(null);
    }
  }
  async function showBalance(address: Address) {
    if (!investigation) return;
    if (investigation.mode === "sample")
      return notify("Balances are available for live investigations.");
    const currentGeneration = generation.current;
    setBusy("Reading balance at snapshot…");
    try {
      const result = await api(
        "address",
        { address, queryToken: investigation.snapshot.queryToken },
        z.object({
          raw: z.string().regex(/^\d+$/),
          decimals: z.number(),
          block: z.number(),
        }),
      );
      if (currentGeneration === generation.current)
        setBalance({ address, raw: formatAmount(result.raw, result.decimals) });
    } catch (e) {
      if (currentGeneration === generation.current)
        notify(errorMessage(e), "error");
    } finally {
      if (currentGeneration === generation.current) setBusy(null);
    }
  }
  async function save() {
    if (!investigation) return;
    try {
      await saveInvestigation(investigation);
      notify("Saved in this browser. Export JSON to keep a portable copy.");
    } catch {
      notify(
        "Browser storage is unavailable. Export JSON to save your work.",
        "error",
      );
    }
  }
  async function openSaved() {
    try {
      setSaved(await listInvestigations());
      setModal("saved");
    } catch {
      notify("Browser storage is unavailable.", "error");
    }
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024)
      return notify("Import files must be smaller than 10 MB.", "error");
    try {
      const imported = investigationSchema.parse(JSON.parse(await file.text()));
      reset(imported);
      notify(
        "Opened saved snapshot. Live continuations restart from this snapshot.",
      );
    } catch {
      notify("This file is not a valid Wallet Map investigation.", "error");
    }
    if (importer.current) importer.current.value = "";
  }
  function exportJson() {
    if (!investigation) return;
    const portable = {
      ...investigation,
      snapshot: { ...investigation.snapshot, queryToken: "" },
      neighborhoods: investigation.neighborhoods.map((n) => ({
        ...n,
        incoming: { ...n.incoming, cursor: null },
        outgoing: { ...n.outgoing, cursor: null },
      })),
      savedAt: new Date().toISOString(),
    };
    downloadFile(
      "wallet-map-investigation.json",
      JSON.stringify(portable, null, 2),
      "application/json",
    );
  }
  function compareAddress(event: React.FormEvent) {
    event.preventDefault();
    const parsed = addressSchema.safeParse(compare.trim());
    if (!parsed.success)
      return notify("Enter a valid Ethereum address to compare.", "error");
    if (investigation?.roots[0] === parsed.data)
      return notify("Choose a different address to compare.", "error");
    void expandAddress(parsed.data, false, true);
  }
  const canContinue =
    neighborhood &&
    (neighborhood.incoming.cursor || neighborhood.outgoing.cursor);
  const selectedExpansion = investigation?.expansions.find(
    (e) => e.address === selectedAddress && e.active,
  );
  const title = investigation?.title ?? "New investigation";

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand" href="/" aria-label="Wallet Map home">
          <span className="brand-icon">
            <Network size={21} />
          </span>
          <span>
            Wallet<span className="brand-light">Map</span>
            <span className="beta">BETA</span>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          <button className="nav-active">
            <GitBranch size={15} />
            Explorer
          </button>
          <button onClick={openSaved}>
            <FolderOpen size={15} />
            Saved investigations
          </button>
        </nav>
        <div className="header-right">
          <span className="network-pill" data-testnet={activeNetwork.testnet}>
            <i />
            {!investigation && queryChainId === "auto"
              ? "Auto network"
              : activeNetwork.name}
            {activeNetwork.testnet && (
              <span className="testnet-tag">Testnet</span>
            )}
          </span>
          <button
            className="icon-button"
            aria-label="Help"
            onClick={() => setModal("help")}
          >
            <CircleHelp size={18} />
          </button>
          <a
            href="https://github.com/Muhid-Qaiser/wallet-map"
            target="_blank"
            rel="noreferrer"
            className="github-link"
          >
            GitHub <ExternalLink size={12} />
          </a>
        </div>
      </header>

      <section className="query-section" aria-label="Search wallet activity">
        <div className="query-heading">
          <span className="eyebrow">FOLLOW THE CONNECTIONS</span>
          <span className="read-only">
            <span /> Public data · Read only
          </span>
        </div>
        <form className="query-form" onSubmit={search}>
          <div className="query-search-row">
            <label className="address-input">
              <Search size={19} />
              <input
                aria-label="Wallet address"
                placeholder="Paste a wallet address to begin"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              <kbd>0x</kbd>
            </label>
            <button
              type="submit"
              className="button primary search-button"
              disabled={!!busy}
            >
              <span>Explore wallet</span>
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <ArrowRight size={17} />
              )}
            </button>
          </div>
          <div className="query-options">
            <label className="select-field network-field">
              <span>Network</span>
              <select
                aria-label="Network"
                value={queryChainId}
                disabled={!!busy}
                onChange={(e) => {
                  if (e.target.value === "auto") {
                    setQueryChainId("auto");
                    return;
                  }
                  const parsed = chainIdSchema.safeParse(
                    Number(e.target.value),
                  );
                  if (parsed.success) setQueryChainId(parsed.data);
                }}
              >
                <option value="auto">Auto (most connections)</option>
                <optgroup label="Mainnets">
                  <option value={1}>{networks[1].name}</option>
                  <option value={8453}>{networks[8453].name}</option>
                </optgroup>
                <optgroup label="Testnets">
                  <option value={11155111}>{networks[11155111].name}</option>
                  <option value={84532}>{networks[84532].name}</option>
                </optgroup>
              </select>
              <ChevronDown size={14} />
            </label>
            <label className="select-field">
              <span>Period</span>
              <select
                aria-label="Date range"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              >
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="custom">Custom dates</option>
              </select>
              <ChevronDown size={14} />
            </label>
            <label className="select-field">
              <span>Assets</span>
              <select
                aria-label="Query asset"
                value={queryAsset}
                onChange={(e) => setQueryAsset(e.target.value)}
              >
                <option value="all">ETH + tokens</option>
                <option value="native">ETH only</option>
                <option value="token">Token contract</option>
              </select>
              <ChevronDown size={14} />
            </label>
          </div>
          {(days === "custom" || queryAsset === "token") && (
            <div className="extra-query">
              {days === "custom" && (
                <>
                  <label>
                    From (UTC)
                    <input
                      aria-label="Start date"
                      type="date"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                    />
                  </label>
                  <label>
                    Until, exclusive (UTC)
                    <input
                      aria-label="End date"
                      type="date"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                    />
                  </label>
                </>
              )}
              {queryAsset === "token" && (
                <label className="grow">
                  Token contract
                  <input
                    aria-label="Token contract"
                    placeholder="0x…"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </label>
              )}
            </div>
          )}
        </form>
      </section>

      {message && (
        <div
          className={`notice ${message.kind}`}
          role={message.kind === "error" ? "alert" : "status"}
        >
          <span>
            {message.kind === "error" ? (
              <CircleHelp size={16} />
            ) : (
              <Check size={16} />
            )}
            {message.text}
          </span>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setMessage(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}

      <main className="workspace">
        <section
          className="graph-workspace"
          aria-label="Investigation workspace"
        >
          <div className="workspace-heading">
            <div className="workspace-title">
              <GitBranch size={17} />
              {investigation ? (
                <input
                  aria-label="Investigation name"
                  value={title}
                  maxLength={100}
                  onChange={(e) =>
                    change((i) => ({ ...i, title: e.target.value }), false)
                  }
                />
              ) : (
                <span>{title}</span>
              )}
              {investigation?.mode === "sample" && (
                <span className="sample-badge">SAMPLE</span>
              )}
            </div>
            <div className="workspace-actions">
              <button
                className="text-button"
                onClick={() => importer.current?.click()}
                disabled={!!busy}
              >
                <Upload size={14} />
                Import
              </button>
              <button
                className="text-button"
                onClick={save}
                disabled={!investigation || !!busy}
              >
                <Save size={14} />
                Save
              </button>
              <details className="export-menu">
                <summary aria-label="Export investigation">
                  <Download size={16} />
                  <span>Export</span>
                  <ChevronDown size={12} />
                </summary>
                <div>
                  <button onClick={exportJson} disabled={!investigation}>
                    <FileJson size={15} />
                    Investigation JSON
                  </button>
                  <button
                    onClick={() =>
                      graph &&
                      downloadFile(
                        "wallet-map-transfers.csv",
                        csvExport(graph.transfers),
                        "text/csv;charset=utf-8",
                      )
                    }
                    disabled={!investigation}
                  >
                    <List size={15} />
                    Filtered transfers CSV
                  </button>
                </div>
              </details>
            </div>
          </div>
          <input
            ref={importer}
            type="file"
            accept=".json,application/json"
            aria-label="Import investigation file"
            className="sr-only"
            onChange={(e) => void importFile(e.target.files?.[0])}
          />
          <div className="filter-toolbar">
            <div className="view-switch" aria-label="View">
              <button
                className={view === "graph" ? "active" : ""}
                aria-label="Graph view"
                aria-pressed={view === "graph"}
                onClick={() => setView("graph")}
              >
                <Network size={15} />
                Graph
              </button>
              <button
                className={view === "table" ? "active" : ""}
                aria-label="Table view"
                aria-pressed={view === "table"}
                onClick={() => setView("table")}
              >
                <List size={15} />
                Table
              </button>
            </div>
            <div className="filter-controls">
              <SlidersHorizontal
                size={14}
                className="muted"
                aria-hidden="true"
              />
              <select
                aria-label="Filter loaded assets"
                disabled={!investigation}
                value={filters.asset}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    asset: e.target.value,
                    minimum: "",
                  }))
                }
              >
                <option value="all">All loaded assets</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.symbol}
                    {a.contract ? ` · ${shortAddress(a.contract)}` : ""}
                  </option>
                ))}
              </select>
              <select
                aria-label="Transfer direction"
                disabled={!investigation}
                value={filters.direction}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    direction:
                      e.target.value === "in"
                        ? "in"
                        : e.target.value === "out"
                          ? "out"
                          : "both",
                  }))
                }
              >
                <option value="both">Both directions</option>
                <option value="in">Into starting wallet</option>
                <option value="out">Out of starting wallet</option>
              </select>
              {filters.asset !== "all" && (
                <input
                  className="minimum-input"
                  aria-label="Minimum transfer amount"
                  inputMode="decimal"
                  placeholder="Min. amount"
                  value={filters.minimum}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, minimum: e.target.value }))
                  }
                />
              )}
            </div>
            <button
              className="text-button compare-button"
              disabled={!investigation || !!busy}
              onClick={() => {
                setCompare(
                  investigation?.mode === "sample" ? SAMPLE_SECOND : "",
                );
                setModal("compare");
              }}
            >
              <GitCompareArrows size={15} />
              Compare wallet
            </button>
          </div>
          {view === "graph" && (
            <GraphReadingGuide graph={graph}>
              {extraConnections > 0 && (
                <div className="graph-guide-actions">
                  <p>
                    {showAllConnections
                      ? "Showing every connection in the graph."
                      : `Paths view keeps a route to each connected address and hides ${extraConnections} extra ${extraConnections === 1 ? "connection" : "connections"}.`}
                  </p>
                  <button className="text-button" onClick={toggleConnections}>
                    <Network size={15} />
                    {connectionToggleLabel}
                  </button>
                </div>
              )}
            </GraphReadingGuide>
          )}
          <div
            ref={canvas}
            role={fullScreen ? "dialog" : undefined}
            aria-modal={fullScreen || undefined}
            aria-label={fullScreen ? "Wallet graph" : undefined}
            className={`canvas-area${fullScreen ? " canvas-full-screen" : ""}`}
          >
            {investigation && graph ? (
              <>
                {view === "graph" ? (
                  <Graph
                    key={investigation.id}
                    nodes={graph.nodes}
                    connections={graphConnections}
                    depths={graph.depths}
                    parents={graph.parents}
                    roots={investigation.roots}
                    pinned={investigation.pinned}
                    shared={graph.shared}
                    positions={investigation.positions}
                    selected={
                      selection?.kind === "address"
                        ? selection.address
                        : (selection?.id ?? null)
                    }
                    zoom={zoom}
                    fit={fit}
                    fullScreen={fullScreen}
                    onSelect={select}
                    onPosition={position}
                  />
                ) : (
                  <div className="table-scroll">
                    <table>
                      <caption className="sr-only">
                        Loaded transfer connections
                      </caption>
                      <thead>
                        <tr>
                          <th>From</th>
                          <th>To</th>
                          <th>Transfers</th>
                          <th>Assets</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {graph.connections.map((c) => (
                          <tr key={c.id}>
                            <td>
                              <button
                                className="mono link-button"
                                onClick={() => select("address", c.from)}
                              >
                                {shortAddress(c.from)}
                              </button>
                            </td>
                            <td>
                              <button
                                className="mono link-button"
                                onClick={() => select("address", c.to)}
                              >
                                {shortAddress(c.to)}
                              </button>
                            </td>
                            <td>{c.transfers.length}</td>
                            <td>
                              {[
                                ...new Set(
                                  c.transfers.map((t) => t.asset.symbol),
                                ),
                              ].join(", ")}
                            </td>
                            <td>
                              <button
                                className="text-button"
                                aria-label={`Inspect connection ${c.from} to ${c.to}`}
                                onClick={() => select("connection", c.id)}
                              >
                                Inspect <ArrowRight size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!graph.connections.length && (
                      <div className="center-state">
                        <p>
                          No matching transfers on {activeNetwork.name} in this
                          range.
                        </p>
                      </div>
                    )}
                  </div>
                )}
                <div className="canvas-info">
                  <span className="canvas-label">
                    {investigation.mode === "sample"
                      ? "ILLUSTRATIVE DATA"
                      : `${activeNetwork.name.toUpperCase()}${activeNetwork.testnet ? " · TESTNET" : ""}`}
                  </span>
                  <span>
                    {graph.nodes.length} addresses
                    <span className="dot-separator">·</span>
                    {view === "graph"
                      ? graphConnections.length
                      : graph.connections.length}{" "}
                    connections
                  </span>
                  {graph.shared.size > 0 && (
                    <span className="shared-indicator">
                      {graph.shared.size} shared counterparties
                    </span>
                  )}
                  {fullScreen && (
                    <span className="direction-hint">
                      Arrows point from sender to recipient
                    </span>
                  )}
                </div>
                {view === "graph" && (
                  <div className="canvas-actions">
                    <button
                      className="button"
                      disabled={
                        !!busy ||
                        !branchAddresses.length ||
                        filters.direction !== "both"
                      }
                      onClick={() => void exploreNextHop()}
                    >
                      <GitBranch size={15} />
                      Expand next hop
                    </button>
                    <button
                      className="button canvas-screen-button"
                      aria-label={
                        fullScreen ? "Exit full screen" : "Open full screen"
                      }
                      title={
                        fullScreen ? "Exit full screen" : "Open full screen"
                      }
                      onClick={() => {
                        setFullScreen((value) => !value);
                        setFit((value) => value + 1);
                      }}
                    >
                      {fullScreen ? <X size={16} /> : <Maximize2 size={16} />}
                    </button>
                  </div>
                )}
                {view === "graph" && (
                  <div className="graph-controls">
                    <button
                      aria-label="Zoom in"
                      onClick={() => setZoom((v) => Math.abs(v) + 1)}
                    >
                      <ZoomIn size={17} />
                    </button>
                    <button
                      aria-label="Zoom out"
                      onClick={() => setZoom((v) => -Math.abs(v) - 1)}
                    >
                      <ZoomOut size={17} />
                    </button>
                    <button
                      aria-label="Fit graph"
                      onClick={() => setFit((v) => v + 1)}
                    >
                      <Maximize2 size={17} />
                    </button>
                    <span />
                    <button
                      aria-label="Arrange in rings"
                      title="Arrange in rings"
                      onClick={() => {
                        if (Object.keys(investigation.positions).length) {
                          change((current) => ({ ...current, positions: {} }));
                        }
                        setFit((v) => v + 1);
                      }}
                    >
                      <Expand size={17} />
                    </button>
                    {fullScreen && extraConnections > 0 && (
                      <button
                        aria-label={connectionToggleLabel}
                        title={connectionToggleLabel}
                        onClick={toggleConnections}
                      >
                        <Network size={17} />
                      </button>
                    )}
                  </div>
                )}
                <div className="canvas-bottom">
                  {fullScreen && (
                    <div className="legend">
                      <span>
                        <i className="root-dot" />
                        Starting wallet
                      </span>
                      <span>
                        <i className="address-dot" />
                        Direct
                      </span>
                      <span>
                        <i className="branch-dot" />
                        Indirect
                      </span>
                      {investigation.roots.length > 1 && (
                        <span>
                          <i className="shared-dot" />
                          Shared
                        </span>
                      )}
                    </div>
                  )}
                  <button
                    className="text-button"
                    disabled={!undo.length || !!busy}
                    onClick={() => {
                      const previous = undo.at(-1);
                      if (previous) {
                        setInvestigation((current) => ({
                          ...previous,
                          notes: current?.notes ?? previous.notes,
                          title: current?.title ?? previous.title,
                        }));
                        setUndo((u) => u.slice(0, -1));
                      }
                    }}
                  >
                    <RotateCcw size={14} />
                    Undo
                  </button>
                </div>
                {(graph.hiddenCount > 0 || graph.nodes.length === 100) && (
                  <div className="hidden-hint">
                    {graph.nodes.length === 100
                      ? "100-address display limit reached."
                      : "Some loaded connections are hidden. Reveal more from an expanded address."}
                  </div>
                )}
                {records.length === 0 && !busy && view === "graph" && (
                  <div className="empty-overlay">
                    <Search size={25} />
                    <h2>No transfers loaded</h2>
                    <p>
                      {partial
                        ? "History could not be fully loaded. Check the address panel and retry."
                        : `No matching transfers on ${activeNetwork.name}. Check the network in your wallet, or try a different period or asset.`}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="welcome-state">
                <div className="constellation" aria-hidden="true">
                  <span className="orbit orbit-one" />
                  <span className="orbit orbit-two" />
                  <span className="central-node">
                    <Network size={28} />
                  </span>
                  <i className="satellite one" />
                  <i className="satellite two" />
                  <i className="satellite three" />
                  <i className="satellite four" />
                </div>
                <span className="eyebrow">
                  A CLEARER VIEW OF ONCHAIN ACTIVITY
                </span>
                <h1>
                  Follow the funds.
                  <br />
                  <span>Find the connections.</span>
                </h1>
                <p>
                  Turn a wallet address into a map you can explore.
                  <br />
                  Every connection leads back to its transfers.
                </p>
                <button
                  className="button sample-button"
                  onClick={() => reset(sampleInvestigation())}
                >
                  <Network size={16} />
                  Open sample investigation
                  <ArrowRight size={15} />
                </button>
                <span className="sample-caption">
                  Illustrative data · No wallet connection needed
                </span>
              </div>
            )}
            {busy && (
              <div
                className={`loading-indicator${busy === "Loading connected wallets…" ? " branch-loading" : ""}`}
                role="status"
              >
                <LoaderCircle size={16} className="spin" />
                {busy}
              </div>
            )}
          </div>
          <footer className="coverage-bar">
            <div>
              <span className={`status-dot ${partial ? "partial" : ""}`} />
              {investigation
                ? `${graph?.transfers.length ?? 0} matching / ${records.length} unique transfers loaded${partial ? " · History incomplete" : " · Loaded ranges complete"}`
                : "Ready to explore"}
            </div>
            {investigation ? (
              <span title={investigation.snapshot.timestamp}>
                {date(investigation.snapshot.start)} –{" "}
                {date(investigation.snapshot.end)} UTC
                <span className="dot-separator">·</span>Block{" "}
                {investigation.snapshot.block.toLocaleString("en-US")}
              </span>
            ) : (
              <span>External ETH + ERC-20 transfer events</span>
            )}
          </footer>
        </section>

        <aside className="evidence-panel" aria-label="Evidence panel">
          <div className="panel-header">
            <span>
              {selectedConnection ? "Connection evidence" : "Address details"}
            </span>
            <Layers size={15} />
          </div>
          {!investigation ? (
            <div className="panel-welcome">
              <div className="panel-illustration">
                <GitBranch size={25} />
              </div>
              <h2>Start with an address.</h2>
              <p>
                Choose a wallet or connection on the map to inspect its activity
                here.
              </p>
              <div className="panel-step">
                <span>01</span>
                <div>
                  <strong>Explore a wallet</strong>
                  <p>Paste a wallet address and select its network.</p>
                </div>
              </div>
              <div className="panel-step">
                <span>02</span>
                <div>
                  <strong>Follow a connection</strong>
                  <p>Expand a sender or recipient.</p>
                </div>
              </div>
              <div className="panel-step">
                <span>03</span>
                <div>
                  <strong>Inspect the evidence</strong>
                  <p>Open the underlying transfers.</p>
                </div>
              </div>
              <div className="privacy-note">
                <CircleHelp size={15} />
                <p>
                  Public blockchain data. Your notes and saved investigations
                  stay in this browser.
                </p>
              </div>
            </div>
          ) : (
            <div className="panel-content">
              {investigation.mode === "sample" && (
                <div className="sample-note">
                  Sample investigation. Addresses, balances, and transfers are
                  illustrative.
                </div>
              )}
              {selectedConnection ? (
                <ConnectionHeader
                  connection={selectedConnection}
                  onAddress={(a) => select("address", a)}
                />
              ) : selectedAddress ? (
                <>
                  <div className="detail-eyebrow">
                    {investigation.roots.includes(selectedAddress)
                      ? "STARTING ADDRESS"
                      : selectedDepth === undefined
                        ? "COUNTERPARTY"
                        : selectedDepth === 1
                          ? "DIRECT CONNECTION"
                          : `${selectedDepth} HOPS FROM A STARTING WALLET`}
                    {graph?.shared.has(selectedAddress) && (
                      <span className="shared-tag">SHARED</span>
                    )}
                  </div>
                  <h2 className="address-title mono">
                    {shortAddress(selectedAddress)}
                  </h2>
                  <div className="full-address mono">
                    {selectedAddress}
                    <button
                      className="icon-button"
                      aria-label="Copy address"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(selectedAddress);
                          notify("Address copied.");
                        } catch {
                          notify(
                            "Clipboard unavailable. Select and copy the full address.",
                            "error",
                          );
                        }
                      }}
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                  {investigation.mode === "live" && (
                    <a
                      className="explorer-link"
                      href={`${activeNetwork.explorer}/address/${selectedAddress}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View on {activeNetwork.explorerName}
                      <ExternalLink size={12} />
                    </a>
                  )}
                  <div className="address-actions">
                    <button
                      className="button primary"
                      disabled={!!busy}
                      onClick={() => expandAddress(selectedAddress)}
                    >
                      <Plus size={15} />
                      {selectedExpansion ? "Expanded" : "Expand address"}
                    </button>
                    <button
                      className={`button ${investigation.pinned.includes(selectedAddress) ? "is-pinned" : ""}`}
                      aria-label={
                        investigation.pinned.includes(selectedAddress)
                          ? "Unpin address"
                          : "Pin address"
                      }
                      onClick={() =>
                        change((i) => ({
                          ...i,
                          pinned: i.pinned.includes(selectedAddress)
                            ? i.pinned.filter((a) => a !== selectedAddress)
                            : [...i.pinned, selectedAddress],
                        }))
                      }
                    >
                      <Pin size={15} />
                    </button>
                  </div>
                  <div className="address-stats">
                    <div>
                      <span>Observed transfers</span>
                      <strong>{selectedTransfers.length}</strong>
                    </div>
                    <div>
                      <span>ETH at snapshot</span>
                      {balance?.address === selectedAddress ? (
                        <strong className="balance-text">{balance.raw}</strong>
                      ) : (
                        <button
                          className="link-button"
                          disabled={!!busy}
                          onClick={() => showBalance(selectedAddress)}
                        >
                          Load balance
                          <ArrowRight size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                  {neighborhood && (
                    <div className="history-status">
                      <span className="section-label">HISTORY COVERAGE</span>
                      <p>
                        Incoming: {neighborhood.incoming.status} ·{" "}
                        {neighborhood.incoming.count} records
                        <br />
                        Outgoing: {neighborhood.outgoing.status} ·{" "}
                        {neighborhood.outgoing.count} records
                      </p>
                      {neighborhood.warnings.map((w) => (
                        <p className="warning-text" key={w}>
                          {w}
                        </p>
                      ))}
                      {canContinue && (
                        <button
                          className="button full-width"
                          disabled={!!busy}
                          onClick={() => expandAddress(selectedAddress, true)}
                        >
                          Load older / retry
                          <ChevronDown size={14} />
                        </button>
                      )}
                      {investigation.mode === "live" && (
                        <button
                          className="text-button"
                          disabled={!!busy}
                          onClick={() =>
                            expandAddress(selectedAddress, false, false, true)
                          }
                        >
                          Restart address history
                          <RotateCcw size={12} />
                        </button>
                      )}
                      {selectedExpansion && (
                        <button
                          className="text-button"
                          onClick={() =>
                            change((i) => ({
                              ...i,
                              expansions: i.expansions.map((e) =>
                                e.address === selectedAddress
                                  ? {
                                      ...e,
                                      reveal: Math.min(100, e.reveal + 20),
                                    }
                                  : e,
                              ),
                            }))
                          }
                        >
                          Reveal more loaded counterparties
                          <Plus size={12} />
                        </button>
                      )}
                    </div>
                  )}
                  <label className="notes-label">
                    <span className="section-label">
                      YOUR NOTES <span>LOCAL ONLY</span>
                    </span>
                    <textarea
                      aria-label="Address notes"
                      maxLength={2000}
                      placeholder="Add context to this address…"
                      value={investigation.notes[selectedAddress] ?? ""}
                      onChange={(e) =>
                        change(
                          (i) => ({
                            ...i,
                            notes: {
                              ...i.notes,
                              [selectedAddress]: e.target.value,
                            },
                          }),
                          false,
                        )
                      }
                    />
                  </label>
                  {!investigation.roots.includes(selectedAddress) && (
                    <div className="secondary-actions">
                      <button
                        className="text-button"
                        onClick={() =>
                          change((i) => ({
                            ...i,
                            expansions: i.expansions.map((e) =>
                              e.address === selectedAddress
                                ? { ...e, active: false }
                                : e,
                            ),
                          }))
                        }
                      >
                        Collapse expansion
                      </button>
                      <button
                        className="text-button"
                        disabled={investigation.pinned.includes(
                          selectedAddress,
                        )}
                        onClick={() => {
                          change((i) => ({
                            ...i,
                            hidden: [
                              ...new Set([...i.hidden, selectedAddress]),
                            ],
                          }));
                          setSelection(null);
                        }}
                      >
                        Hide address
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="selection-hint">
                  Select a wallet or connection to inspect its evidence.
                </div>
              )}
              {(selectedConnection || selectedAddress) && (
                <>
                  <div className="section-title">
                    <span className="section-label">
                      {selectedConnection
                        ? "SUPPORTING TRANSFERS"
                        : "OBSERVED TRANSFERS"}
                    </span>
                    <span>{selectedTransfers.length}</span>
                  </div>
                  <div className="transfer-list">
                    {selectedTransfers.slice(0, transferLimit).map((t) => (
                      <TransferRow
                        key={t.id}
                        transfer={t}
                        root={selectedAddress}
                        onAddress={(a) => select("address", a)}
                      />
                    ))}
                    {!selectedTransfers.length && (
                      <p className="muted small">
                        {neighborhood
                          ? "No matching transfers in loaded history."
                          : "Expand this address to load its history."}
                      </p>
                    )}
                    {selectedTransfers.length > transferLimit && (
                      <button
                        className="button full-width"
                        onClick={() => setTransferLimit((l) => l + 40)}
                      >
                        Show more transfers
                      </button>
                    )}
                  </div>
                </>
              )}
              <div className="evidence-footnote">
                <CircleHelp size={13} />
                <span>
                  Connections show reported transfers. They do not establish
                  wallet ownership or the path of specific funds. Internal ETH
                  and zero-value calls are outside this release’s coverage.
                </span>
              </div>
            </div>
          )}
        </aside>
      </main>
      <footer className="app-footer">
        <span>
          <Network size={12} />
          Wallet Map<span className="dot-separator">/</span>Evidence behind
          every connection.
        </span>
        <span>Your investigation. Your context.</span>
      </footer>

      <dialog
        ref={dialog}
        className="modal"
        onCancel={() => setModal(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setModal(null);
        }}
      >
        <div className="modal-heading">
          <h2>
            {modal === "saved"
              ? "Saved investigations"
              : modal === "compare"
                ? "Compare a second wallet"
                : "Using Wallet Map"}
          </h2>
          <button
            aria-label="Close dialog"
            className="icon-button"
            onClick={() => setModal(null)}
          >
            <X size={18} />
          </button>
        </div>
        {modal === "saved" && (
          <>
            <p className="muted small">
              Saved in this browser. Export JSON before clearing browser data.
            </p>
            {saved.length ? (
              saved.map((item) => (
                <div className="saved-row" key={item.id}>
                  <button
                    onClick={() => {
                      reset(item);
                      setModal(null);
                    }}
                  >
                    <strong>{item.title}</strong>
                    <span>
                      {date(item.savedAt)} · {item.mode} ·{" "}
                      {allTransfers(item).length} transfers
                    </span>
                  </button>
                  <button
                    aria-label={`Delete ${item.title}`}
                    className="icon-button"
                    onClick={async () => {
                      await deleteInvestigation(item.id);
                      setSaved((s) => s.filter((i) => i.id !== item.id));
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            ) : (
              <div className="modal-empty">
                <FolderOpen size={28} />
                <p>No investigations saved yet.</p>
              </div>
            )}
          </>
        )}
        {modal === "compare" && (
          <form onSubmit={compareAddress}>
            <p className="muted small">
              Load another address at the same snapshot and highlight shared
              counterparties. Results cover loaded history only.
            </p>
            <label className="form-label">
              Ethereum address
              <input
                autoFocus
                aria-label="Comparison address"
                placeholder="0x…"
                value={compare}
                onChange={(e) => setCompare(e.target.value)}
              />
            </label>
            <button className="button primary full-width" disabled={!!busy}>
              <GitCompareArrows size={16} />
              Compare connections
            </button>
          </form>
        )}
        {modal === "help" && (
          <div className="help-content">
            <p>
              Paste a wallet address and choose its network and period. The same
              address can have different activity on each network. Click an
              address to expand it, or an arrow to inspect the transfers.
            </p>
            <p>
              Live searches preview up to four connected wallets. Use Expand
              next hop to follow more branches, or open the graph in full
              screen.
            </p>
            <p>
              <strong>Coverage:</strong> external ETH transfers and ERC-20
              transfer events. ETH transfers are checked against successful
              transaction receipts. Internal transfers, NFTs, approvals, and
              zero-value calls are excluded.
            </p>
            <p>
              Filters and shared-counterparty results apply to loaded data. More
              history may remain. Amounts are kept in exact token units; token
              names are unverified metadata.
            </p>
            <p>
              Save stores this investigation locally. JSON export preserves
              records, notes, and positions. Live continuation tokens are
              excluded from exports.
            </p>
            <p>
              Searches reach this server and Alchemy. Notes stay in your
              browser. No wallet connection or signature is required.
            </p>
            <button
              className="button full-width"
              onClick={() => {
                reset(sampleInvestigation());
                setModal(null);
              }}
            >
              Open sample investigation
            </button>
          </div>
        )}
      </dialog>
    </div>
  );
}

function GraphReadingGuide({
  graph,
  children,
}: {
  graph: ReturnType<typeof graphData> | null;
  children: React.ReactNode;
}) {
  const counts = { start: 0, direct: 0, indirect: 0, separate: 0 };
  for (const address of graph?.nodes ?? []) {
    const depth = graph?.depths.get(address);
    if (depth === 0) counts.start++;
    else if (depth === 1) counts.direct++;
    else if (depth !== undefined) counts.indirect++;
    else counts.separate++;
  }
  const groups = [
    {
      label: counts.start > 1 ? "Starting wallets" : "Starting wallet",
      description: "At the center",
      dot: "root-dot",
      count: counts.start,
    },
    {
      label: "Direct",
      description: "First ring, one link away",
      dot: "address-dot",
      count: counts.direct,
    },
    {
      label: "Indirect",
      description: "Outer rings, two or more links away",
      dot: "branch-dot",
      count: counts.indirect,
    },
  ];
  return (
    <section className="graph-guide" aria-labelledby="graph-guide-heading">
      <h2 id="graph-guide-heading">How to read the graph</h2>
      <p id="graph-reading-guide">
        Start with the gold addresses at the center. Each ring is one link
        farther out. Arrows point from sender to recipient. Select an arrow to
        see its transfers.
      </p>
      <ol>
        {groups.map(({ label, description, dot, count }) => (
          <li key={dot}>
            <div className="graph-guide-group">
              <i className={dot} aria-hidden="true" />
              <strong>{label}</strong>
              {graph && <span aria-label={`${count} addresses`}>{count}</span>}
            </div>
            <p>{description}</p>
          </li>
        ))}
      </ol>
      {((graph && graph.shared.size > 0) || counts.separate > 0) && (
        <p className="graph-guide-note">
          {graph &&
            graph.shared.size > 0 &&
            "Purple dashed outlines mark addresses linked to both starting wallets. "}
          {counts.separate > 0 &&
            "Gray dashed outlines mark addresses outside the visible paths."}
        </p>
      )}
      {children}
    </section>
  );
}

function ConnectionHeader({
  connection,
  onAddress,
}: {
  connection: Connection;
  onAddress: (address: Address) => void;
}) {
  return (
    <>
      <span className="detail-eyebrow">DIRECTED CONNECTION</span>
      <div className="connection-route">
        <button className="mono" onClick={() => onAddress(connection.from)}>
          {shortAddress(connection.from)}
        </button>
        <ArrowDownLeft size={17} />
        <button className="mono" onClick={() => onAddress(connection.to)}>
          {shortAddress(connection.to)}
        </button>
      </div>
      <div className="connection-summary">
        <strong>{connection.transfers.length}</strong>
        <span>
          transfers across{" "}
          {new Set(connection.transfers.map((t) => t.hash)).size} transactions
        </span>
      </div>
      <div className="asset-totals">
        {assetTotals(connection.transfers).map((total) => (
          <div key={total.asset.id}>
            <span title={total.asset.contract ?? "Native ETH"}>
              {total.asset.symbol}
              {total.asset.contract && (
                <small className="mono">
                  {shortAddress(total.asset.contract)}
                </small>
              )}
            </span>
            <strong>
              {formatAmount(total.raw.toString(), total.asset.decimals, true)}
              {total.unknown > 0 && <small> + {total.unknown} unknown</small>}
            </strong>
          </div>
        ))}
      </div>
      <p className="small muted">
        {date(connection.transfers.at(-1)?.timestamp ?? "")} –{" "}
        {date(connection.transfers[0]?.timestamp ?? "")} UTC · Loaded records
        only
      </p>
    </>
  );
}
function TransferRow({
  transfer: t,
  root,
  onAddress,
}: {
  transfer: Transfer;
  root: Address | null;
  onAddress: (address: Address) => void;
}) {
  const incoming = root === t.to;
  return (
    <div className="transfer-row">
      <div className={`transfer-icon ${incoming ? "incoming" : "outgoing"}`}>
        {incoming ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
      </div>
      <div className="transfer-body">
        <div className="transfer-amount">
          <strong title={formatAmount(t.raw, t.asset.decimals)}>
            {formatAmount(t.raw, t.asset.decimals, true)}{" "}
            <span>{t.asset.symbol}</span>
          </strong>
          <time dateTime={t.timestamp} title={t.timestamp}>
            {date(t.timestamp)}
          </time>
        </div>
        <div className="transfer-addresses">
          <button className="mono" onClick={() => onAddress(t.from)}>
            {shortAddress(t.from)}
          </button>
          <ArrowRight size={10} />
          <button className="mono" onClick={() => onAddress(t.to)}>
            {shortAddress(t.to)}
          </button>
        </div>
        <div className="transfer-meta">
          <span title={assetName(t)}>
            {t.category === "erc20"
              ? `ERC-20 · ${shortAddress(t.asset.contract ?? "")}`
              : "ETH transfer"}
          </span>
          {t.source === "alchemy" ? (
            <a
              href={`${networks[t.chainId].explorer}/tx/${t.hash}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`View transaction ${t.hash}`}
            >
              Transaction
              <ExternalLink size={10} />
            </a>
          ) : (
            <span>Illustrative</span>
          )}
        </div>
      </div>
    </div>
  );
}
