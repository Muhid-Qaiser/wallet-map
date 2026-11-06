import { counterparties } from "@/lib/domain";
import { chainIds, chainIdSchema, type ChainId } from "@/lib/networks";
import {
  AppError,
  errorResponse,
  guardRequest,
  requestJson,
} from "@/lib/server/infrastructure";
import { neighborhood } from "@/lib/server/query";
import {
  createSnapshot,
  snapshotInput,
  validatePeriod,
} from "@/lib/server/snapshot";

export const runtime = "nodejs";
export const maxDuration = 60;
const input = snapshotInput.extend({
  preferredChainId: chainIdSchema.default(1),
});

export async function POST(request: Request) {
  try {
    const body = input.parse(await requestJson(request));
    const period = validatePeriod(body);
    await guardRequest(request);

    const results = await Promise.allSettled(
      chainIds.map(async (chainId) => {
        const snapshot = await createSnapshot(body, chainId, period);
        const first = await neighborhood(body.address, snapshot.queryToken);
        const connections = counterparties(
          first.transfers,
          body.address,
        ).filter((address) => address !== body.address).length;
        return { snapshot, first, connections };
      }),
    );

    const incomplete: ChainId[] = [];
    const candidates = results.flatMap((result, index) => {
      if (result.status === "rejected") {
        incomplete.push(chainIds[index]);
        return [];
      }
      const { incoming, outgoing } = result.value.first;
      if (incoming.status === "error" || outgoing.status === "error")
        incomplete.push(result.value.snapshot.chainId);
      if (
        incoming.status === "error" &&
        outgoing.status === "error" &&
        !result.value.first.transfers.length
      )
        return [];
      return [result.value];
    });
    const [winner] = candidates.sort(
      (a, b) =>
        b.connections - a.connections ||
        b.first.transfers.length - a.first.transfers.length ||
        Number(b.snapshot.chainId === body.preferredChainId) -
          Number(a.snapshot.chainId === body.preferredChainId),
    );
    if (!winner)
      throw new AppError(
        "Could not check any network. Try again or select a specific network.",
      );
    return Response.json({ ...winner, incomplete });
  } catch (error) {
    return errorResponse(error);
  }
}
