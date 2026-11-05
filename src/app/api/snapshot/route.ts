import { z } from "zod";
import { addressSchema } from "@/lib/domain";
import { firstBlockAt, getBlock } from "@/lib/server/alchemy";
import {
  AppError,
  errorResponse,
  guardRequest,
  requestJson,
  signToken,
} from "@/lib/server/infrastructure";

export const runtime = "nodejs";
export const maxDuration = 60;
const input = z.object({
  address: addressSchema,
  start: z.string().datetime(),
  end: z.string().datetime(),
  asset: z
    .union([z.literal("all"), z.literal("native"), addressSchema])
    .default("all"),
});
export async function POST(request: Request) {
  try {
    const body = input.parse(await requestJson(request));
    const start = Date.parse(body.start),
      end = Date.parse(body.end);
    if (
      start >= end ||
      end - start > 90 * 86400000 ||
      start < Date.UTC(2015, 6, 30)
    )
      throw new AppError(
        "Choose a valid date range of up to 90 days.",
        400,
        "VALIDATION",
      );
    await guardRequest(request);
    const finalized = await getBlock("finalized");
    const finalizedNumber = Number(BigInt(finalized.number));
    const finalizedTime = Number(BigInt(finalized.timestamp)) * 1000;
    const effectiveEnd = Math.min(end, finalizedTime + 1000);
    if (start >= effectiveEnd)
      throw new AppError(
        "This date range is newer than the finalized chain. Choose an earlier start.",
        400,
        "VALIDATION",
      );
    const [fromBlock, endBoundary] = await Promise.all([
      firstBlockAt(Math.ceil(start / 1000), finalizedNumber),
      end > finalizedTime
        ? Promise.resolve(finalizedNumber + 1)
        : firstBlockAt(Math.ceil(end / 1000), finalizedNumber),
    ]);
    const blockNumber = endBoundary - 1;
    if (blockNumber < fromBlock)
      throw new AppError(
        "No finalized blocks in this date range.",
        400,
        "VALIDATION",
      );
    const block =
      blockNumber === finalizedNumber
        ? finalized
        : await getBlock(`0x${blockNumber.toString(16)}`);
    return Response.json({
      chainId: 1,
      block: blockNumber,
      hash: block.hash,
      timestamp: new Date(Number(BigInt(block.timestamp)) * 1000).toISOString(),
      fromBlock,
      start: body.start,
      end: new Date(effectiveEnd).toISOString(),
      asset: body.asset,
      queryToken: signToken({
        kind: "query",
        chainId: 1,
        fromBlock,
        block: blockNumber,
        hash: block.hash,
        asset: body.asset,
        expires: Date.now() + 86400000,
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
