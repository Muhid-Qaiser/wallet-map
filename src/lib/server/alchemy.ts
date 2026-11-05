import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  addressSchema,
  hashSchema,
  type Address,
  type Transfer,
} from "../domain";
import { AppError, cached, reserveUpstream } from "./infrastructure";

const envelope = z.object({
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
const hex = z.string().regex(/^0x[0-9a-fA-F]+$/);
const blockSchema = z.object({ number: hex, hash: hashSchema, timestamp: hex });
export async function transport(
  body: object | object[],
  weight = 1,
): Promise<unknown> {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key)
    throw new AppError("Alchemy API key is missing.", 503, "CONFIGURATION");
  for (let attempt = 0; attempt < 3; attempt++) {
    await reserveUpstream(weight);
    let response: Response;
    try {
      response = await fetch(
        `https://eth-mainnet.g.alchemy.com/v2/${encodeURIComponent(key)}`,
        {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(8000),
          cache: "no-store",
        },
      );
    } catch {
      if (attempt < 2) continue;
      throw new AppError(
        "The Ethereum data provider did not respond. Try again.",
      );
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const wait = Number(response.headers.get("Retry-After") ?? "0");
      if (wait > 2)
        throw new AppError(
          "The data provider is busy. Try again shortly.",
          429,
          "PROVIDER_LIMIT",
        );
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(wait * 1000, 250 * 2 ** attempt)),
      );
      continue;
    }
    if (!response.ok)
      throw new AppError(
        response.status === 401 || response.status === 403
          ? "The Alchemy key was rejected. Check Ethereum mainnet access in your provider dashboard."
          : "The Ethereum data provider returned an error.",
        response.status === 429 ? 429 : 502,
      );
    try {
      return await response.json();
    } catch {
      throw new AppError("The data provider returned an invalid response.");
    }
  }
  throw new AppError("The data provider is unavailable.");
}
export async function rpc<T>(
  method: string,
  params: unknown[],
  schema: z.ZodType<T>,
): Promise<T> {
  const parsed = envelope.parse(
    await transport({ jsonrpc: "2.0", id: 1, method, params }),
  );
  if (parsed.error)
    throw new AppError(
      "The provider could not serve this query. Check your key, network access, and request limits.",
    );
  const result = schema.safeParse(parsed.result);
  if (!result.success)
    throw new AppError(
      "The provider returned incomplete data. Try this query again.",
    );
  return result.data;
}
export function getBlock(tag: string) {
  return cached(
    `wm:block:${tag}`,
    blockSchema,
    () => rpc("eth_getBlockByNumber", [tag, false], blockSchema),
    tag === "finalized" ? 60 : 86400,
  );
}
export async function firstBlockAt(
  timestamp: number,
  upper: number,
): Promise<number> {
  let low = 0,
    high = upper;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const block = await getBlock(`0x${mid.toString(16)}`);
    if (Number(BigInt(block.timestamp)) < timestamp) low = mid + 1;
    else high = mid;
  }
  return low;
}
const providerTransferSchema = z.object({
  uniqueId: z.string().max(160),
  hash: hashSchema,
  blockNum: hex,
  from: addressSchema,
  to: addressSchema.nullable(),
  category: z.enum(["external", "erc20"]),
  asset: z.string().max(80).nullable(),
  rawContract: z.object({
    value: hex.nullable(),
    address: addressSchema.nullable(),
    decimal: hex.nullable(),
  }),
  metadata: z.object({ blockTimestamp: z.string().datetime() }),
});
const providerPageSchema = z.object({
  transfers: z.array(providerTransferSchema).max(250),
  pageKey: z.string().max(1000).optional(),
});
export function normalizeTransfer(
  value: z.infer<typeof providerTransferSchema>,
): Transfer | null {
  if (!value.to) return null;
  const decimals =
    value.category === "external"
      ? 18
      : value.rawContract.decimal
        ? Number(BigInt(value.rawContract.decimal))
        : null;
  if (decimals !== null && (decimals < 0 || decimals > 255))
    throw new AppError("The provider returned invalid token decimals.");
  if (value.category === "erc20" && !value.rawContract.address) return null;
  return {
    id: `1:${value.uniqueId}`,
    hash: value.hash,
    block: Number(BigInt(value.blockNum)),
    timestamp: value.metadata.blockTimestamp,
    from: value.from,
    to: value.to,
    category: value.category,
    source: "alchemy",
    raw:
      value.rawContract.value === null
        ? null
        : BigInt(value.rawContract.value).toString(),
    asset: {
      id:
        value.category === "external"
          ? "1:native"
          : `1:${value.rawContract.address?.toLowerCase()}`,
      contract: value.rawContract.address,
      symbol: value.asset ?? "Unknown token",
      decimals,
    },
  };
}
const receiptSchema = z.object({
  transactionHash: hashSchema,
  status: z.enum(["0x0", "0x1"]),
});
async function successfulExternal(hashes: string[]): Promise<Set<string>> {
  const successful = new Set<string>();
  for (let offset = 0; offset < hashes.length; offset += 50) {
    const group = hashes.slice(offset, offset + 50);
    const receipts = await cached(
      `wm:receipts:${createHash("sha256").update(group.join(",")).digest("hex")}`,
      z.array(receiptSchema),
      async () => {
        const response = z.array(envelope).parse(
          await transport(
            group.map((hash, id) => ({
              jsonrpc: "2.0",
              id,
              method: "eth_getTransactionReceipt",
              params: [hash],
            })),
            group.length,
          ),
        );
        const parsed = response.map((r) => receiptSchema.parse(r.result));
        const returned = new Set(
          parsed.map((r) => r.transactionHash.toLowerCase()),
        );
        if (
          returned.size !== group.length ||
          group.some((hash) => !returned.has(hash.toLowerCase()))
        ) {
          throw new AppError(
            "Receipt verification was incomplete. Retry this address history.",
          );
        }
        return parsed;
      },
    );
    for (const receipt of receipts)
      if (receipt.status === "0x1")
        successful.add(receipt.transactionHash.toLowerCase());
  }
  return successful;
}
export async function transferPage(params: {
  address: Address;
  direction: "incoming" | "outgoing";
  fromBlock: number;
  toBlock: number;
  asset: string;
  pageKey: string | null;
  maxCount: number;
  snapshotHash: string;
}) {
  const {
    address,
    direction,
    fromBlock,
    toBlock,
    asset,
    pageKey,
    maxCount,
    snapshotHash,
  } = params;
  const request = {
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock: `0x${toBlock.toString(16)}`,
    [direction === "incoming" ? "toAddress" : "fromAddress"]: address,
    category:
      asset === "native"
        ? ["external"]
        : asset === "all"
          ? ["external", "erc20"]
          : ["erc20"],
    ...(asset !== "all" && asset !== "native"
      ? { contractAddresses: [asset] }
      : {}),
    excludeZeroValue: true,
    withMetadata: true,
    order: "desc",
    maxCount: `0x${maxCount.toString(16)}`,
    ...(pageKey ? { pageKey } : {}),
  };
  const cacheKey = `wm:history:${createHash("sha256")
    .update(JSON.stringify({ ...request, snapshotHash }))
    .digest("hex")}`;
  const raw = await cached(
    cacheKey,
    providerPageSchema,
    () => rpc("alchemy_getAssetTransfers", [request], providerPageSchema),
    480,
  );
  const transfers = raw.transfers.flatMap((t) => {
    const n = normalizeTransfer(t);
    return n ? [n] : [];
  });
  const external = [
    ...new Set(
      transfers.filter((t) => t.category === "external").map((t) => t.hash),
    ),
  ];
  const verified = await successfulExternal(external);
  return {
    transfers: transfers.filter(
      (t) => t.category !== "external" || verified.has(t.hash.toLowerCase()),
    ),
    pageKey: raw.pageKey || null,
    fetched: raw.transfers.length,
  };
}
