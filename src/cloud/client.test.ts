import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  cloudConfig,
  claimPendingAuthHandoff,
  completePasswordAccount,
  requestPasswordAccountCode,
  getAccessToken,
  getSession,
  initializeAuth,
  sendMagicLink,
  sendVerificationCode,
  verifyEmailCode,
  signOut,
} from "./client";
beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-key");
  history.replaceState(null, "", "/settings");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("requires valid configuration and posts only an email to the configured auth endpoint", async () => {
  const request = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", request);
  await sendMagicLink("player@example.com");
  expect(request.mock.calls[0][0]).toContain("/auth/v1/otp?redirect_to=");
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
    email: "player@example.com",
    create_user: true,
  });
  vi.stubEnv("VITE_SUPABASE_URL", "javascript:bad");
  expect(cloudConfig()).toBeNull();
});

it("honors auth retry-after responses and blocks immediate duplicate emails", async () => {
  const request = vi.fn().mockResolvedValue(
    new Response('{"message":"email rate limit exceeded"}', {
      status: 429,
      headers: { "Retry-After": "120" },
    }),
  );
  vi.stubGlobal("fetch", request);
  await expect(sendMagicLink("player@example.com")).rejects.toThrow(
    "temporary email quota",
  );
  await expect(sendMagicLink("player@example.com")).rejects.toThrow(
    "just requested",
  );
  expect(request).toHaveBeenCalledTimes(1);
});


it("verifies an eight-digit email code and persists the session in this browser", async () => {
  const request = vi.fn().mockImplementation((url: string) => {
    if (url.includes("/auth/v1/verify"))
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "otp-access",
            refresh_token: "otp-refresh",
            expires_in: 3600,
            user: { id: "user-otp", email: "player@example.com" },
          }),
        ),
      );
    return Promise.reject(new Error(`Unexpected request: ${url}`));
  });
  vi.stubGlobal("fetch", request);

  await verifyEmailCode("player@example.com", "12345678");

  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toContain("/auth/v1/verify");
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
    email: "player@example.com",
    token: "12345678",
    type: "email",
  });
  expect(getSession()?.user.id).toBe("user-otp");
  expect(getSession()?.refresh_token).toBe("otp-refresh");
});

it("requests the same passwordless email endpoint for verification-code sign-in", async () => {
  const request = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", request);

  await sendVerificationCode("player@example.com");

  expect(request.mock.calls[0][0]).toContain("/auth/v1/otp?redirect_to=");
  expect(decodeURIComponent(request.mock.calls[0][0])).toContain("auth_method=code");
});

it("accepts the current publishable-key environment name", () => {
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
  expect(cloudConfig()).toEqual({
    url: "https://project.supabase.co",
    key: "publishable-key",
  });
});

it("creates a short-lived handoff for standalone iPhone magic-link sign-in", async () => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
  const request = vi.fn().mockImplementation((url: string) => {
    if (url.includes("/rest/v1/rpc/create_auth_handoff"))
      return Promise.resolve(new Response(""));
    if (url.includes("/auth/v1/otp?")) return Promise.resolve(new Response("{}"));
    return Promise.reject(new Error(`Unexpected request: ${url}`));
  });
  vi.stubGlobal("fetch", request);

  await sendMagicLink("player@example.com");

  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0][0]).toContain("/rest/v1/rpc/create_auth_handoff");
  expect(request.mock.calls[1][0]).toContain("/auth/v1/otp?redirect_to=");
  expect(decodeURIComponent(request.mock.calls[1][0])).toContain("auth_handoff=");
  expect(localStorage.getItem("fretshift-auth-handoff")).toContain("secret");
});

it("claims a completed standalone handoff and stores the refreshed session", async () => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
  let phase = "create";
  const request = vi.fn().mockImplementation((url: string) => {
    if (url.includes("/rest/v1/rpc/create_auth_handoff"))
      return Promise.resolve(new Response(""));
    if (url.includes("/auth/v1/otp?")) {
      phase = "claim";
      return Promise.resolve(new Response("{}"));
    }
    if (phase === "claim" && url.includes("/rest/v1/rpc/claim_auth_handoff"))
      return Promise.resolve(new Response(JSON.stringify("refresh-from-safari")));
    if (url.includes("/auth/v1/token?grant_type=refresh_token"))
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 3600,
            user: { id: "user-a", email: "player@example.com" },
          }),
        ),
      );
    return Promise.reject(new Error(`Unexpected request: ${url}`));
  });
  vi.stubGlobal("fetch", request);

  await sendMagicLink("player@example.com");
  expect(await claimPendingAuthHandoff()).toBe(true);
  expect(getSession()?.access_token).toBe("new-access");
  expect(localStorage.getItem("fretshift-auth-handoff")).toBeNull();
});

it("verifies callback identity and removes credentials from the URL", async () => {
  history.replaceState(
    null,
    "",
    "/settings#access_token=access&refresh_token=refresh&expires_in=3600",
  );
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ id: "user-a", email: "player@example.com" }),
        ),
      ),
  );
  await initializeAuth();
  expect(location.hash).toBe("");
  expect(getSession()?.user.id).toBe("user-a");
  expect(await getAccessToken()).toBe("access");
});

it("keeps an interrupted callback recoverable without leaving credentials in the URL", async () => {
  history.replaceState(
    null,
    "",
    "/settings#access_token=access&refresh_token=refresh&expires_in=3600",
  );
  vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("offline")));
  await expect(initializeAuth()).rejects.toThrow("offline");
  expect(location.hash).toBe("");
  expect(getSession()).toBeNull();

  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ id: "user-a", email: "player@example.com" }),
        ),
      ),
  );
  await initializeAuth();
  expect(getSession()?.user.id).toBe("user-a");
  expect(await getAccessToken()).toBe("access");
});

it("does not accept an invalid callback and clears a session even when logout is offline", async () => {
  history.replaceState(
    null,
    "",
    "/settings#access_token=bad&refresh_token=refresh",
  );
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response('{"message":"Expired link"}', { status: 401 }),
      ),
  );
  await expect(initializeAuth()).rejects.toThrow("Expired link");
  expect(getSession()).toBeNull();
  expect(location.hash).toBe("");
  window.localStorage.setItem(
    "fretshift-cloud-session",
    JSON.stringify({
      access_token: "a",
      refresh_token: "r",
      expires_at: 1,
      user: { id: "a" },
    }),
  );
  await expect(signOut()).rejects.toThrow();
  expect(getSession()).toBeNull();
});
it("deduplicates refreshes and never restores a session after sign out", async () => {
  window.localStorage.setItem(
    "fretshift-cloud-session",
    JSON.stringify({
      access_token: "a",
      refresh_token: "r",
      expires_at: 1,
      user: { id: "a" },
    }),
  );
  let complete!: (r: Response) => void;
  const request = vi.fn().mockImplementation((url: string) =>
    url.includes("token?")
      ? new Promise<Response>((resolve) => {
          complete = resolve;
        })
      : Promise.resolve(new Response("{}")),
  );
  vi.stubGlobal("fetch", request);
  const first = getAccessToken(),
    second = getAccessToken();
  await signOut();
  complete(
    new Response(
      JSON.stringify({
        access_token: "new",
        refresh_token: "new-r",
        expires_in: 3600,
        user: { id: "a" },
      }),
    ),
  );
  expect(await first).toBeNull();
  expect(await second).toBeNull();
  expect(getSession()).toBeNull();
  expect(request).toHaveBeenCalledTimes(2);
});

it("password sign-up never sends the password before the emailed code is verified", async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const request = vi.fn().mockImplementation((url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    if (url.includes("/functions/v1/password-signup"))
      return Promise.resolve(new Response('{"status":"code_sent"}', { status: 202 }));
    if (url.includes("/auth/v1/verify"))
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "signup-access",
            refresh_token: "signup-refresh",
            expires_in: 3600,
            user: { id: "user-new", email: "new@example.com" },
          }),
        ),
      );
    if (url.endsWith("/auth/v1/user") && init.method === "PUT")
      return Promise.resolve(new Response("{}"));
    return Promise.reject(new Error(`Unexpected request: ${url}`));
  });
  vi.stubGlobal("fetch", request);

  await requestPasswordAccountCode("New@Example.com", "chosen-password");
  expect(calls).toHaveLength(1);
  expect(calls[0].body).toEqual({
    email: "new@example.com",
    redirect_to: `${location.origin}/settings?auth_method=code`,
  });
  expect(JSON.stringify(calls[0].body)).not.toContain("chosen-password");
  expect(getSession()).toBeNull();

  await completePasswordAccount("new@example.com", "12345678", "chosen-password");
  expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
    "POST /functions/v1/password-signup",
    "POST /auth/v1/verify",
    "PUT /auth/v1/user",
  ]);
  expect(calls[2].body).toEqual({ password: "chosen-password" });
  expect(getSession()?.user.id).toBe("user-new");
});

it("password sign-up honours the server rate limit before sending another request", async () => {
  const request = vi.fn().mockResolvedValue(
    new Response('{"error":"Too many account requests."}', {
      status: 429,
      headers: { "Retry-After": "1800" },
    }),
  );
  vi.stubGlobal("fetch", request);
  await expect(
    requestPasswordAccountCode("busy@example.com", "chosen-password"),
  ).rejects.toMatchObject({ status: 429, retryAfterMs: 1_800_000 });
  await expect(
    requestPasswordAccountCode("busy@example.com", "chosen-password"),
  ).rejects.toThrow(/just requested/);
  expect(request).toHaveBeenCalledTimes(1);
});
