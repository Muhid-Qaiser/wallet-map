import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/explore/route";
import {
  firstBlockAt,
  getBlock,
  transferPage,
} from "../../src/lib/server/alchemy";
import { SAMPLE_ROOT, sampleNeighborhood } from "../../src/lib/sample";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/alchemy", () => ({
  firstBlockAt: vi.fn(),
  getBlock: vi.fn(),
  transferPage: vi.fn(),
}));

const search = () =>
  POST(
    new Request("http://localhost/api/explore", {
      method: "POST",
      body: JSON.stringify({
        address: SAMPLE_ROOT,
        start: "2026-11-01T00:00:00.000Z",
        end: "2026-11-06T00:00:00.000Z",
        preferredChainId: 1,
      }),
    }),
  );

beforeEach(() => {
  vi.stubEnv("ALCHEMY_API_KEY", "test-key");
  vi.mocked(firstBlockAt).mockResolvedValue(4000);
  vi.mocked(getBlock).mockResolvedValue({
    number: "0x1234",
    hash: `0x${"a".repeat(64)}`,
    timestamp: `0x${(Date.parse("2026-11-05T00:00:00Z") / 1000).toString(16)}`,
  });
});

afterEach(() => vi.unstubAllEnvs());

it("chooses more connected addresses even when the preferred network has more transfers", async () => {
  const outgoing = sampleNeighborhood(SAMPLE_ROOT).transfers.filter(
    (transfer) => transfer.from === SAMPLE_ROOT,
  );
  const distinct = [
    ...new Map(outgoing.map((transfer) => [transfer.to, transfer])).values(),
  ];
  vi.mocked(transferPage).mockImplementation(async ({ chainId, direction }) => {
    const records =
      direction === "incoming"
        ? []
        : chainId === 1
          ? [0, 1, 2].map((i) => ({ ...outgoing[0], id: `repeat-${i}` }))
          : chainId === 84532
            ? distinct.slice(0, 2)
            : [];
    const transfers = records.map((record) => ({ ...record, chainId }));
    return {
      transfers,
      pageKey: null,
      fetched: transfers.length,
      warning: null,
    };
  });
  const response = await search();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    snapshot: { chainId: 84532 },
    connections: 2,
    incomplete: [],
  });
});

it("returns available results and identifies a network that could not be checked", async () => {
  vi.mocked(transferPage).mockImplementation(async ({ chainId }) => {
    if (chainId === 8453) throw new Error("Unavailable");
    return { transfers: [], pageKey: null, fetched: 0, warning: null };
  });
  const response = await search();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    snapshot: { chainId: 1 },
    connections: 0,
    incomplete: [8453],
  });
});
