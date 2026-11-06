import {
  addressSchema,
  type Investigation,
  type Transfer,
  type Neighborhood,
} from "./domain";

export const SAMPLE_ROOT = addressSchema.parse(
  "0x1111111111111111111111111111111111111111",
);
export const SAMPLE_SECOND = addressSchema.parse(
  "0x2222222222222222222222222222222222222222",
);
const addresses = Array.from({ length: 16 }, (_, i) =>
  addressSchema.parse(`0x${(i + 1).toString(16).repeat(40).slice(0, 40)}`),
);
const eth = { id: "1:native", contract: null, symbol: "ETH", decimals: 18 };
const token = {
  id: "1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  contract: addressSchema.parse("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
  symbol: "DEMO",
  decimals: 6,
};
const pairs = [
  [0, 2],
  [0, 3],
  [4, 0],
  [0, 5],
  [6, 0],
  [0, 7],
  [8, 0],
  [0, 9],
  [0, 10],
  [11, 0],
  [2, 3],
  [2, 12],
  [13, 2],
  [3, 14],
  [5, 15],
  [1, 3],
  [1, 4],
  [1, 7],
  [9, 1],
  [2, 0],
  [0, 2],
  [0, 3],
  [0, 2],
  [4, 0],
  [1, 3],
  [7, 0],
  [5, 0],
  [0, 5],
  [0, 7],
  [1, 7],
];
export const sampleTransfers: Transfer[] = pairs.flatMap(([f, t], i) => {
  const from = addresses[f ?? 0],
    to = addresses[t ?? 0];
  if (!from || !to) return [];
  const asset = i % 3 ? eth : token;
  return [
    {
      chainId: 1,
      id: `1:sample:${i}`,
      hash: `0x${(i + 1).toString(16).padStart(64, "0")}`,
      block: 23800000 + i,
      timestamp: new Date(
        Date.UTC(2026, 9, 5 + i, 10, (i * 7) % 60),
      ).toISOString(),
      from,
      to,
      category: asset.contract ? "erc20" : "external",
      asset,
      raw: (
        BigInt((i % 7) + 1) *
        (asset.decimals === 18 ? 125000000000000000n : 250000000n)
      ).toString(),
      source: "sample",
    },
  ];
});
export function sampleNeighborhood(
  address: Neighborhood["address"],
): Neighborhood {
  const transfers = sampleTransfers.filter(
    (t) => t.from === address || t.to === address,
  );
  const state = {
    status: "complete",
    cursor: null,
    count: transfers.length,
    message: null,
  } satisfies Neighborhood["incoming"];
  return {
    address,
    transfers,
    incoming: {
      ...state,
      count: transfers.filter((t) => t.to === address).length,
    },
    outgoing: {
      ...state,
      count: transfers.filter((t) => t.from === address).length,
    },
    warnings: [],
  };
}
export function sampleInvestigation(): Investigation {
  return {
    version: 1,
    id: crypto.randomUUID(),
    title: "Sample investigation",
    mode: "sample",
    roots: [SAMPLE_ROOT],
    snapshot: {
      chainId: 1,
      block: 23800100,
      hash: `0x${"0".repeat(64)}`,
      timestamp: "2026-11-04T12:00:00.000Z",
      fromBlock: 23700000,
      start: "2026-10-05T00:00:00.000Z",
      end: "2026-11-04T12:00:00.000Z",
      asset: "all",
      queryToken: "sample",
    },
    neighborhoods: [sampleNeighborhood(SAMPLE_ROOT)],
    expansions: [{ address: SAMPLE_ROOT, active: true, reveal: 20 }],
    pinned: [],
    hidden: [],
    notes: {},
    positions: {},
    savedAt: new Date().toISOString(),
  };
}
