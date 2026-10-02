import {
  RateLimitUnavailableError,
  clientIp,
  consumeRateLimits,
  envLimit,
  hashKey,
} from "../_shared/rateLimit.ts";

// Starts an email + password account WITHOUT trusting the caller's claim to the
// email address:
//
// - The account is created (or found) through Supabase Auth's own OTP flow with
//   create_user=true. A new account is unconfirmed and has a random password
//   nobody knows; Supabase emails the usual FretShift verification code.
// - The caller's password is never sent here. The client sets it with
//   PUT /auth/v1/user only after verifying the emailed code, so an attacker who
//   "registers" someone else's email cannot know any password for it
//   (no account pre-hijacking).
// - The response is identical for new and already-registered emails.
// - Requests need an allowed Origin and are rate-limited per IP and per email.
//
// Runtime-neutral (no Deno global) so Vitest can exercise it; index.ts wires
// it to Deno.serve.

export type SignupDeps = {
  env: (name: string) => string | undefined;
  fetch?: typeof fetch;
};

const EXACT_ORIGINS = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "https://fretshift-current1.vercel.app",
  "https://fretshift-current1-ford41b.vercel.app",
  "https://fretshift-beta.vercel.app",
]);

export function isAllowedOrigin(
  origin: string | null,
  extra: string | undefined = undefined,
) {
  // A browser always sends Origin on a cross-origin POST. A missing Origin
  // means a non-browser caller, which this endpoint does not serve.
  if (!origin) return false;
  if (EXACT_ORIGINS.has(origin)) return true;
  if (
    extra
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .includes(origin)
  )
    return true;
  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" &&
      /^fretshift-current1-[a-z0-9-]+-ford41b\.vercel\.app$/i.test(url.hostname)
    );
  } catch {
    return false;
  }
}

function cors(origin: string | null, allowed: boolean) {
  return {
    ...(origin && allowed ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers":
      "apikey, authorization, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

/** Only a same-origin /settings URL may receive the emailed sign-in link. */
function safeRedirect(value: unknown, origin: string): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.origin === origin && url.pathname === "/settings"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

// One uniform success body. It must not depend on whether the email exists.
const ACCEPTED = {
  status: "code_sent",
  message:
    "If this email can be used, a FretShift verification code is on its way. Enter it to finish creating your account.",
};

export function createSignupHandler(deps: SignupDeps) {
  const request_ = deps.fetch ?? fetch;
  const acceptedClientKeys = () =>
    new Set(
      [
        deps.env("SUPABASE_ANON_KEY"),
        deps.env("SUPABASE_PUBLISHABLE_KEY"),
        "sb_publishable_U5aIa-jc2j-X2IH7f6w5Kw_IJBKHWLg",
      ].filter((value): value is string => Boolean(value)),
    );

  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("Origin");
    const allowed = isAllowedOrigin(origin, deps.env("ALLOWED_ORIGINS"));
    const headers = cors(origin, allowed);

    if (request.method === "OPTIONS")
      return allowed
        ? new Response(null, { status: 204, headers })
        : json(403, { error: "Origin is not allowed." }, headers);
    if (request.method !== "POST")
      return json(405, { error: "Method not allowed." }, headers);
    if (!allowed || !origin)
      return json(403, { error: "Origin is not allowed." }, headers);

    // The apikey is public; this only filters obviously foreign callers.
    if (!acceptedClientKeys().has(request.headers.get("apikey") ?? ""))
      return json(401, { error: "FretShift client authorization is required." }, headers);

    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return json(400, { error: "Request body must be valid JSON." }, headers);
    }

    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      return json(400, { error: "Enter a valid email address." }, headers);
    // A `password` field from older clients is deliberately ignored.

    const url = deps.env("SUPABASE_URL")?.replace(/\/$/, "");
    const serviceRole = deps.env("SUPABASE_SERVICE_ROLE_KEY");
    const publicKey =
      deps.env("SUPABASE_ANON_KEY") ?? deps.env("SUPABASE_PUBLISHABLE_KEY");
    if (!url || !serviceRole || !publicKey)
      return json(503, { error: "Account creation is temporarily unavailable." }, headers);

    try {
      const decision = await consumeRateLimits(
        { url, serviceRoleKey: serviceRole, fetch: request_ },
        [
          {
            bucket: `signup:ip:${await hashKey(clientIp(request))}`,
            limit: envLimit(deps.env, "SIGNUP_IP_LIMIT_PER_HOUR", 10),
            windowSeconds: 3600,
          },
          {
            bucket: `signup:email:${await hashKey(email)}`,
            limit: envLimit(deps.env, "SIGNUP_EMAIL_LIMIT_PER_HOUR", 3),
            windowSeconds: 3600,
          },
        ],
      );
      if (!decision.allowed)
        return json(
          429,
          {
            error:
              "Too many account requests. Wait for the retry timer, then try once.",
          },
          { ...headers, "Retry-After": String(decision.retryAfterSeconds) },
        );
    } catch (error) {
      if (error instanceof RateLimitUnavailableError)
        return json(503, { error: "Account creation is temporarily unavailable." }, headers);
      throw error;
    }

    const redirect = safeRedirect(body.redirect_to, origin);
    const otpUrl = new URL(`${url}/auth/v1/otp`);
    if (redirect) otpUrl.searchParams.set("redirect_to", redirect);

    let response: Response;
    try {
      // GoTrue treats new, unconfirmed and confirmed emails the same way here:
      // it emails a verification code (creating an unconfirmed user if needed).
      response = await request_(otpUrl.toString(), {
        method: "POST",
        headers: { apikey: publicKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email, create_user: true }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      console.error("password-signup: auth request failed", error);
      return json(503, { error: "Account service could not be reached. Please try again." }, headers);
    }

    if (response.ok) return json(202, ACCEPTED, headers);

    // Project-wide email quota: not specific to this address, safe to surface.
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("Retry-After") || 0);
      return json(
        429,
        { error: "The project's email quota has been reached. No new email was sent. Wait, then try once." },
        { ...headers, "Retry-After": String(retryAfter > 0 ? retryAfter : 3600) },
      );
    }
    console.error("password-signup: auth rejected request", response.status);
    return json(503, { error: "Account service could not send a code. Please try again later." }, headers);
  };
}
