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

function fakeServices(
  options: {
    limiterDown?: boolean;
    limiterReply?: () => Promise<Response>;
    env?: Record<string, string | undefined>;
  } = {},
) {
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
      if (options.limiterReply) return await options.limiterReply();
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
  const env: Record<string, string | undefined> = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "public-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
    OCR_SPACE_API_KEY: "ocr-secret",
    VISION_PAGES_PER_HOUR: "5",
    VISION_PAGES_PER_DAY: "8",
    ...options.env,
  };
  return {
    calls,
    handler: createVisionHandler({ env: (name) => env[name], fetch }),
  };
}

function ocrRequest(
  pages: number,
  token: string | null = "user-a",
  origin = ORIGIN,
  authorization = token === null ? null : `Bearer ${token}`,
) {
  return new Request("https://project.supabase.co/functions/v1/vision-import", {
    method: "POST",
    headers: {
      Origin: origin,
      ...(authorization === null ? {} : { Authorization: authorization }),
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

describe("vision-import authentication and origin checks", () => {
  it("requires a verified bearer token before any quota or provider work", async () => {
    const { calls, handler } = fakeServices();
    for (const authorization of [null, "", "Basic dXNlci1hOg==", "user-a", "Bearer ", "Bearer forged"]) {
      const response = await handler(ocrRequest(1, null, ORIGIN, authorization));
      expect(response.status, String(authorization)).toBe(401);
    }
    const authDown = createVisionHandler({
      env: (name) =>
        ({ SUPABASE_URL: "https://project.supabase.co", SUPABASE_ANON_KEY: "k", OCR_SPACE_API_KEY: "o" })[name],
      fetch: () => Promise.reject(new TypeError("unreachable")),
    });
    expect((await authDown(ocrRequest(1))).status).toBe(401);
    expect(calls.limiter).toEqual([]);
    expect(calls.ocr).toBe(0);
  });

  it("rejects origins outside ALLOWED_ORIGINS, which replaces the built-in list", async () => {
    const { calls, handler } = fakeServices({ env: { ALLOWED_ORIGINS: "https://app.example, https://beta.example" } });
    const evil = await handler(ocrRequest(1, "user-a", "https://evil.example"));
    expect(evil.status).toBe(403);
    expect(evil.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect((await handler(ocrRequest(1, "user-a", ORIGIN))).status).toBe(403);
    const preflight = await handler(
      new Request("https://edge.test", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }),
    );
    expect(preflight.status).toBe(403);
    expect(calls.limiter).toEqual([]);
    const allowed = await handler(ocrRequest(1, "user-a", "https://beta.example"));
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("https://beta.example");
  });

  it("fails closed when the quota service is unconfigured, missing or answers nonsense", async () => {
    const unconfigured = fakeServices({ env: { SUPABASE_SERVICE_ROLE_KEY: undefined } });
    expect((await unconfigured.handler(ocrRequest(1))).status).toBe(503);
    expect(unconfigured.calls.ocr).toBe(0);
    for (const limiterReply of [
      () => Promise.reject(new TypeError("unreachable")),
      () => Promise.resolve(new Response('{"code":"PGRST202"}', { status: 404 })),
      () => Promise.resolve(new Response("[]")),
    ]) {
      const { calls, handler } = fakeServices({ limiterReply });
      expect((await handler(ocrRequest(1))).status).toBe(503);
      expect(calls.ocr).toBe(0);
    }
  });
});
