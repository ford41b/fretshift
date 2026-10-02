import { describe, expect, it } from "vitest";
import { createVisionHandler } from "./handler";

const ORIGIN = "http://127.0.0.1:5173";
const page = (id: string) => ({
  id,
  fileName: `${id}.jpg`,
  dataUrl: "data:image/jpeg;base64,/9j/",
  width: 800,
  height: 1200,
});

function fakeServices(options: { limiterDown?: boolean } = {}) {
  const counters = new Map<string, number>();
  const calls = { ocr: 0, limiter: [] as Array<Record<string, unknown>> };
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) {
      const token = new Headers(init?.headers).get("Authorization");
      return token === "Bearer user-a" || token === "Bearer user-b"
        ? new Response(JSON.stringify({ id: token.slice(-6), email: "a@example.com" }))
        : new Response("{}", { status: 401 });
    }
    if (url.endsWith("/rest/v1/rpc/consume_rate_limit")) {
      const body = JSON.parse(String(init!.body));
      calls.limiter.push(body);
      if (options.limiterDown) return new Response("{}", { status: 500 });
      const next = (counters.get(body.p_bucket) ?? 0) + body.p_cost;
      if (next > body.p_limit)
        return new Response(
          JSON.stringify([{ allowed: false, hits: 0, retry_after_seconds: 900 }]),
        );
      counters.set(body.p_bucket, next);
      return new Response(JSON.stringify([{ allowed: true, hits: next, retry_after_seconds: 0 }]));
    }
    if (url.startsWith("https://api.ocr.space/")) {
      calls.ocr++;
      return new Response(
        JSON.stringify({
          IsErroredOnProcessing: false,
          ParsedResults: [{ FileParseExitCode: 1, ParsedText: "C G Am F" }],
        }),
      );
    }
    return new Response("{}", { status: 404 });
  };
  const env: Record<string, string> = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "public-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
    OCR_SPACE_API_KEY: "ocr-secret",
    VISION_PAGES_PER_HOUR: "5",
    VISION_PAGES_PER_DAY: "8",
  };
  return {
    calls,
    handler: createVisionHandler({ env: (name) => env[name], fetch }),
  };
}

function ocrRequest(pages: number, token = "user-a") {
  return new Request("https://project.supabase.co/functions/v1/vision-import", {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pages: Array.from({ length: pages }, (_, i) => page(`p${i}`)),
    }),
  });
}

describe("vision-import paid-API quota", () => {
  it("charges each signed-in user per OCR page and stops before the provider", async () => {
    const { calls, handler } = fakeServices();
    expect((await handler(ocrRequest(3))).status).toBe(200);
    expect((await handler(ocrRequest(2))).status).toBe(200);
    expect(calls.ocr).toBe(5);

    const limited = await handler(ocrRequest(1));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBe(900);
    expect(calls.ocr).toBe(5); // no provider spend once the hourly quota is used

    // Buckets are per user, keyed by the verified user id (not the token).
    expect((await handler(ocrRequest(1, "user-b"))).status).toBe(200);
    expect(calls.limiter.map((call) => call.p_bucket)).toContain("vision:pages:hour:user-b");
    expect(calls.limiter.some((call) => String(call.p_bucket).includes("Bearer"))).toBe(false);
  });

  it("fails closed without calling OCR.space when the limiter is unavailable", async () => {
    const { calls, handler } = fakeServices({ limiterDown: true });
    expect((await handler(ocrRequest(1))).status).toBe(503);
    expect(calls.ocr).toBe(0);
  });

  it("does not charge quota for unauthenticated or invalid requests", async () => {
    const { calls, handler } = fakeServices();
    expect((await handler(ocrRequest(1, "forged"))).status).toBe(401);
    const invalid = new Request("https://project.supabase.co/functions/v1/vision-import", {
      method: "POST",
      headers: { Origin: ORIGIN, Authorization: "Bearer user-a" },
      body: JSON.stringify({ pages: [] }),
    });
    expect((await handler(invalid)).status).toBe(400);
    expect(calls.limiter).toEqual([]);
    expect(calls.ocr).toBe(0);
  });
});
