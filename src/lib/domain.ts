import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { chainIdSchema, type ChainId } from "./networks";

export const addressSchema = z
  .string()
  .max(42)
  .refine(
    (s) => isAddress(s, { strict: true }),
    "Enter a valid Ethereum address (0x followed by 40 hexadecimal characters).",
  )
  .transform((s) => getAddress(s.toLowerCase()))
  .brand<"Address">();
export type Address = z.infer<typeof addressSchema>;
export const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const assetSchema = z.object({
  id: z.string().max(90),
  contract: addressSchema.nullable(),
  symbol: z.string().max(80),
  decimals: z.number().int().min(0).max(255).nullable(),
});
export const transferSchema = z.object({
  chainId: chainIdSchema.default(1),
  id: z.string().max(200),
  hash: hashSchema,
  block: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  from: addressSchema,
  to: addressSchema,
  category: z.enum(["external", "erc20"]),
  asset: assetSchema,
  raw: z.string().regex(/^\d+$/).max(100).nullable(),
  source: z.enum(["alchemy", "sample"]),
});
export type Transfer = z.infer<typeof transferSchema>;
export const snapshotSchema = z.object({
  chainId: chainIdSchema,
  block: z.number().int().positive(),
  hash: hashSchema,
  timestamp: z.string().datetime(),
  fromBlock: z.number().int().nonnegative(),
  start: z.string().datetime(),
  end: z.string().datetime(),
  asset: z.string().max(42),
  queryToken: z.string().max(4000),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export const pageStateSchema = z.object({
  status: z.enum(["complete", "more", "error", "limit"]),
  cursor: z.string().max(6000).nullable(),
  count: z.number().int().min(0).max(2000),
  message: z.string().max(500).nullable(),
});
export const neighborhoodSchema = z.object({
  address: addressSchema,
  transfers: z.array(transferSchema).max(2000),
  incoming: pageStateSchema,
  outgoing: pageStateSchema,
  warnings: z.array(z.string().max(500)).max(20),
});
export type Neighborhood = z.infer<typeof neighborhoodSchema>;
export const expansionSchema = z.object({
  address: addressSchema,
  active: z.boolean(),
  reveal: z.number().int().min(0).max(100),
});
export const investigationSchema = z
  .object({
    version: z.literal(1),
    id: z.string().max(100),
    title: z.string().max(100),
    mode: z.enum(["live", "sample"]),
    roots: z.array(addressSchema).min(1).max(2),
    snapshot: snapshotSchema,
    neighborhoods: z.array(neighborhoodSchema).max(100),
    expansions: z.array(expansionSchema).max(100),
    pinned: z.array(addressSchema).max(100),
    hidden: z.array(addressSchema).max(100),
    notes: z.record(z.string().max(42), z.string().max(2000)),
    positions: z.record(
      z.string().max(42),
      z.object({ x: z.number().finite(), y: z.number().finite() }),
    ),
    savedAt: z.string().datetime(),
  })
  .superRefine((value, ctx) => {
    const unique = new Set(
      value.neighborhoods.flatMap((n) => n.transfers.map((t) => t.id)),
    );
    if (
      unique.size > 10000 ||
      value.neighborhoods.reduce((n, h) => n + h.transfers.length, 0) > 20000
    )
      ctx.addIssue({
        code: "custom",
        message: "This investigation exceeds the transfer limit.",
      });
    if (
      value.mode === "live" &&
      value.neighborhoods.some((n) =>
        n.transfers.some((t) => t.source !== "alchemy"),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Sample records cannot be imported as live history.",
      });
    for (const n of value.neighborhoods)
      for (const t of n.transfers) {
        if (t.chainId !== value.snapshot.chainId)
          ctx.addIssue({
            code: "custom",
            message: "A transfer is on a different network from its snapshot.",
          });
        if (t.from !== n.address && t.to !== n.address)
          ctx.addIssue({
            code: "custom",
            message: "A transfer does not belong to its address history.",
          });
        if (
          t.block < value.snapshot.fromBlock ||
          t.block > value.snapshot.block
        )
          ctx.addIssue({
            code: "custom",
            message: "A transfer is outside the saved snapshot.",
          });
      }
  });
export type Investigation = z.infer<typeof investigationSchema>;
export type Filters = {
  asset: string;
  direction: "both" | "in" | "out";
  minimum: string;
};
export type Connection = {
  id: string;
  from: Address;
  to: Address;
  transfers: Transfer[];
};

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
export function addressId(address: string, chainId: ChainId) {
  return `${chainId}:${address.toLowerCase()}`;
}
export function allTransfers(investigation: Investigation): Transfer[] {
  return [
    ...new Map(
      investigation.neighborhoods
        .flatMap((n) => n.transfers)
        .map((t) => [t.id, t]),
    ).values(),
  ].sort(
    (a, b) =>
      b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id),
  );
}
export function formatAmount(
  raw: string | null,
  decimals: number | null,
  compact = false,
) {
  if (raw === null || decimals === null) return "Unknown amount";
  const padded = raw.padStart(decimals + 1, "0");
  const integer = decimals ? padded.slice(0, -decimals) : padded;
  const fraction = decimals ? padded.slice(-decimals) : "";
  const digits = compact ? fraction.slice(0, 6) : fraction;
  const trimmed = digits.replace(/0+$/, "");
  return `${BigInt(integer).toLocaleString("en-US")}${trimmed ? `.${trimmed}` : ""}${compact && /[1-9]/.test(fraction.slice(6)) ? "…" : ""}`;
}
export function parseUnitsExact(
  input: string,
  decimals: number,
): bigint | null {
  if (!/^\d+(\.\d*)?$/.test(input)) return null;
  const [whole, fraction = ""] = input.split(".");
  if (fraction.length > decimals) return null;
  return BigInt(`${whole}${fraction.padEnd(decimals, "0")}`);
}
export function matchesTransfer(t: Transfer, filters: Filters, root: Address) {
  if (filters.asset !== "all" && t.asset.id !== filters.asset) return false;
  if (filters.direction === "in" && t.to !== root) return false;
  if (filters.direction === "out" && t.from !== root) return false;
  if (filters.minimum && filters.asset !== "all") {
    if (t.raw === null || t.asset.decimals === null) return false;
    const minimum = parseUnitsExact(filters.minimum, t.asset.decimals);
    if (minimum === null || BigInt(t.raw) < minimum) return false;
  }
  return true;
}
export function aggregate(transfers: Transfer[]): Connection[] {
  const connections = new Map<string, Connection>();
  for (const t of new Map(transfers.map((t) => [t.id, t])).values()) {
    const id = `${addressId(t.from, t.chainId)}>${addressId(t.to, t.chainId)}`;
    const c = connections.get(id) ?? {
      id,
      from: t.from,
      to: t.to,
      transfers: [],
    };
    c.transfers.push(t);
    connections.set(id, c);
  }
  return [...connections.values()].map((c) => ({
    ...c,
    transfers: c.transfers.sort(
      (a, b) =>
        b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id),
    ),
  }));
}
export function assetTotals(transfers: Transfer[]) {
  const totals = new Map<
    string,
    { asset: Transfer["asset"]; raw: bigint; unknown: number }
  >();
  for (const t of transfers) {
    const sum = totals.get(t.asset.id) ?? {
      asset: t.asset,
      raw: 0n,
      unknown: 0,
    };
    if (
      t.raw === null ||
      t.asset.decimals === null ||
      t.asset.decimals !== sum.asset.decimals
    )
      sum.unknown++;
    else sum.raw += BigInt(t.raw);
    totals.set(t.asset.id, sum);
  }
  return [...totals.values()];
}
export function counterparties(transfers: Transfer[], address: Address) {
  const counts = new Map<Address, { count: number; last: string }>();
  for (const t of new Map(transfers.map((t) => [t.id, t])).values()) {
    const other = t.from === address ? t.to : t.to === address ? t.from : null;
    if (other === null) continue;
    const c = counts.get(other) ?? { count: 0, last: "" };
    c.count++;
    c.last = t.timestamp > c.last ? t.timestamp : c.last;
    counts.set(other, c);
  }
  return [...counts]
    .sort(
      (a, b) =>
        b[1].count - a[1].count ||
        b[1].last.localeCompare(a[1].last) ||
        a[0].localeCompare(b[0]),
    )
    .map(([address]) => address);
}

function graphDepths(roots: Address[], connections: Connection[]) {
  const adjacent = new Map<Address, Address[]>();
  for (const { from, to } of connections) {
    const fromNeighbors = adjacent.get(from) ?? [];
    const toNeighbors = adjacent.get(to) ?? [];
    fromNeighbors.push(to);
    toNeighbors.push(from);
    adjacent.set(from, fromNeighbors);
    adjacent.set(to, toNeighbors);
  }
  const depths = new Map(roots.map((root) => [root, 0]));
  const queue = [...roots];
  for (const address of queue) {
    const depth = depths.get(address) ?? 0;
    for (const neighbor of adjacent.get(address) ?? []) {
      if (depths.has(neighbor)) continue;
      depths.set(neighbor, depth + 1);
      queue.push(neighbor);
    }
  }
  return depths;
}

export function graphData(investigation: Investigation, filters: Filters) {
  const root = investigation.roots[0];
  if (!root)
    return {
      nodes: [],
      connections: [],
      depths: new Map<Address, number>(),
      hiddenCount: 0,
      shared: new Set<Address>(),
      transfers: [],
    };
  const transfers = allTransfers(investigation).filter((t) =>
    matchesTransfer(t, filters, root),
  );
  const nodes = new Set<Address>(
    [...investigation.roots, ...investigation.pinned].slice(0, 100),
  );
  let hiddenCount = 0;
  for (const expansion of investigation.expansions.filter((e) => e.active)) {
    const neighborhood = investigation.neighborhoods.find(
      (n) => n.address === expansion.address,
    );
    const candidates = counterparties(
      (neighborhood?.transfers ?? []).filter((t) =>
        matchesTransfer(t, filters, root),
      ),
      expansion.address,
    );
    if (nodes.size < 100) nodes.add(expansion.address);
    for (const candidate of candidates.slice(0, expansion.reveal))
      if (nodes.size < 100) nodes.add(candidate);
    hiddenCount += Math.max(0, candidates.length - expansion.reveal);
  }
  for (const hidden of investigation.hidden)
    if (
      !investigation.roots.includes(hidden) &&
      !investigation.pinned.includes(hidden)
    )
      nodes.delete(hidden);
  const connections = aggregate(transfers)
    .filter((c) => nodes.has(c.from) && nodes.has(c.to))
    .sort((a, b) => b.transfers.length - a.transfers.length);
  const second = investigation.roots[1];
  const firstSet = new Set(counterparties(transfers, root));
  const shared = new Set(
    second
      ? counterparties(transfers, second).filter(
          (a) => firstSet.has(a) && a !== root && a !== second,
        )
      : [],
  );
  const visibleConnections = connections.slice(0, 300);
  return {
    nodes: [...nodes].slice(0, 100),
    connections: visibleConnections,
    depths: graphDepths(investigation.roots, visibleConnections),
    hiddenCount: hiddenCount + Math.max(0, connections.length - 300),
    shared,
    transfers,
  };
}
export function mergeNeighborhood(
  investigation: Investigation,
  next: Neighborhood,
): Investigation {
  const existing = investigation.neighborhoods.find(
    (n) => n.address === next.address,
  );
  const transfers = [
    ...new Map(
      [...(existing?.transfers ?? []), ...next.transfers].map((t) => [t.id, t]),
    ).values(),
  ];
  const incoming =
    (existing?.incoming.status === "complete" ||
      existing?.incoming.status === "limit") &&
    next.incoming.count === 0
      ? existing.incoming
      : next.incoming;
  const outgoing =
    (existing?.outgoing.status === "complete" ||
      existing?.outgoing.status === "limit") &&
    next.outgoing.count === 0
      ? existing.outgoing
      : next.outgoing;
  const neighborhoods = [
    ...investigation.neighborhoods.filter((n) => n.address !== next.address),
    { ...next, incoming, outgoing, transfers },
  ];
  if (
    new Set(neighborhoods.flatMap((n) => n.transfers.map((t) => t.id))).size >
    10000
  )
    throw new Error(
      "Investigation limit reached. Narrow the date range or choose an asset.",
    );
  return { ...investigation, neighborhoods };
}
export function csvExport(transfers: Transfer[]) {
  const cell = (s: string) =>
    `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replaceAll('"', '""')}"`;
  const rows = transfers.map((t) => [
    t.chainId.toString(),
    t.timestamp,
    t.from,
    t.to,
    t.asset.symbol,
    t.asset.contract ?? "native",
    t.raw ?? "",
    t.asset.decimals?.toString() ?? "",
    formatAmount(t.raw, t.asset.decimals),
    t.hash,
    t.category,
    t.source,
  ]);
  return [
    [
      "chain_id",
      "timestamp_utc",
      "from",
      "to",
      "symbol",
      "asset_contract",
      "raw_amount",
      "decimals",
      "formatted_amount",
      "transaction_hash",
      "category",
      "source",
    ],
    ...rows,
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
