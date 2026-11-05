import { describe, expect, it } from "vitest";
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
  parseUnitsExact,
  type Transfer,
} from "../../src/lib/domain";
import {
  sampleInvestigation,
  sampleNeighborhood,
  SAMPLE_ROOT,
  SAMPLE_SECOND,
  sampleTransfers,
} from "../../src/lib/sample";

const filters = {
  asset: "all",
  direction: "both",
  minimum: "",
} satisfies Parameters<typeof graphData>[1];
const first = () => {
  const t = sampleTransfers[0];
  if (!t) throw new Error("Missing fixture");
  return t;
};

describe("exact amounts and event identity", () => {
  it("formats integers beyond JavaScript's safe integer range without rounding", () => {
    expect(formatAmount("123456789012345678901234567890", 18)).toBe(
      "123,456,789,012.34567890123456789",
    );
    expect(parseUnitsExact("123456789012.34567890123456789", 18)).toBe(
      123456789012345678901234567890n,
    );
    expect(parseUnitsExact("0.0000001", 6)).toBeNull();
  });
  it("keeps unknown decimals and amounts explicit", () => {
    expect(formatAmount("100", null)).toBe("Unknown amount");
    expect(formatAmount(null, 18)).toBe("Unknown amount");
  });
  it("deduplicates events while retaining multiple events in one transaction", () => {
    const t = first();
    const second = { ...t, id: `${t.id}:log:2` };
    const grouped = aggregate([t, t, second]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.transfers).toHaveLength(2);
  });
  it("does not combine assets with identical symbols", () => {
    const t = first();
    const second = {
      ...t,
      id: "other",
      asset: { ...t.asset, id: "other-token" },
      raw: "500",
    };
    expect(assetTotals([t, second])).toHaveLength(2);
  });
  it("counts a self-transfer once when discovered in both directions", () => {
    const t = { ...first(), from: SAMPLE_ROOT, to: SAMPLE_ROOT };
    const grouped = aggregate([t, t]);
    expect(grouped[0]?.transfers).toHaveLength(1);
  });
});
describe("exploration and evidence", () => {
  it("starts with a validated portable investigation", () => {
    expect(investigationSchema.safeParse(sampleInvestigation()).success).toBe(
      true,
    );
  });
  it("repeated expansion converges to the same records and totals", () => {
    const start = sampleInvestigation();
    const once = mergeNeighborhood(start, sampleNeighborhood(SAMPLE_ROOT));
    const twice = mergeNeighborhood(once, sampleNeighborhood(SAMPLE_ROOT));
    expect(allTransfers(twice)).toEqual(allTransfers(start));
    expect(graphData(twice, filters).connections).toEqual(
      graphData(start, filters).connections,
    );
  });
  it("finds shared counterparties even when the canvas reveal limit hides them", () => {
    const i = mergeNeighborhood(
      sampleInvestigation(),
      sampleNeighborhood(SAMPLE_SECOND),
    );
    i.roots.push(SAMPLE_SECOND);
    i.expansions = i.roots.map((address) => ({
      address,
      active: true,
      reveal: 0,
    }));
    const data = graphData(i, filters);
    expect(data.nodes).toHaveLength(2);
    expect(data.shared.size).toBeGreaterThan(0);
  });
  it("filters directed evidence relative to the starting address", () => {
    const i = sampleInvestigation();
    const data = graphData(i, { ...filters, direction: "in" });
    expect(data.transfers.length).toBeGreaterThan(0);
    expect(data.transfers.every((t) => t.to === SAMPLE_ROOT)).toBe(true);
  });
  it("filters per-transfer amounts using exact quantities", () => {
    const i = sampleInvestigation();
    const data = graphData(i, {
      ...filters,
      asset: "1:native",
      minimum: "0.5",
    });
    expect(data.transfers.length).toBeGreaterThan(0);
    expect(
      data.transfers.every(
        (t) => t.raw !== null && BigInt(t.raw) >= 500000000000000000n,
      ),
    ).toBe(true);
  });
  it("retains independently expanded nodes when a different expansion collapses", () => {
    const other = first().to;
    const i = mergeNeighborhood(
      sampleInvestigation(),
      sampleNeighborhood(other),
    );
    i.expansions.push({ address: other, active: true, reveal: 20 });
    i.expansions = i.expansions.map((e) =>
      e.address === SAMPLE_ROOT ? { ...e, active: false } : e,
    );
    const data = graphData(i, filters);
    expect(data.nodes).toContain(other);
    expect(data.nodes).toContain(SAMPLE_ROOT);
    expect(data.connections.length).toBeGreaterThan(0);
  });
  it("preserves completed direction counts when paging the other direction", () => {
    const i = sampleInvestigation();
    const n = sampleNeighborhood(SAMPLE_ROOT);
    const next = { ...n, transfers: [], incoming: { ...n.incoming, count: 0 } };
    expect(mergeNeighborhood(i, next).neighborhoods[0]?.incoming.count).toBe(
      n.incoming.count,
    );
  });
});
describe("import and export boundaries", () => {
  it("preserves a capped direction while the other direction pages", () => {
    const i = sampleInvestigation();
    const n = i.neighborhoods[0];
    if (!n) throw new Error("Missing fixture");
    n.incoming = {
      status: "limit",
      count: 1000,
      cursor: null,
      message: "History cap reached",
    };
    const next = {
      ...n,
      transfers: [],
      incoming: { status: "complete", count: 0, cursor: null, message: null },
    } satisfies Parameters<typeof mergeNeighborhood>[1];
    expect(mergeNeighborhood(i, next).neighborhoods[0]?.incoming.status).toBe(
      "limit",
    );
  });
  it("rejects invalid addresses and malformed imports", () => {
    expect(addressSchema.safeParse("0x123").success).toBe(false);
    expect(investigationSchema.safeParse({ version: 2 }).success).toBe(false);
  });
  it("rejects sample records labeled as live evidence", () => {
    const i = sampleInvestigation();
    i.mode = "live";
    expect(investigationSchema.safeParse(i).success).toBe(false);
  });
  it("rejects records outside the investigation snapshot", () => {
    const i = sampleInvestigation();
    i.snapshot.block = 10;
    expect(investigationSchema.safeParse(i).success).toBe(false);
  });
  it("escapes quotes and spreadsheet formulas in CSV metadata", () => {
    const t: Transfer = {
      ...first(),
      asset: { ...first().asset, symbol: '=HYPERLINK("bad")' },
    };
    const csv = csvExport([t]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('""bad""');
    expect(csv).toContain("raw_amount");
  });
});
