// Reusable fixed-window rate limit / quota helper for Edge Functions.
//
// Counters live in `public.rate_limit_counters` and are only reachable through
// the service-role-only `public.consume_rate_limit` RPC (see migration
// 202610020001_rate_limits.sql). Callers pass already-hashed or otherwise
// non-sensitive bucket keys; use `hashKey` for emails and IP addresses.
//
// This module is runtime-neutral (no `Deno` global) so Vitest can exercise it.

export type RateLimitRule = {
  /** Stable bucket name, e.g. `vision:user:<uuid>` or `signup:ip:<sha256>`. */
  bucket: string;
  /** Maximum total cost allowed inside one window. */
  limit: number;
  /** Window length in seconds (1 s – 1 day). */
  windowSeconds: number;
  /** Units consumed by this request (default 1, e.g. OCR pages). */
  cost?: number;
};

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; bucket: string; retryAfterSeconds: number };

export type RateLimitBackend = {
  url: string;
  serviceRoleKey: string;
  fetch?: typeof fetch;
};

/** The limiter could not be consulted. Callers must fail closed. */
export class RateLimitUnavailableError extends Error {
  constructor(message = "Rate limiting is unavailable.") {
    super(message);
    this.name = "RateLimitUnavailableError";
  }
}

/**
 * Consume every rule in order and stop at the first one that is exhausted.
 * A denied rule consumes nothing; earlier allowed rules stay consumed, so a
 * caller that keeps hammering one exhausted email still uses up its IP budget.
 */
export async function consumeRateLimits(
  backend: RateLimitBackend,
  rules: RateLimitRule[],
): Promise<RateLimitDecision> {
  const request = backend.fetch ?? fetch;
  for (const rule of rules) {
    let response: Response;
    try {
      response = await request(
        `${backend.url.replace(/\/$/, "")}/rest/v1/rpc/consume_rate_limit`,
        {
          method: "POST",
          headers: {
            apikey: backend.serviceRoleKey,
            Authorization: `Bearer ${backend.serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            p_bucket: rule.bucket,
            p_cost: rule.cost ?? 1,
            p_limit: rule.limit,
            p_window_seconds: rule.windowSeconds,
          }),
          signal: AbortSignal.timeout(5_000),
        },
      );
    } catch {
      throw new RateLimitUnavailableError();
    }
    if (!response.ok) throw new RateLimitUnavailableError();
    const rows = (await response.json().catch(() => null)) as unknown;
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || typeof row !== "object" || typeof row.allowed !== "boolean")
      throw new RateLimitUnavailableError();
    if (!row.allowed)
      return {
        allowed: false,
        bucket: rule.bucket,
        retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds) || 60),
      };
  }
  return { allowed: true };
}

/** Hex SHA-256 so raw emails and IP addresses never reach the counters table. */
export async function hashKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Best-effort caller IP for rate limiting. A client can send its own
 * X-Forwarded-For and proxies append to it, so the leftmost entry is
 * attacker-controlled; use the rightmost entry, which the platform's proxy
 * appended. Unknown callers share one bucket (fail safe).
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1);
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Reads a positive integer limit from the environment, else the default. */
export function envLimit(
  env: (name: string) => string | undefined,
  name: string,
  fallback: number,
): number {
  const value = Number(env(name));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
