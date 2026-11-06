import { chainIdSchema } from "@/lib/networks";
import {
  errorResponse,
  guardRequest,
  requestJson,
} from "@/lib/server/infrastructure";
import {
  createSnapshot,
  snapshotInput,
  validatePeriod,
} from "@/lib/server/snapshot";

export const runtime = "nodejs";
export const maxDuration = 60;
const input = snapshotInput.extend({ chainId: chainIdSchema.default(1) });

export async function POST(request: Request) {
  try {
    const body = input.parse(await requestJson(request));
    const period = validatePeriod(body);
    await guardRequest(request);
    return Response.json(await createSnapshot(body, body.chainId, period));
  } catch (error) {
    return errorResponse(error);
  }
}
