import { describe, expect, it } from "vitest";
import { createSignupHandler } from "./handler";

const ORIGIN = "https://fretshift-beta.vercel.app";
const PUBLIC_KEY = "public-anon-key";

type FakeUser = { email: string; confirmed: boolean; password: string | null };

/**
 * In-memory stand-in for the two services the function talks to:
 * Supabase Auth (GoTrue) and the consume_rate_limit RPC. It records every
 * request so tests can assert on what the function sent.
 */
function fakeBackend(options: { limiterDown?: boolean } = {}) {
  const users = new Map<string, FakeUser>();
  const counters = new Map<string, number>();
  const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    const ok = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status });
    if (url.endsWith("/rest/v1/rpc/consume_rate_limit")) {
      if (options.limiterDown) return ok({ message: "down" }, 500);
      const key = String(body!.p_bucket);
      const next = (counters.get(key) ?? 0) + Number(body!.p_cost);
      if (next > Number(body!.p_limit))
        return ok([{ allowed: false, hits: counters.get(key) ?? 0, retry_after_seconds: 1800 }]);
      counters.set(key, next);
      return ok([{ allowed: true, hits: next, retry_after_seconds: 0 }]);
    }
    if (url.endsWith("/auth/v1/admin/users")) {
      // Pre-fix path: admin create. GoTrue rejects duplicates with 422.
      const email = String(body!.email);
      if (users.has(email))
        return ok({ msg: "A user with this email address has already been registered" }, 422);
      users.set(email, {
        email,
        confirmed: body!.email_confirm === true,
        password: String(body!.password),
      });
      return ok({ id: crypto.randomUUID(), email });
    }
    if (url.includes("/auth/v1/otp")) {
      // GoTrue OTP: creates an unconfirmed user with an unknown random password
      // when create_user is true, then emails a code. Same 200 either way.
      const email = String(body!.email);
      if (!users.has(email) && body!.create_user === true)
        users.set(email, { email, confirmed: false, password: null });
      return ok({});
    }
    return ok({ message: "unexpected" }, 404);
  };
  return { users, calls, fetch };
}

function handlerFor(backend: ReturnType<typeof fakeBackend>) {
  const env: Record<string, string> = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: PUBLIC_KEY,
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
  };
  return createSignupHandler({ env: (name) => env[name], fetch: backend.fetch });
}

function signup(
  body: Record<string, unknown>,
  init: { origin?: string | null; ip?: string } = {},
) {
  const headers: Record<string, string> = {
    apikey: PUBLIC_KEY,
    "Content-Type": "application/json",
    "x-forwarded-for": init.ip ?? "203.0.113.7",
  };
  if (init.origin !== null) headers.Origin = init.origin ?? ORIGIN;
  return new Request("https://project.supabase.co/functions/v1/password-signup", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const authCalls = (backend: ReturnType<typeof fakeBackend>) =>
  backend.calls.filter((call) => call.url.includes("/auth/v1/"));

describe("password-signup security", () => {
  it("never creates a pre-confirmed account and never stores the caller's password", async () => {
    const backend = fakeBackend();
    const response = await handlerFor(backend)(
      signup({ email: "Victim@Example.com", password: "attacker-known-pw" }),
    );
    expect(response.status).toBe(202);
    const user = backend.users.get("victim@example.com");
    expect(user).toBeDefined();
    expect(user!.confirmed).toBe(false);
    // The password only gets set after the owner proves the inbox with the code.
    expect(user!.password).toBeNull();
    for (const call of backend.calls)
      expect(JSON.stringify(call.body ?? {})).not.toContain("attacker-known-pw");
    expect(authCalls(backend).map((call) => call.body)).toEqual([
      { email: "victim@example.com", create_user: true },
    ]);
  });

  it("rejects a missing or disallowed Origin before any backend work", async () => {
    for (const origin of [null, "https://evil.example"]) {
      const backend = fakeBackend();
      const response = await handlerFor(backend)(
        signup({ email: "a@example.com", password: "password123" }, { origin }),
      );
      expect(response.status).toBe(403);
      expect(backend.calls).toEqual([]);
    }
    const preflight = await handlerFor(fakeBackend())(
      new Request("https://project.supabase.co/functions/v1/password-signup", {
        method: "OPTIONS",
      }),
    );
    expect(preflight.status).toBe(403);
  });

  it("returns an identical response whether or not the email is registered", async () => {
    const backend = fakeBackend();
    backend.users.set("taken@example.com", {
      email: "taken@example.com",
      confirmed: true,
      password: "owner-password",
    });
    const handler = handlerFor(backend);
    const existing = await handler(
      signup({ email: "taken@example.com", password: "password123" }, { ip: "198.51.100.1" }),
    );
    const fresh = await handler(
      signup({ email: "fresh@example.com", password: "password123" }, { ip: "198.51.100.2" }),
    );
    expect(existing.status).toBe(fresh.status);
    expect(await existing.text()).toBe(await fresh.text());
    // The existing owner's password is untouched.
    expect(backend.users.get("taken@example.com")!.password).toBe("owner-password");
  });

  it("rate-limits per email and per IP with Retry-After, and fails closed", async () => {
    const backend = fakeBackend();
    const handler = handlerFor(backend);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++)
      statuses.push(
        (await handler(signup({ email: "same@example.com" }, { ip: `192.0.2.${i}` }))).status,
      );
    expect(statuses).toEqual([202, 202, 202, 429]);

    const ipStatuses: number[] = [];
    let last: Response | null = null;
    for (let i = 0; i < 11; i++) {
      last = await handler(signup({ email: `user${i}@example.com` }, { ip: "192.0.2.200" }));
      ipStatuses.push(last.status);
    }
    expect(ipStatuses.slice(0, 10).every((status) => status === 202)).toBe(true);
    expect(ipStatuses[10]).toBe(429);
    expect(Number(last!.headers.get("Retry-After"))).toBeGreaterThan(0);

    // Raw emails and IPs never reach the counters table.
    for (const call of backend.calls.filter((c) => c.url.includes("consume_rate_limit"))) {
      expect(String(call.body!.p_bucket)).not.toMatch(/@|192\.0\.2/);
    }

    const down = fakeBackend({ limiterDown: true });
    const unavailable = await handlerFor(down)(signup({ email: "x@example.com" }));
    expect(unavailable.status).toBe(503);
    expect(authCalls(down)).toEqual([]);
  });

  it("keys the IP limit on the proxy-appended address, not a spoofed X-Forwarded-For", async () => {
    const backend = fakeBackend();
    const handler = handlerFor(backend);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++)
      statuses.push(
        (
          await handler(
            // Rotating a client-supplied first entry must not reset the limit.
            signup({ email: `spoof${i}@example.com` }, { ip: `10.0.0.${i}, 192.0.2.250` }),
          )
        ).status,
      );
    expect(statuses[10]).toBe(429);
  });

  it("forwards only a same-origin /settings redirect for the iPhone handoff", async () => {
    const backend = fakeBackend();
    const handler = handlerFor(backend);
    const handoff = "6f1c9c1e-3c55-4a8e-9a43-0b6a2a2f8d10";
    await handler(
      signup({
        email: "pwa@example.com",
        redirect_to: `${ORIGIN}/settings?auth_method=code&auth_handoff=${handoff}`,
      }),
    );
    await handler(
      signup(
        { email: "other@example.com", redirect_to: "https://evil.example/settings" },
        { ip: "198.51.100.9" },
      ),
    );
    const otpUrls = authCalls(backend).map((call) => new URL(call.url));
    expect(otpUrls[0].searchParams.get("redirect_to")).toBe(
      `${ORIGIN}/settings?auth_method=code&auth_handoff=${handoff}`,
    );
    expect(otpUrls[1].searchParams.has("redirect_to")).toBe(false);
  });
});
