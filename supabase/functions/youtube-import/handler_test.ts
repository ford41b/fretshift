import { assert, assertEquals } from "jsr:@std/assert@1";
import { createYouTubeImportHandler } from "./handler.ts";

const ORIGIN = "http://127.0.0.1:5173";
const ID = "dQw4w9WgXcQ";

type Options = {
  limiterDown?: boolean;
  oembedStatus?: number;
  geminiStatus?: number;
  geminiBody?: unknown;
  geminiHang?: boolean;
  env?: Record<string, string | undefined>;
};

function fakeServices(options: Options = {}) {
  const counters = new Map<string, number>();
  const calls = {
    gemini: [] as Array<{ url: string; headers: Headers; body: Record<string, unknown> }>,
    oembed: 0,
    limiter: [] as Array<Record<string, unknown>>,
  };
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) {
      const token = new Headers(init?.headers).get("Authorization");
      return token === "Bearer user-a" || token === "Bearer user-b"
        ? new Response(JSON.stringify({ id: token.slice(-6) }))
        : new Response("{}", { status: 401 });
    }
    if (url.endsWith("/rest/v1/rpc/consume_rate_limit")) {
      const body = JSON.parse(String(init!.body));
      calls.limiter.push(body);
      if (options.limiterDown) return new Response("{}", { status: 500 });
      const next = (counters.get(body.p_bucket) ?? 0) + body.p_cost;
      if (next > body.p_limit)
        return new Response(JSON.stringify([{ allowed: false, hits: 0, retry_after_seconds: 900 }]));
      counters.set(body.p_bucket, next);
      return new Response(JSON.stringify([{ allowed: true, hits: next, retry_after_seconds: 0 }]));
    }
    if (url.startsWith("https://www.youtube.com/oembed?")) {
      calls.oembed++;
      const status = options.oembedStatus ?? 200;
      return new Response(status === 200 ? JSON.stringify({ title: "Lesson", author_name: "Teacher" }) : "Unauthorized", { status });
    }
    if (url.startsWith("https://generativelanguage.googleapis.com/")) {
      calls.gemini.push({ url, headers: new Headers(init?.headers), body: JSON.parse(String(init!.body)) });
      if (options.geminiHang)
        return await new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError"))));
      return new Response(
        JSON.stringify(
          options.geminiBody ?? {
            candidates: [
              {
                finishReason: "STOP",
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        tempoBpm: 90,
                        meter: "4/4",
                        key: "G",
                        capoGuess: 0,
                        firstDownbeatSeconds: 0.5,
                        sections: [],
                        chords: [
                          { startSeconds: 0.5, endSeconds: 6, chord: "G", confidence: 0.9, evidence: "heard_and_seen" },
                          { startSeconds: 6, endSeconds: 12, chord: "C", confidence: 0.8, evidence: "heard" },
                        ],
                      }),
                    },
                  ],
                },
              },
            ],
            usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, totalTokenCount: 1100 },
          },
        ),
        { status: options.geminiStatus ?? 200 },
      );
    }
    return new Response("{}", { status: 404 });
  };
  const env: Record<string, string | undefined> = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "public-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
    GEMINI_API_KEY: "gemini-secret",
    YOUTUBE_CALLS_PER_HOUR: "3",
    YOUTUBE_CALLS_PER_DAY: "5",
    ...options.env,
  };
  return { calls, handler: createYouTubeImportHandler({ env: (name) => env[name], fetch }) };
}

function importRequest(body: Record<string, unknown> = {}, token = "user-a", origin = ORIGIN) {
  return new Request("https://project.supabase.co/functions/v1/youtube-import", {
    method: "POST",
    headers: { Origin: origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url: `https://youtu.be/${ID}`,
      segment: { startSeconds: 0, endSeconds: 12 },
      fps: 1,
      ...body,
    }),
  });
}

Deno.test("GET reports configuration without exposing secrets", async () => {
  const { handler } = fakeServices({ env: { GEMINI_MODEL: "gemini-3.7-flash" } });
  const response = await handler(new Request("https://edge.test", { headers: { Origin: ORIGIN } }));
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assertEquals(body.providerConfigured, true);
  assertEquals(body.modelId, "gemini-3.7-flash");
  assert(!JSON.stringify(body).includes("gemini-secret"));
  const unconfigured = fakeServices({ env: { GEMINI_API_KEY: undefined, GEMINI_MODEL: "bad model/../" } });
  const status = await (await unconfigured.handler(new Request("https://edge.test"))).json();
  assertEquals([status.providerConfigured, status.modelId], [false, "gemini-3.8-flash"]);
});

Deno.test("rejects other origins, anonymous callers and invalid bodies before any paid call", async () => {
  const { calls, handler } = fakeServices();
  const forbidden = await handler(importRequest({}, "user-a", "https://evil.example"));
  assertEquals(forbidden.status, 403);
  assertEquals(forbidden.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals((await handler(importRequest({}, "forged"))).status, 401);
  const invalid = await handler(importRequest({ url: "https://www.youtube.com/playlist?list=PL1" }));
  assertEquals(invalid.status, 400);
  assertEquals((await invalid.json()).code, "invalid-url");
  const tooLong = await handler(importRequest({ videoDurationSeconds: 7200 }));
  assertEquals([tooLong.status, (await tooLong.json()).code], [413, "too-long"]);
  assertEquals(calls.limiter, []);
  assertEquals(calls.gemini.length, 0);
  const preflight = await handler(new Request("https://edge.test", { method: "OPTIONS", headers: { Origin: ORIGIN } }));
  assertEquals(preflight.status, 204);
});

Deno.test("calls Gemini with the server key in a header and returns validated analysis", async () => {
  const { calls, handler } = fakeServices();
  const response = await handler(importRequest({ hints: { title: "Song" }, pass: 2 }));
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  assertEquals(body.videoId, ID);
  assertEquals(body.pass, 2);
  assertEquals(body.modelId, "gemini-3.8-flash");
  assertEquals(body.promptVersion, "youtube-chords-v1");
  assertEquals(body.video, { title: "Lesson", channel: "Teacher" });
  assertEquals(body.usage, { promptTokens: 1000, outputTokens: 100, totalTokens: 1100 });
  assertEquals(body.analysis.chords.map((chord: { chord: string }) => chord.chord), ["G", "C"]);
  const [call] = calls.gemini;
  assertEquals(call.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  assertEquals(call.headers.get("x-goog-api-key"), "gemini-secret");
  assert(!call.url.includes("gemini-secret"));
  assert(!JSON.stringify(body).includes("gemini-secret"));
  const contents = call.body.contents as Array<{ parts: Array<Record<string, unknown>> }>;
  assertEquals(contents[0].parts[0].fileData, { fileUri: `https://www.youtube.com/watch?v=${ID}` });
});

Deno.test("charges one quota unit per Gemini call, per verified user, and stops at the limit", async () => {
  const { calls, handler } = fakeServices();
  for (let i = 0; i < 3; i++) assertEquals((await handler(importRequest())).status, 200);
  const limited = await handler(importRequest());
  assertEquals(limited.status, 429);
  assertEquals(limited.headers.get("Retry-After"), "900");
  assertEquals((await limited.json()).code, "quota");
  assertEquals(calls.gemini.length, 3);
  assertEquals((await handler(importRequest({}, "user-b"))).status, 200);
  assert(calls.limiter.some((call) => call.p_bucket === "youtube:calls:hour:user-b"));
  assert(!calls.limiter.some((call) => String(call.p_bucket).includes("Bearer")));
});

Deno.test("fails closed when the limiter is down and skips quota for private videos", async () => {
  const down = fakeServices({ limiterDown: true });
  assertEquals((await down.handler(importRequest())).status, 503);
  assertEquals(down.calls.gemini.length, 0);
  const privateVideo = fakeServices({ oembedStatus: 401 });
  const response = await privateVideo.handler(importRequest());
  assertEquals([response.status, (await response.json()).code], [422, "private-video"]);
  assertEquals(privateVideo.calls.limiter, []);
  assertEquals(privateVideo.calls.gemini.length, 0);
  const missing = fakeServices({ oembedStatus: 404 });
  assertEquals((await missing.handler(importRequest())).status, 404);
  // An inconclusive pre-check still lets Gemini decide.
  const flaky = fakeServices({ oembedStatus: 500 });
  assertEquals((await flaky.handler(importRequest())).status, 200);
});

Deno.test("maps provider failures, timeouts and malformed output to clear errors", async () => {
  const quota = await fakeServices({ geminiStatus: 429, geminiBody: { error: { status: "RESOURCE_EXHAUSTED", message: "x" } } })
    .handler(importRequest());
  assertEquals([quota.status, quota.headers.get("Retry-After"), (await quota.json()).code], [429, "60", "provider-quota"]);
  const privateVideo = await fakeServices({
    geminiStatus: 400,
    geminiBody: { error: { status: "INVALID_ARGUMENT", message: "The video is private." } },
  }).handler(importRequest());
  assertEquals([privateVideo.status, (await privateVideo.json()).code], [422, "private-video"]);
  const malformed = await fakeServices({ geminiBody: { candidates: [{ content: { parts: [{ text: "lyrics here" }] } }] } })
    .handler(importRequest());
  const malformedBody = await malformed.json();
  assertEquals([malformed.status, malformedBody.code, malformedBody.retryable], [502, "invalid-response", true]);
  const slow = await fakeServices({ geminiHang: true, env: { GEMINI_TIMEOUT_MS: "10000" } }).handler(importRequest());
  assertEquals([slow.status, (await slow.json()).code], [504, "timeout"]);
  const unconfigured = await fakeServices({ env: { GEMINI_API_KEY: undefined } }).handler(importRequest());
  assertEquals([unconfigured.status, (await unconfigured.json()).code], [503, "not-configured"]);
});
