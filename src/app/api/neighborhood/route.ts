import { z } from "zod";
import { addressSchema } from "@/lib/domain";
import {
  errorResponse,
  guardRequest,
  requestJson,
} from "@/lib/server/infrastructure";
import { neighborhood } from "@/lib/server/query";

export const runtime = "nodejs";
export const maxDuration = 60;
const input = z.object({
  address: addressSchema,
  queryToken: z.string().max(4000),
  after: z
    .object({
      incoming: z.string().max(6000).nullable(),
      outgoing: z.string().max(6000).nullable(),
    })
    .optional(),
});
export async function POST(request: Request) {
  try {
    const body = input.parse(await requestJson(request));
    await guardRequest(request);
    return Response.json(
      await neighborhood(body.address, body.queryToken, body.after),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
