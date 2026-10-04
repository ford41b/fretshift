import {
  DEFAULT_MODEL,
  MAX_BODY_BYTES,
  MAX_FPS,
  MAX_SEGMENT_SECONDS,
  MAX_VIDEO_SECONDS,
  PROMPT_VERSION,
  YouTubeImportError,
  buildGeminiRequest,
  classifyGeminiError,
  interpretOEmbed,
  readRequestJson,
  usageFrom,
  validateGeminiResponse,
  validateImportRequest,
  watchUrl,
} from "./core.ts";
import {
  RateLimitUnavailableError,
  consumeRateLimits,
  envLimit,
} from "../_shared/rateLimit.ts";

export type YouTubeImportDeps = {
  env: (name: string) => string | undefined;
  fetch?: typeof fetch;
};

const DEFAULT_ORIGINS =
  "http://127.0.0.1:5173,http://localhost:5173,https://fretshift-current1.vercel.app,https://fretshift-current1-ford41b.vercel.app,https://fretshift-beta.vercel.app";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export function createYouTubeImportHandler(deps: YouTubeImportDeps) {
  const env = deps.env;
  const request_ = deps.fetch ?? fetch;

  const allowedOrigins = () =>
    (env("ALLOWED_ORIGINS") ?? DEFAULT_ORIGINS).split(",").map((value) => value.trim());

  function cors(origin: string | null) {
    return {
      ...(origin && allowedOrigins().includes(origin)
        ? { "Access-Control-Allow-Origin": origin }
        : {}),
      "Access-Control-Allow-Headers": "authorization, apikey, content-type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Expose-Headers": "Retry-After",
      Vary: "Origin",
    };
  }

  function json(status: number, body: unknown, headers: Record<string, string>) {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  }

  const failure = (error: YouTubeImportError, headers: Record<string, string>) =>
    json(error.status, { error: error.message, code: error.code, retryable: error.retryable }, headers);

  function model() {
    const configured = env("GEMINI_MODEL")?.trim();
    return configured && /^[a-z0-9][a-z0-9.-]{2,63}$/.test(configured) ? configured : DEFAULT_MODEL;
  }

  function timeoutMs() {
    const value = Number(env("GEMINI_TIMEOUT_MS"));
    // Stay under the Edge Function's 150 s request idle timeout.
    return Number.isFinite(value) && value >= 10_000 && value <= 140_000 ? value : 120_000;
  }

  function publishableKey() {
    const legacy = env("SUPABASE_ANON_KEY");
    if (legacy) return legacy;
    const single = env("SUPABASE_PUBLISHABLE_KEY");
    if (single) return single;
    const named = env("SUPABASE_PUBLISHABLE_KEYS");
    if (!named) return null;
    try {
      const parsed = JSON.parse(named) as Record<string, unknown>;
      if (typeof parsed.default === "string") return parsed.default;
      const first = Object.values(parsed).find((value): value is string => typeof value === "string");
      return first ?? null;
    } catch {
      return null;
    }
  }

  /** Verified Supabase user id for the bearer token, or null. */
  async function authenticatedUserId(authorization: string | null) {
    const url = env("SUPABASE_URL");
    const key = publishableKey();
    if (!authorization?.startsWith("Bearer ") || !url || !key) return null;
    try {
      const response = await request_(`${url}/auth/v1/user`, {
        headers: { Authorization: authorization, apikey: key },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return null;
      const user = await response.json().catch(() => null);
      return typeof user?.id === "string" && user.id ? user.id : null;
    } catch {
      return null;
    }
  }

  /** Free metadata pre-check; inconclusive results fall through to Gemini. */
  async function checkVideo(videoId: string) {
    let response: Response;
    try {
      response = await request_(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(videoId))}`,
        { signal: AbortSignal.timeout(5_000) },
      );
    } catch {
      return null;
    }
    const body = await response.json().catch(() => null);
    return interpretOEmbed(response.status, body);
  }

  async function callGemini(apiKey: string, input: ReturnType<typeof validateImportRequest>) {
    let response: Response;
    try {
      response = await request_(`${GEMINI_BASE}/${model()}:generateContent`, {
        method: "POST",
        // Header, not ?key=, so the secret never appears in a URL or access log.
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(buildGeminiRequest(input)),
        signal: AbortSignal.timeout(timeoutMs()),
      });
    } catch {
      throw new YouTubeImportError(504, "Gemini did not answer in time. Retry, or analyze a shorter range.", {
        code: "timeout",
        retryable: true,
      });
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) throw classifyGeminiError(response.status, body);
    return { analysis: validateGeminiResponse(body, input.segment), usage: usageFrom(body) };
  }

  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("Origin");
    const headers = cors(origin);
    if (origin && !allowedOrigins().includes(origin))
      return json(403, { error: "Origin is not allowed." }, headers);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method === "GET")
      return json(
        200,
        {
          status: "ok",
          providerConfigured: Boolean(env("GEMINI_API_KEY")),
          authentication: "required",
          modelId: model(),
          promptVersion: PROMPT_VERSION,
          limits: { maxSegmentSeconds: MAX_SEGMENT_SECONDS, maxVideoSeconds: MAX_VIDEO_SECONDS, maxFps: MAX_FPS },
        },
        headers,
      );
    if (request.method !== "POST") return json(405, { error: "Method not allowed." }, headers);

    const userId = await authenticatedUserId(request.headers.get("Authorization"));
    if (!userId)
      return json(401, { error: "A valid signed-in session is required.", code: "sign-in" }, headers);
    if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES)
      return json(413, { error: "YouTube import request is too large.", code: "bad-request" }, headers);
    const apiKey = env("GEMINI_API_KEY");
    if (!apiKey)
      return json(503, { error: "YouTube import is not configured on this server.", code: "not-configured" }, headers);

    let input: ReturnType<typeof validateImportRequest>;
    let video: Awaited<ReturnType<typeof checkVideo>>;
    try {
      input = validateImportRequest(await readRequestJson(request));
      video = await checkVideo(input.videoId);
    } catch (error) {
      if (error instanceof YouTubeImportError) return failure(error, headers);
      return json(400, { error: "Request body must be valid JSON.", code: "bad-request" }, headers);
    }

    // Paid-provider quota: one unit per Gemini request, per verified user,
    // charged before the request. Fails closed when the limiter is unreachable.
    const url = env("SUPABASE_URL");
    const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceRoleKey)
      return json(503, { error: "YouTube import quota service is not configured.", code: "not-configured" }, headers);
    try {
      const decision = await consumeRateLimits({ url, serviceRoleKey, fetch: request_ }, [
        {
          bucket: `youtube:calls:hour:${userId}`,
          limit: envLimit(env, "YOUTUBE_CALLS_PER_HOUR", 20),
          windowSeconds: 3600,
        },
        {
          bucket: `youtube:calls:day:${userId}`,
          limit: envLimit(env, "YOUTUBE_CALLS_PER_DAY", 60),
          windowSeconds: 86400,
        },
      ]);
      if (!decision.allowed)
        return json(
          429,
          { error: "You have reached the YouTube import limit for now. Try again later.", code: "quota" },
          { ...headers, "Retry-After": String(decision.retryAfterSeconds) },
        );
    } catch (error) {
      if (error instanceof RateLimitUnavailableError)
        return json(503, { error: "YouTube import quota service is unavailable. Try again shortly.", code: "quota-unavailable" }, headers);
      throw error;
    }

    try {
      const { analysis, usage } = await callGemini(apiKey, input);
      return json(
        200,
        {
          videoId: input.videoId,
          segment: input.segment,
          fps: input.fps,
          pass: input.pass,
          analysis,
          video: video ?? {},
          usage,
          modelId: model(),
          promptVersion: PROMPT_VERSION,
          processedAt: new Date().toISOString(),
        },
        headers,
      );
    } catch (error) {
      if (error instanceof YouTubeImportError) {
        const response = failure(error, headers);
        if (error.status === 429) response.headers.set("Retry-After", "60");
        return response;
      }
      return json(502, { error: "Gemini returned an unexpected answer. Retry.", code: "invalid-response", retryable: true }, headers);
    }
  };
}
