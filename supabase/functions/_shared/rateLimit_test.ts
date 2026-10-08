import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  RateLimitUnavailableError,
  clientIp,
  consumeRateLimits,
  envLimit,
} from "./rateLimit.ts";

const RULE = { bucket: "test:bucket", limit: 1, windowSeconds: 60 };

function backend(reply: () => Response | Promise<Response>) {
  return {
    url: "https://project.supabase.co/",
    serviceRoleKey: "service-role-secret",
    fetch: (async () => await reply()) as typeof fetch,
  };
}

Deno.test("fails closed on every unusable limiter reply", async () => {
  const replies: Array<[string, () => Response | Promise<Response>]> = [
    ["network error", () => Promise.reject(new TypeError("connection refused"))],
    ["missing RPC (PostgREST 404)", () => new Response('{"code":"PGRST202"}', { status: 404 })],
    ["permission denied", () => new Response('{"code":"42501"}', { status: 401 })],
    ["server error", () => new Response("{}", { status: 500 })],
    ["not JSON", () => new Response("<html>")],
    ["empty result", () => new Response("[]")],
    ["object instead of rows", () => new Response('{"allowed":true}')],
    ["allowed is not a boolean", () => new Response('[{"allowed":"true"}]')],
  ];
  for (const [label, reply] of replies)
    await assertRejects(
      () => consumeRateLimits(backend(reply), [RULE]),
      RateLimitUnavailableError,
      undefined,
      label,
    );
});

Deno.test("stops at the first exhausted rule and reports a positive Retry-After", async () => {
  const seen: string[] = [];
  const decision = await consumeRateLimits(
    {
      url: "https://project.supabase.co",
      serviceRoleKey: "service-role-secret",
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init!.body));
        seen.push(body.p_bucket);
        return new Response(
          JSON.stringify([
            body.p_bucket === "b"
              ? { allowed: false, retry_after_seconds: 0 }
              : { allowed: true, retry_after_seconds: 0 },
          ]),
        );
      }) as typeof fetch,
    },
    [
      { ...RULE, bucket: "a" },
      { ...RULE, bucket: "b" },
      { ...RULE, bucket: "c" },
    ],
  );
  assertEquals(decision, { allowed: false, bucket: "b", retryAfterSeconds: 60 });
  assertEquals(seen, ["a", "b"]);
});

Deno.test("sends the service-role key only to the consume_rate_limit RPC", async () => {
  let url = "";
  let headers = new Headers();
  await consumeRateLimits(
    {
      url: "https://project.supabase.co/",
      serviceRoleKey: "service-role-secret",
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        url = String(input);
        headers = new Headers(init?.headers);
        return new Response('[{"allowed":true}]');
      }) as typeof fetch,
    },
    [RULE],
  );
  assertEquals(url, "https://project.supabase.co/rest/v1/rpc/consume_rate_limit");
  assertEquals(headers.get("Authorization"), "Bearer service-role-secret");
});

Deno.test("clientIp uses the rightmost X-Forwarded-For entry and shares one bucket when unknown", () => {
  const ip = (headers: Record<string, string>) =>
    clientIp(new Request("https://edge.test", { headers }));
  assertEquals(ip({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }), "203.0.113.7");
  assertEquals(ip({ "x-forwarded-for": " , " , "x-real-ip": "198.51.100.2" }), "198.51.100.2");
  assertEquals(ip({}), "unknown");
});

Deno.test("envLimit accepts only positive integers", () => {
  const env = (values: Record<string, string>) => (name: string) => values[name];
  assertEquals(envLimit(env({ L: "25" }), "L", 10), 25);
  for (const bad of ["0", "-3", "1.5", "abc", ""])
    assertEquals(envLimit(env({ L: bad }), "L", 10), 10, bad);
  assertEquals(envLimit(env({}), "L", 10), 10);
});
