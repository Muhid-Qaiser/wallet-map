import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { transferPage } from "../../src/lib/server/alchemy";
import {
  AppError,
  readToken,
  signToken,
} from "../../src/lib/server/infrastructure";
import { z } from "zod";
import { addressSchema } from "../../src/lib/domain";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("provider and token boundaries", () => {
  it("removes failed external ETH transfers before building graph evidence", async () => {
    vi.stubEnv("ALCHEMY_API_KEY", "test-key");
    const hash = `0x${"a".repeat(64)}`;
    const from = addressSchema.parse(`0x${"1".repeat(40)}`),
      to = addressSchema.parse(`0x${"2".repeat(40)}`);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          result: {
            transfers: [
              {
                uniqueId: `${hash}:external`,
                hash,
                blockNum: "0x1234",
                from,
                to,
                category: "external",
                asset: "ETH",
                rawContract: {
                  value: "0xde0b6b3a7640000",
                  address: null,
                  decimal: "0x12",
                },
                metadata: { blockTimestamp: "2026-11-01T00:00:00.000Z" },
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json([{ result: { transactionHash: hash, status: "0x0" } }]),
      );
    vi.stubGlobal("fetch", fetch);
    const result = await transferPage({
      chainId: 1,
      address: from,
      direction: "outgoing",
      fromBlock: 4000,
      toBlock: 5000,
      asset: "native",
      pageKey: null,
      maxCount: 250,
      snapshotHash: hash,
    });
    expect(result.transfers).toEqual([]);
    expect(result.fetched).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("routes ERC-20 history to the selected network and keeps identical queries separate", async () => {
    vi.stubEnv("ALCHEMY_API_KEY", "test-key");
    const hash = `0x${"b".repeat(64)}`;
    const from = addressSchema.parse(`0x${"1".repeat(40)}`);
    const to = addressSchema.parse(`0x${"2".repeat(40)}`);
    const contract = addressSchema.parse(`0x${"3".repeat(40)}`);
    const fetch = vi
      .fn<(url: string) => Promise<Response>>()
      .mockImplementation(async () =>
        Response.json({
          result: {
            transfers: [
              {
                uniqueId: `${hash}:log:2`,
                hash,
                blockNum: "0x1234",
                from,
                to,
                category: "erc20",
                asset: "USDC",
                rawContract: {
                  value: "0x1312d00",
                  address: contract,
                  decimal: "0x6",
                },
                metadata: { blockTimestamp: "2026-11-01T00:00:00.000Z" },
              },
            ],
          },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const query = {
      address: from,
      direction: "outgoing",
      fromBlock: 4000,
      toBlock: 5000,
      asset: "all",
      pageKey: null,
      maxCount: 250,
      snapshotHash: hash,
    } satisfies Omit<Parameters<typeof transferPage>[0], "chainId">;
    const base = await transferPage({ ...query, chainId: 84532 });
    const ethereum = await transferPage({ ...query, chainId: 1 });
    expect(fetch.mock.calls.map(([url]) => new URL(url).hostname)).toEqual([
      "base-sepolia.g.alchemy.com",
      "eth-mainnet.g.alchemy.com",
    ]);
    expect(base.transfers[0]).toMatchObject({
      chainId: 84532,
      raw: "20000000",
      asset: { id: `84532:${contract}`, decimals: 6 },
    });
    expect(ethereum.transfers[0]).toMatchObject({
      chainId: 1,
      asset: { id: `1:${contract}` },
    });
    expect(base.transfers[0]?.id).not.toEqual(ethereum.transfers[0]?.id);
  });
  it("rejects tampered query tokens", () => {
    const schema = z.object({ value: z.number() });
    const token = signToken({ value: 10 });
    expect(readToken(token, schema)).toEqual({ value: 10 });
    expect(() => readToken(`x${token}`, schema)).toThrow(AppError);
  });
});
