import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { z } from "zod";

export class AppError extends Error {
  constructor(
    message: string,
    public status = 502,
    public code = "UPSTREAM_ERROR",
  ) {
    super(message);
  }
}
export const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;
const rate = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, "1 m"),
      prefix: "wm:rate",
      analytics: false,
    })
  : null;
const localCounters = new Map<string, { value: number; expires: number }>();
const ephemeralSecret = randomBytes(32).toString("hex");
function secret() {
  if (process.env.APP_SIGNING_SECRET) return process.env.APP_SIGNING_SECRET;
  if (process.env.NODE_ENV === "production")
    throw new AppError(
      "The server needs APP_SIGNING_SECRET configured.",
      503,
      "CONFIGURATION",
    );
  return ephemeralSecret;
}
export function signToken(payload: object) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", secret()).update(body).digest("base64url")}`;
}
export function readToken<T>(token: string, schema: z.ZodType<T>): T {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra)
    throw new AppError(
      "Invalid query token. Start a new search.",
      400,
      "INVALID_TOKEN",
    );
  const expected = createHmac("sha256", secret()).update(body).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new AppError(
      "Invalid query token. Start a new search.",
      400,
      "INVALID_TOKEN",
    );
  try {
    return schema.parse(JSON.parse(Buffer.from(body, "base64url").toString()));
  } catch {
    throw new AppError(
      "This query is no longer valid. Start a new search.",
      400,
      "INVALID_TOKEN",
    );
  }
}
function localCount(key: string, amount: number, ttl: number) {
  if (localCounters.size > 2000)
    for (const [k, v] of localCounters)
      if (v.expires < Date.now()) localCounters.delete(k);
  const current = localCounters.get(key);
  const entry =
    current && current.expires > Date.now()
      ? current
      : { value: 0, expires: Date.now() + ttl };
  entry.value += amount;
  localCounters.set(key, entry);
  return entry.value;
}
export async function guardRequest(request: Request) {
  if (!process.env.ALCHEMY_API_KEY)
    throw new AppError(
      "Live search needs an Alchemy key. Add ALCHEMY_API_KEY to .env.local, then restart the app. You can explore the sample meanwhile.",
      503,
      "CONFIGURATION",
    );
  if (
    process.env.NODE_ENV === "production" &&
    !redis &&
    process.env.ALLOW_LOCAL_LIMITS !== "true"
  )
    throw new AppError(
      "Public deployment needs shared rate limits. Configure Upstash Redis.",
      503,
      "CONFIGURATION",
    );
  const ip = process.env.VERCEL
    ? (request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown")
    : "local";
  try {
    const allowed = rate
      ? (await rate.limit(ip)).success
      : localCount(`rate:${ip}`, 1, 60000) <= 30;
    if (!allowed)
      throw new AppError(
        "Request limit reached. Please try again in a minute.",
        429,
        "RATE_LIMIT",
      );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "Quota service unavailable. Saved investigations still work.",
      503,
      "QUOTA_UNAVAILABLE",
    );
  }
}
export async function reserveUpstream(count = 1) {
  const key = `wm:budget:${new Date().toISOString().slice(0, 10)}`;
  const configured = Number(process.env.PROVIDER_DAILY_BUDGET ?? 10000);
  const limit =
    Number.isSafeInteger(configured) && configured > 0 ? configured : 10000;
  try {
    const used = redis
      ? Number(
          await redis.eval(
            "local n = redis.call('INCRBY', KEYS[1], ARGV[1]); if n == tonumber(ARGV[1]) then redis.call('EXPIRE', KEYS[1], 172800); end; return n",
            [key],
            [count],
          ),
        )
      : localCount(key, count, 86400000);
    if (used > limit)
      throw new AppError(
        "The app's daily data budget has been reached. Try again tomorrow or open a saved investigation.",
        429,
        "DAILY_BUDGET",
      );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "Quota service unavailable. Please try again later.",
      503,
      "QUOTA_UNAVAILABLE",
    );
  }
}
const memory = new Map<
  string,
  { data: unknown; expires: number; bytes: number }
>();
let cacheBytes = 0;
const pending = new Map<string, Promise<unknown>>();
export async function cached<T>(
  key: string,
  schema: z.ZodType<T>,
  get: () => Promise<T>,
  ttl = 86400,
): Promise<T> {
  const current = memory.get(key);
  if (current && current.expires > Date.now())
    return schema.parse(current.data);
  const running = pending.get(key);
  if (running) return schema.parse(await running);
  const operation = (async () => {
    if (redis) {
      try {
        const saved = await redis.get(key);
        if (saved) return schema.parse(saved);
      } catch {
        /* A cache miss must not bypass the separate quota checks. */
      }
    }
    const value = await get();
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (current) {
      memory.delete(key);
      cacheBytes -= current.bytes;
    }
    while (memory.size && cacheBytes + bytes > 50 * 1024 * 1024) {
      const first = memory.keys().next().value;
      if (!first) break;
      cacheBytes -= memory.get(first)?.bytes ?? 0;
      memory.delete(first);
    }
    if (bytes <= 50 * 1024 * 1024) {
      memory.set(key, { data: value, bytes, expires: Date.now() + ttl * 1000 });
      cacheBytes += bytes;
    }
    if (redis) {
      try {
        await redis.set(key, value, { ex: ttl });
      } catch {
        /* Local caching is sufficient when the shared cache is temporarily unavailable. */
      }
    }
    return value;
  })();
  pending.set(key, operation);
  try {
    return schema.parse(await operation);
  } finally {
    pending.delete(key);
  }
}
export function errorResponse(error: unknown) {
  if (error instanceof z.ZodError)
    return Response.json(
      {
        error: error.issues[0]?.message ?? "Invalid request.",
        code: "VALIDATION",
      },
      { status: 400 },
    );
  if (error instanceof AppError)
    return Response.json(
      { error: error.message, code: error.code },
      {
        status: error.status,
        headers: error.status === 429 ? { "Retry-After": "60" } : {},
      },
    );
  return Response.json(
    {
      error: "The request could not be completed. Please try again.",
      code: "UNEXPECTED",
    },
    { status: 500 },
  );
}
export async function requestJson(request: Request) {
  const text = await request.text();
  if (text.length > 20000)
    throw new AppError("Request is too large.", 413, "VALIDATION");
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    throw new AppError("Invalid JSON request.", 400, "VALIDATION");
  }
}
