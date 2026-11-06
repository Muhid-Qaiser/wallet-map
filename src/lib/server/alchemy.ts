import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  addressSchema,
  hashSchema,
  type Address,
  type Transfer,
} from "../domain";
import { networks, type ChainId } from "../networks";
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
  chainId: ChainId = 1,
): Promise<unknown> {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key)
    throw new AppError("Alchemy API key is missing.", 503, "CONFIGURATION");
  for (let attempt = 0; attempt < 2; attempt++) {
    await reserveUpstream(weight);
    let response: Response;
    try {
      response = await fetch(
        `https://${networks[chainId].alchemy}.g.alchemy.com/v2/${encodeURIComponent(key)}`,
        {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(5000),
          cache: "no-store",
        },
      );
    } catch {
      if (attempt === 0) continue;
      throw new AppError(
        `The ${networks[chainId].name} data provider did not respond. Try again.`,
      );
    }
    if ((response.status === 429 || response.status >= 500) && attempt === 0) {
      const retryAfter = response.headers.get("Retry-After") ?? "0";
      const seconds = Number(retryAfter);
      const wait = Number.isFinite(seconds)
        ? seconds * 1000
        : Date.parse(retryAfter) - Date.now();
      if (wait <= 1500) {
        const backoff =
          response.status === 429 ? 1000 + Math.random() * 250 : 250;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(wait, backoff)),
        );
        continue;
      }
    }
    if (response.status === 429) {
      throw new AppError(
        `Alchemy is rate limiting ${networks[chainId].name}. Retry in a moment.`,
        429,
        "PROVIDER_LIMIT",
      );
    }
    if (!response.ok)
      throw new AppError(
        response.status === 401 || response.status === 403
          ? `The Alchemy key was rejected. Check ${networks[chainId].name} access in your provider dashboard.`
          : `Alchemy returned HTTP ${response.status} on ${networks[chainId].name}. Retry this address in a moment.`,
        502,
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
  chainId: ChainId = 1,
): Promise<T> {
  const parsed = envelope.parse(
    await transport({ jsonrpc: "2.0", id: 1, method, params }, 1, chainId),
  );
  if (parsed.error?.code === 429) {
    throw new AppError(
      `Alchemy is rate limiting ${networks[chainId].name}. Retry in a moment.`,
      429,
      "PROVIDER_LIMIT",
    );
  }
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
export function getBlock(tag: string, chainId: ChainId) {
  return cached(
    `wm:block:${chainId}:${tag}`,
    blockSchema,
    () => rpc("eth_getBlockByNumber", [tag, false], blockSchema, chainId),
    tag === "finalized" ? 60 : 86400,
  );
}
export async function firstBlockAt(
  timestamp: number,
  upper: number,
  chainId: ChainId,
  upperTimestamp: number,
): Promise<number> {
  let low = 0,
    high = upper;
  let anchorBlock = upper;
  let anchorTime = upperTimestamp;
  let blockSeconds = chainId === 8453 || chainId === 84532 ? 2 : 12;
  const blockTime = async (number: number) =>
    Number(
      BigInt((await getBlock(`0x${number.toString(16)}`, chainId)).timestamp),
    );

  // Use cadence to guess a nearby block. Check actual timestamps to certify the boundary.
  for (let attempt = 0; attempt < 3 && low < high; attempt++) {
    const guess = Math.max(
      low,
      Math.min(
        high - 1,
        anchorBlock + Math.ceil((timestamp - anchorTime) / blockSeconds),
      ),
    );
    const [time, previous] = await Promise.all([
      blockTime(guess),
      guess > low ? blockTime(guess - 1) : Promise.resolve(-Infinity),
    ]);
    if (previous < timestamp && time >= timestamp) return guess;
    if (time < timestamp) low = guess + 1;
    else high = guess - 1;

    const observedStep = (time - anchorTime) / (guess - anchorBlock);
    if (Number.isFinite(observedStep) && observedStep > 0)
      blockSeconds = observedStep;
    anchorBlock = guess;
    anchorTime = time;
  }
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((await blockTime(mid)) < timestamp) low = mid + 1;
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
  transfers: z.array(z.unknown()).max(250),
  pageKey: z.string().max(1000).optional(),
});
export function normalizeTransfer(
  value: z.infer<typeof providerTransferSchema>,
  chainId: ChainId,
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
    chainId,
    id: `${chainId}:${value.uniqueId}`,
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
          ? `${chainId}:native`
          : `${chainId}:${value.rawContract.address?.toLowerCase()}`,
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
async function successfulExternal(hashes: string[], chainId: ChainId) {
  const successful = new Set<string>();
  for (let offset = 0; offset < hashes.length; offset += 50) {
    const group = hashes.slice(offset, offset + 50);
    try {
      const receipts = await cached(
        `wm:receipts:${chainId}:${createHash("sha256").update(group.join(",")).digest("hex")}`,
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
              chainId,
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
    } catch (error) {
      const detail = error instanceof AppError ? ` ${error.message}` : "";
      return {
        successful,
        verificationWarning: `Some ETH transfers still need receipt verification.${detail}`,
      };
    }
  }
  return { successful, verificationWarning: null };
}
export async function transferPage(params: {
  chainId: ChainId;
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
    chainId,
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
  const cacheKey = `wm:history:${chainId}:${createHash("sha256")
    .update(JSON.stringify({ ...request, snapshotHash }))
    .digest("hex")}`;
  const raw = await cached(
    cacheKey,
    providerPageSchema,
    () =>
      rpc("alchemy_getAssetTransfers", [request], providerPageSchema, chainId),
    480,
  );
  let unreadable = 0;
  const transfers = raw.transfers.flatMap((t) => {
    const parsed = providerTransferSchema.safeParse(t);
    if (!parsed.success) {
      unreadable++;
      return [];
    }
    try {
      const transfer = normalizeTransfer(parsed.data, chainId);
      return transfer ? [transfer] : [];
    } catch {
      unreadable++;
      return [];
    }
  });
  const external = [
    ...new Set(
      transfers.filter((t) => t.category === "external").map((t) => t.hash),
    ),
  ];
  const { successful, verificationWarning } = await successfulExternal(
    external,
    chainId,
  );
  return {
    transfers: transfers.filter(
      (t) => t.category !== "external" || successful.has(t.hash.toLowerCase()),
    ),
    pageKey: raw.pageKey || null,
    fetched: raw.transfers.length,
    warning:
      [
        unreadable
          ? `Some ${networks[chainId].name} transfer records could not be read.`
          : null,
        verificationWarning,
      ]
        .filter(Boolean)
        .join(" ") || null,
  };
}
