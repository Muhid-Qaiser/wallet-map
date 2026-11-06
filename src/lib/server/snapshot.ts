import "server-only";
import { z } from "zod";
import { addressSchema, type Snapshot } from "../domain";
import type { ChainId } from "../networks";
import { firstBlockAt, getBlock } from "./alchemy";
import { AppError, signToken } from "./infrastructure";

export const snapshotInput = z.object({
  address: addressSchema,
  start: z.string().datetime(),
  end: z.string().datetime(),
  asset: z
    .union([z.literal("all"), z.literal("native"), addressSchema])
    .default("all"),
});

export function validatePeriod(body: z.infer<typeof snapshotInput>) {
  const start = Date.parse(body.start);
  const end = Date.parse(body.end);
  if (
    start >= end ||
    end - start > 90 * 86400000 ||
    start < Date.UTC(2015, 6, 30)
  ) {
    throw new AppError(
      "Choose a valid date range of up to 90 days.",
      400,
      "VALIDATION",
    );
  }
  return { start, end };
}

export async function createSnapshot(
  body: z.infer<typeof snapshotInput>,
  chainId: ChainId,
  { start, end }: ReturnType<typeof validatePeriod>,
): Promise<Snapshot> {
  const finalized = await getBlock("finalized", chainId);
  const finalizedNumber = Number(BigInt(finalized.number));
  const finalizedTime = Number(BigInt(finalized.timestamp)) * 1000;
  const effectiveEnd = Math.min(end, finalizedTime + 1000);
  if (start >= effectiveEnd) {
    throw new AppError(
      "This date range is newer than the finalized chain. Choose an earlier start.",
      400,
      "VALIDATION",
    );
  }
  const [fromBlock, endBoundary] = await Promise.all([
    firstBlockAt(
      Math.ceil(start / 1000),
      finalizedNumber,
      chainId,
      finalizedTime / 1000,
    ),
    end > finalizedTime
      ? Promise.resolve(finalizedNumber + 1)
      : firstBlockAt(
          Math.ceil(end / 1000),
          finalizedNumber,
          chainId,
          finalizedTime / 1000,
        ),
  ]);
  const blockNumber = endBoundary - 1;
  if (blockNumber < fromBlock) {
    throw new AppError(
      "No finalized blocks in this date range.",
      400,
      "VALIDATION",
    );
  }
  const block =
    blockNumber === finalizedNumber
      ? finalized
      : await getBlock(`0x${blockNumber.toString(16)}`, chainId);
  return {
    chainId,
    block: blockNumber,
    hash: block.hash,
    timestamp: new Date(Number(BigInt(block.timestamp)) * 1000).toISOString(),
    fromBlock,
    start: body.start,
    end: new Date(effectiveEnd).toISOString(),
    asset: body.asset,
    queryToken: signToken({
      kind: "query",
      chainId,
      fromBlock,
      block: blockNumber,
      hash: block.hash,
      asset: body.asset,
      expires: Date.now() + 86400000,
    }),
  };
}
