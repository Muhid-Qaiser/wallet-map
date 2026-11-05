import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  addressSchema,
  hashSchema,
  type Address,
  type Neighborhood,
} from "../domain";
import { AppError, readToken, signToken } from "./infrastructure";
import { transferPage } from "./alchemy";

export const querySchema = z.object({
  kind: z.literal("query"),
  chainId: z.literal(1),
  fromBlock: z.number().int().nonnegative(),
  block: z.number().int().positive(),
  hash: hashSchema,
  asset: z.string().max(42),
  expires: z.number(),
});
export function readQuery(token: string) {
  const query = readToken(token, querySchema);
  if (query.expires < Date.now())
    throw new AppError(
      "This snapshot has expired for live queries. Refresh it to continue; saved evidence remains available.",
      409,
      "EXPIRED_QUERY",
    );
  return query;
}
const cursorSchema = z.object({
  kind: z.literal("cursor"),
  query: z.string(),
  address: addressSchema,
  direction: z.enum(["incoming", "outgoing"]),
  pageKey: z.string().nullable(),
  count: z.number().int().min(0).max(1000),
  expires: z.number(),
});
export async function neighborhood(
  address: Address,
  queryToken: string,
  after?: { incoming: string | null; outgoing: string | null },
): Promise<Neighborhood> {
  const query = readQuery(queryToken);
  const digest = createHash("sha256").update(queryToken).digest("hex");
  const load = async (direction: "incoming" | "outgoing") => {
    const cursor = after?.[direction];
    if (after && cursor === null)
      return {
        transfers: [],
        state: {
          status: "complete",
          cursor: null,
          count: 0,
          message: null,
        } satisfies Neighborhood["incoming"],
      };
    const previous = cursor
      ? readToken(cursor, cursorSchema)
      : ({
          kind: "cursor",
          query: digest,
          address,
          direction,
          pageKey: null,
          count: 0,
          expires: Date.now() + 540000,
        } satisfies z.infer<typeof cursorSchema>);
    if (
      previous.query !== digest ||
      previous.address !== address ||
      previous.direction !== direction
    )
      throw new AppError(
        "Continuation does not match this investigation.",
        400,
        "INVALID_TOKEN",
      );
    if (previous.expires < Date.now())
      throw new AppError(
        "History continuation expired. Restart this address at the saved snapshot.",
        409,
        "EXPIRED_CURSOR",
      );
    if (previous.count >= 1000)
      return {
        transfers: [],
        state: {
          status: "limit",
          cursor: null,
          count: previous.count,
          message:
            "History cap reached. Narrow the date range or select an asset.",
        } satisfies Neighborhood["incoming"],
      };
    try {
      const page = await transferPage({
        address,
        direction,
        fromBlock: query.fromBlock,
        toBlock: query.block,
        asset: query.asset,
        pageKey: previous.pageKey,
        maxCount: Math.min(250, 1000 - previous.count),
        snapshotHash: query.hash,
      });
      const count = previous.count + page.fetched;
      const next = page.pageKey
        ? signToken({
            ...previous,
            pageKey: page.pageKey,
            count,
            expires: Date.now() + 480000,
          })
        : null;
      const limited = count >= 1000 && !!next;
      return {
        transfers: page.transfers,
        state: {
          status: limited ? "limit" : next ? "more" : "complete",
          cursor: limited ? null : next,
          count,
          message: limited
            ? "History cap reached. Narrow dates or choose an asset."
            : null,
        } satisfies Neighborhood["incoming"],
      };
    } catch (error) {
      const message =
        error instanceof AppError
          ? error.message
          : "This direction could not be loaded. Retry or restart this address.";
      return {
        transfers: [],
        state: {
          status: "error",
          cursor: signToken(previous),
          count: previous.count,
          message,
        } satisfies Neighborhood["incoming"],
      };
    }
  };
  const [incoming, outgoing] = await Promise.all([
    load("incoming"),
    load("outgoing"),
  ]);
  return {
    address,
    transfers: [
      ...new Map(
        [...incoming.transfers, ...outgoing.transfers].map((t) => [t.id, t]),
      ).values(),
    ],
    incoming: incoming.state,
    outgoing: outgoing.state,
    warnings: [incoming.state.message, outgoing.state.message].filter(
      (m): m is string => m !== null,
    ),
  };
}
