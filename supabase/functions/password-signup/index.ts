const EXACT_ORIGINS = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "https://fretshift-current1.vercel.app",
  "https://fretshift-current1-ford41b.vercel.app",
  "https://fretshift-beta.vercel.app",
]);

function isAllowedOrigin(origin: string | null) {
  if (!origin) return true;
  if (EXACT_ORIGINS.has(origin)) return true;

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

function cors(origin: string | null) {
  return {
    ...(origin && isAllowedOrigin(origin)
      ? { "Access-Control-Allow-Origin": origin }
      : {}),
    "Access-Control-Allow-Headers":
      "apikey, authorization, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function acceptedClientKeys() {
  return new Set(
    [
      Deno.env.get("SUPABASE_ANON_KEY"),
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),
      "sb_publishable_U5aIa-jc2j-X2IH7f6w5Kw_IJBKHWLg",
    ].filter((value): value is string => Boolean(value)),
  );
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  const headers = cors(origin);

  if (request.method === "OPTIONS") {
    if (!isAllowedOrigin(origin))
      return json(403, { error: "Origin is not allowed." }, headers);
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "POST")
    return json(405, { error: "Method not allowed." }, headers);

  if (!isAllowedOrigin(origin))
    return json(403, { error: "Origin is not allowed." }, headers);

  const suppliedKey = request.headers.get("apikey") ?? "";
  if (!acceptedClientKeys().has(suppliedKey))
    return json(401, { error: "FretShift client authorization is required." }, headers);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Request body must be valid JSON." }, headers);
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    return json(400, { error: "Enter a valid email address." }, headers);

  if (password.length < 8 || password.length > 128)
    return json(400, { error: "Password must be 8–128 characters." }, headers);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole)
    return json(
      503,
      { error: "Account creation is temporarily unavailable." },
      headers,
    );

  try {
    const response = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const message = String(data?.msg ?? data?.message ?? "");
      if (/already|registered|exists/i.test(message)) {
        return json(
          409,
          { error: "An account already exists for this email. Use Sign in instead." },
          headers,
        );
      }
      return json(
        400,
        { error: "Account could not be created. Try a different password." },
        headers,
      );
    }

    return json(201, { created: true }, headers);
  } catch (error) {
    console.error("password-signup failed", error);
    return json(
      503,
      { error: "Account service could not be reached. Please try again." },
      headers,
    );
  }
});
