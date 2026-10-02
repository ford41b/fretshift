import {
  MAX_BODY_BYTES,
  VisionProxyError,
  parseOcrSpaceResult,
  readRequestJson,
  validateVisionRequest,
} from "./core.ts";
import {
  RateLimitUnavailableError,
  consumeRateLimits,
  envLimit,
} from "../_shared/rateLimit.ts";

export type VisionDeps = {
  env: (name: string) => string | undefined;
  fetch?: typeof fetch;
};

export function createVisionHandler(deps: VisionDeps) {
  const env = deps.env;
  const request_ = deps.fetch ?? fetch;
  const OCR_SPACE_URL = "https://api.ocr.space/parse/image";
  const PROVIDER_ID = "ocr-space-engine-3";

  function cors(origin: string | null) {
    const allowed = (
      env("ALLOWED_ORIGINS") ??
      "http://127.0.0.1:5173,http://localhost:5173,https://fretshift-current1.vercel.app,https://fretshift-current1-ford41b.vercel.app,https://fretshift-beta.vercel.app"
    )
      .split(",")
      .map((value) => value.trim());
    return {
      ...(origin && allowed.includes(origin)
        ? { "Access-Control-Allow-Origin": origin }
        : {}),
      "Access-Control-Allow-Headers": "authorization, apikey, content-type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Expose-Headers": "Retry-After",
      Vary: "Origin",
    };
  }

  function originAllowed(origin: string | null) {
    if (!origin) return true;
    return (
      env("ALLOWED_ORIGINS") ??
      "http://127.0.0.1:5173,http://localhost:5173,https://fretshift-current1.vercel.app,https://fretshift-current1-ford41b.vercel.app,https://fretshift-beta.vercel.app"
    )
      .split(",")
      .map((value) => value.trim())
      .includes(origin);
  }

  function json(
    status: number,
    body: unknown,
    headers: Record<string, string>,
  ) {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
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
      const first = Object.values(parsed).find(
        (value): value is string => typeof value === "string",
      );
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

  async function recognizePage(
    page: { id: string; dataUrl: string },
    apiKey: string,
  ) {
    const form = new FormData();
    form.set("base64Image", page.dataUrl);
    form.set("filetype", "JPG");
    form.set("language", "eng");
    form.set("isOverlayRequired", "false");
    form.set("detectOrientation", "true");
    form.set("scale", "true");
    form.set("isTable", "true");
    form.set("OCREngine", "3");
    const response = await request_(OCR_SPACE_URL, {
      method: "POST",
      headers: { apikey: apiKey },
      body: form,
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok)
      throw new VisionProxyError(
        response.status === 429 ? 429 : 502,
        response.status === 429
          ? "OCR.space rate limit reached; retry this page later."
          : `OCR.space rejected this page (HTTP ${response.status}).`,
      );
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new VisionProxyError(502, "OCR.space returned malformed output.");
    }
    return { id: page.id, text: parseOcrSpaceResult(result) };
  }

  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("Origin");
    const headers = cors(origin);
    if (!originAllowed(origin))
      return json(403, { error: "Origin is not allowed." }, headers);
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method === "GET")
      return json(
        200,
        {
          status: "ok",
          providerConfigured: Boolean(env("OCR_SPACE_API_KEY")),
          authentication: "required",
        },
        headers,
      );
    if (request.method !== "POST")
      return json(405, { error: "Method not allowed." }, headers);
    const userId = await authenticatedUserId(
      request.headers.get("Authorization"),
    );
    if (!userId)
      return json(
        401,
        { error: "A valid signed-in session is required." },
        headers,
      );
    const contentLength = Number(request.headers.get("Content-Length") ?? 0);
    if (contentLength > MAX_BODY_BYTES)
      return json(413, { error: "OCR request exceeds 42 MB." }, headers);
    const apiKey = env("OCR_SPACE_API_KEY");
    if (!apiKey)
      return json(503, { error: "OCR.space is not configured." }, headers);
    let input: ReturnType<typeof validateVisionRequest>;
    try {
      input = validateVisionRequest(await readRequestJson(request));
    } catch (error) {
      if (error instanceof VisionProxyError)
        return json(error.status, { error: error.message }, headers);
      return json(400, { error: "Request body must be valid JSON." }, headers);
    }

    // Paid-provider quota: charge one unit per OCR page, per verified user,
    // before any provider request. Fails closed when the limiter is unreachable.
    const url = env("SUPABASE_URL");
    const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceRoleKey)
      return json(
        503,
        { error: "OCR quota service is not configured." },
        headers,
      );
    try {
      const cost = input.pages.length;
      const decision = await consumeRateLimits(
        { url, serviceRoleKey, fetch: request_ },
        [
          {
            bucket: `vision:pages:hour:${userId}`,
            limit: envLimit(env, "VISION_PAGES_PER_HOUR", 60),
            windowSeconds: 3600,
            cost,
          },
          {
            bucket: `vision:pages:day:${userId}`,
            limit: envLimit(env, "VISION_PAGES_PER_DAY", 200),
            windowSeconds: 86400,
            cost,
          },
        ],
      );
      if (!decision.allowed)
        return json(
          429,
          {
            error:
              "You have reached the photo import limit for now. Try again later.",
          },
          { ...headers, "Retry-After": String(decision.retryAfterSeconds) },
        );
    } catch (error) {
      if (error instanceof RateLimitUnavailableError)
        return json(
          503,
          { error: "OCR quota service is unavailable. Try again shortly." },
          headers,
        );
      throw error;
    }

    try {
      const pages = await Promise.all(
        input.pages.map((page) => recognizePage(page, apiKey)),
      );
      return json(
        200,
        {
          pages,
          pageIds: pages.map((page) => page.id),
          modelId: PROVIDER_ID,
          promptVersion: "ocr-v1",
          processedAt: new Date().toISOString(),
        },
        headers,
      );
    } catch (error) {
      if (error instanceof VisionProxyError)
        return json(error.status, { error: error.message }, headers);
      return json(
        504,
        {
          error:
            "OCR provider request timed out or its connection failed. Retry this page.",
        },
        headers,
      );
    }
  };
}
