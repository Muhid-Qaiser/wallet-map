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

afterEach(() => vi.unstubAllGlobals());
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
    vi.unstubAllEnvs();
  });
  it("rejects tampered query tokens", () => {
    const schema = z.object({ value: z.number() });
    const token = signToken({ value: 10 });
    expect(readToken(token, schema)).toEqual({ value: 10 });
    expect(() => readToken(`x${token}`, schema)).toThrow(AppError);
  });
});
