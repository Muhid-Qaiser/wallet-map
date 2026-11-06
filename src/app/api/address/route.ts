import { z } from "zod";
import { addressSchema } from "@/lib/domain";
import { rpc } from "@/lib/server/alchemy";
import {
  cached,
  errorResponse,
  guardRequest,
  requestJson,
} from "@/lib/server/infrastructure";
import { readQuery } from "@/lib/server/query";

export const runtime = "nodejs";
const input = z.object({
  address: addressSchema,
  queryToken: z.string().max(4000),
});
export async function POST(request: Request) {
  try {
    const body = input.parse(await requestJson(request));
    await guardRequest(request);
    const query = readQuery(body.queryToken);
    const raw = await cached(
      `wm:balance:${query.chainId}:${body.address}:${query.hash}`,
      z.string(),
      async () =>
        BigInt(
          await rpc(
            "eth_getBalance",
            [body.address, `0x${query.block.toString(16)}`],
            z.string().regex(/^0x[0-9a-fA-F]+$/),
            query.chainId,
          ),
        ).toString(),
    );
    return Response.json({ raw, decimals: 18, block: query.block });
  } catch (error) {
    return errorResponse(error);
  }
}
