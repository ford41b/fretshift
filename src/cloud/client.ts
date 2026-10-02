import { z } from "zod";

const UserSchema = z.object({
  id: z.string().min(1),
  email: z.string().optional(),
});
const SessionSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_at: z.number().finite(),
  user: UserSchema,
});
export type Session = z.infer<typeof SessionSchema>;
const sessionKey = "fretshift-cloud-session";
const pendingCallbackKey = "fretshift-auth-pending-callback";
const magicLinkRetryKey = "fretshift-magic-link-retry-at";
const authHandoffKey = "fretshift-auth-handoff";
const listeners = new Set<() => void>();
let revision = 0;
let refreshing: Promise<string | null> | null = null;

export class AuthRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs = 0,
  ) {
    super(message);
    this.name = "AuthRequestError";
  }
}

const DEFAULT_SUPABASE_URL = "https://prftwxtrphgkohflmfsn.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_U5aIa-jc2j-X2IH7f6w5Kw_IJBKHWLg";

export function cloudConfig(): { url: string; key: string } | null {
  // These defaults are intentionally public client configuration, not secrets.
  // Environment variables still override them for alternate deployments.
  const url = (import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(
    /\/$/,
    "",
  );
  const key =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    DEFAULT_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" &&
      !(
        parsed.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(parsed.hostname)
      )
    )
      return null;
    return { url, key };
  } catch {
    return null;
  }
}

export function getSession(): Session | null {
  try {
    return SessionSchema.parse(
      JSON.parse(window.localStorage.getItem(sessionKey) ?? "null"),
    );
  } catch {
    return null;
  }
}

function saveSession(session: Session | null) {
  revision++;
  if (session) window.localStorage.setItem(sessionKey, JSON.stringify(session));
  else window.localStorage.removeItem(sessionKey);
  listeners.forEach((listener) => listener());
}

export function subscribeAuth(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === sessionKey) {
      revision++;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export async function authRequest(
  path: string,
  body?: unknown,
  token?: string,
): Promise<unknown> {
  const config = cloudConfig();
  if (!config)
    throw new Error(
      "Sign in isn't configured. Follow the Supabase setup in README.",
    );
  const response = await fetch(`${config.url}/auth/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      apikey: config.key,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("Retry-After") || 0);
    throw new AuthRequestError(
      data?.msg ||
        data?.message ||
        data?.error_description ||
        `Account request failed (${response.status}). Try again.`,
      response.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0,
    );
  }
  return data;
}

async function rpcRequest(
  name: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<unknown> {
  const config = cloudConfig();
  if (!config) throw new Error("Cloud sync is not configured.");
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: config.key,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok)
    throw new Error(
      data?.message ||
        data?.hint ||
        `Account handoff failed (${response.status}). Try again.`,
    );
  return data;
}

export function isStandaloneWebApp() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  );
}

const AuthHandoffSchema = z.object({
  id: z.string().uuid(),
  secret: z.string().min(32),
  expiresAt: z.number().finite(),
});
type AuthHandoff = z.infer<typeof AuthHandoffSchema>;

function randomSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function readAuthHandoff(): AuthHandoff | null {
  try {
    const value = AuthHandoffSchema.parse(
      JSON.parse(localStorage.getItem(authHandoffKey) ?? "null"),
    );
    if (value.expiresAt <= Date.now()) {
      localStorage.removeItem(authHandoffKey);
      return null;
    }
    return value;
  } catch {
    localStorage.removeItem(authHandoffKey);
    return null;
  }
}

export function hasPendingAuthHandoff() {
  return Boolean(readAuthHandoff());
}

async function createAuthHandoff() {
  const handoff: AuthHandoff = {
    id: crypto.randomUUID(),
    secret: randomSecret(),
    expiresAt: Date.now() + 10 * 60_000,
  };
  await rpcRequest("create_auth_handoff", {
    p_id: handoff.id,
    p_secret: handoff.secret,
  });
  localStorage.setItem(authHandoffKey, JSON.stringify(handoff));
  return handoff;
}

async function completeAuthHandoff(
  id: string,
  refreshToken: string,
  accessToken: string,
) {
  await rpcRequest(
    "complete_auth_handoff",
    { p_id: id, p_refresh_token: refreshToken },
    accessToken,
  );
}

function parseRefreshResponse(data: unknown) {
  const parsed = z
    .object({
      access_token: z.string(),
      refresh_token: z.string(),
      expires_in: z.number(),
      user: UserSchema,
    })
    .parse(data);
  return SessionSchema.parse({
    ...parsed,
    expires_at: Date.now() / 1000 + parsed.expires_in,
  });
}

export async function claimPendingAuthHandoff(): Promise<boolean> {
  if (getSession()) {
    localStorage.removeItem(authHandoffKey);
    return false;
  }
  const handoff = readAuthHandoff();
  if (!handoff || !navigator.onLine) return false;
  const refreshToken = z
    .string()
    .nullable()
    .parse(
      await rpcRequest("claim_auth_handoff", {
        p_id: handoff.id,
        p_secret: handoff.secret,
      }),
    );
  if (!refreshToken) return false;
  const session = parseRefreshResponse(
    await authRequest("token?grant_type=refresh_token", {
      refresh_token: refreshToken,
    }),
  );
  saveSession(session);
  localStorage.removeItem(authHandoffKey);
  return true;
}

export function getMagicLinkRetryAt() {
  const retryAt = Number(window.localStorage.getItem(magicLinkRetryKey) || 0);
  return Number.isFinite(retryAt) && retryAt > Date.now() ? retryAt : 0;
}

function setMagicLinkRetryAt(retryAt: number) {
  if (retryAt > Date.now())
    window.localStorage.setItem(magicLinkRetryKey, String(retryAt));
  else window.localStorage.removeItem(magicLinkRetryKey);
}

export type EmailSignInMethod = "code" | "magic";

// Supabase uses one Magic Link / OTP email template. FretShift's hosted
// template contains both a one-time code and a link, so users can choose
// whichever path is more reliable on their device. A standalone iPhone PWA
// also prepares the handoff in case the user chooses the link from the email.
async function prepareEmailRedirect(method: EmailSignInMethod) {
  let handoff: AuthHandoff | null = null;
  if (isStandaloneWebApp()) handoff = await createAuthHandoff();
  const redirect = new URL("/settings", location.origin);
  redirect.searchParams.set("auth_method", method);
  if (handoff) redirect.searchParams.set("auth_handoff", handoff.id);
  return { redirect: redirect.toString(), handoff };
}

export async function sendSignInEmail(
  email: string,
  method: EmailSignInMethod = "code",
) {
  const value = z.string().email().parse(email.trim());
  const existingRetryAt = getMagicLinkRetryAt();
  if (existingRetryAt)
    throw new AuthRequestError(
      "A sign-in email was just requested. Wait for the button to become available before trying again.",
      429,
      existingRetryAt - Date.now(),
    );

  const { redirect, handoff } = await prepareEmailRedirect(method);

  try {
    await authRequest(`otp?redirect_to=${encodeURIComponent(redirect)}`, {
      email: value,
      create_user: true,
    });
    setMagicLinkRetryAt(Date.now() + 60_000);
  } catch (error) {
    if (handoff) localStorage.removeItem(authHandoffKey);
    if (error instanceof AuthRequestError && error.status === 429) {
      const projectEmailLimit = /email rate limit exceeded/i.test(error.message);
      const fallbackWait = projectEmailLimit ? 60 * 60_000 : 60_000;
      const wait = Math.max(error.retryAfterMs, fallbackWait);
      setMagicLinkRetryAt(Date.now() + wait);
      throw new AuthRequestError(
        projectEmailLimit
          ? "The project's temporary email quota has been reached. No new email was sent. Wait for the retry timer, then request one email."
          : "Too many sign-in emails were requested. Supabase has temporarily paused new emails. Wait for the retry timer, then request one email.",
        429,
        wait,
      );
    }
    throw error;
  }
}


function validatePasswordCredentials(email: string, password: string) {
  const normalizedEmail = z.string().email().parse(email.trim().toLowerCase());
  const normalizedPassword = z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128, "Password must be 128 characters or fewer.")
    .parse(password);
  return { email: normalizedEmail, password: normalizedPassword };
}

export async function signInWithPassword(email: string, password: string) {
  const credentials = validatePasswordCredentials(email, password);
  const session = parseRefreshResponse(
    await authRequest("token?grant_type=password", credentials),
  );
  saveSession(session);
  localStorage.removeItem(authHandoffKey);
  setMagicLinkRetryAt(0);
  return session;
}

export async function updateCurrentUserPassword(password: string) {
  const config = cloudConfig();
  if (!config)
    throw new Error(
      "Sign in isn't configured. Follow the Supabase setup in README.",
    );

  const nextPassword = z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128, "Password must be 128 characters or fewer.")
    .parse(password);
  const token = await getAccessToken();
  if (!token)
    throw new Error(
      "Sign in with a verification code or magic link before setting a password.",
    );

  const response = await fetch(`${config.url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: nextPassword }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AuthRequestError(
      data?.msg ||
        data?.message ||
        data?.error_description ||
        `Password could not be updated (${response.status}). Try again.`,
      response.status,
    );
  }
  return data;
}

/**
 * Step 1 of password sign-up: ask the server to email a verification code.
 * The password is validated here but never sent; the server cannot know
 * whether the caller owns the address, so it neither confirms the account
 * nor sets a password. The response is the same for new and existing emails.
 */
export async function requestPasswordAccountCode(
  email: string,
  password: string,
) {
  const config = cloudConfig();
  if (!config)
    throw new Error(
      "Sign in isn't configured. Follow the Supabase setup in README.",
    );

  const credentials = validatePasswordCredentials(email, password);
  const existingRetryAt = getMagicLinkRetryAt();
  if (existingRetryAt)
    throw new AuthRequestError(
      "A code was just requested. Wait for the button to become available before trying again.",
      429,
      existingRetryAt - Date.now(),
    );
  const { redirect, handoff } = await prepareEmailRedirect("code");
  let response: Response;
  try {
    response = await fetch(`${config.url}/functions/v1/password-signup`, {
      method: "POST",
      headers: {
        apikey: config.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: credentials.email, redirect_to: redirect }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    if (handoff) localStorage.removeItem(authHandoffKey);
    throw error;
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (handoff) localStorage.removeItem(authHandoffKey);
    const retryAfter = Number(response.headers.get("Retry-After") || 0);
    const wait =
      response.status === 429
        ? Math.max(Number.isFinite(retryAfter) ? retryAfter * 1000 : 0, 60_000)
        : 0;
    if (wait) setMagicLinkRetryAt(Date.now() + wait);
    throw new AuthRequestError(
      data?.error ||
        data?.message ||
        `Account could not be created (${response.status}). Try again.`,
      response.status,
      wait,
    );
  }
  setMagicLinkRetryAt(Date.now() + 60_000);
}

/**
 * Step 2: the emailed code proves the caller owns the address. Only then is
 * the chosen password stored, from the verified session.
 */
export async function completePasswordAccount(
  email: string,
  code: string,
  password: string,
) {
  const credentials = validatePasswordCredentials(email, password);
  const session = await verifyEmailCode(credentials.email, code);
  try {
    await updateCurrentUserPassword(credentials.password);
  } catch (error) {
    throw new AuthRequestError(
      `Signed in, but your password could not be saved (${
        error instanceof Error ? error.message : "unknown error"
      }). Open Set or change password to try again.`,
      error instanceof AuthRequestError ? error.status : 0,
    );
  }
  return session;
}

export async function sendMagicLink(email: string) {
  return sendSignInEmail(email, "magic");
}

export async function sendVerificationCode(email: string) {
  return sendSignInEmail(email, "code");
}

export async function verifyEmailCode(email: string, code: string) {
  const value = z.string().email().parse(email.trim());
  const token = z
    .string()
    .trim()
    .regex(/^\d{8}$/, "Enter the 8-digit code from your email.")
    .parse(code);
  const session = parseRefreshResponse(
    await authRequest("verify", {
      email: value,
      token,
      type: "email",
    }),
  );
  saveSession(session);
  localStorage.removeItem(authHandoffKey);
  setMagicLinkRetryAt(0);
  return session;
}

type PendingAuthCallback = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  handoff_id?: string;
};

function clearAuthCallbackFromAddress() {
  const url = new URL(location.href);
  url.hash = "";
  url.searchParams.delete("auth_handoff");
  url.searchParams.delete("auth_method");
  history.replaceState(null, "", url.pathname + url.search);
}

function readPendingCallback(): PendingAuthCallback | null {
  try {
    return z
      .object({
        access_token: z.string().min(1),
        refresh_token: z.string().min(1),
        expires_in: z.number().positive(),
        handoff_id: z.string().uuid().optional(),
      })
      .parse(
        JSON.parse(window.sessionStorage.getItem(pendingCallbackKey) ?? "null"),
      );
  } catch {
    return null;
  }
}

export async function initializeAuth() {
  const params = new URLSearchParams(location.hash.slice(1));
  let pending = readPendingCallback();

  if (params.has("error_description")) {
    window.sessionStorage.removeItem(pendingCallbackKey);
    clearAuthCallbackFromAddress();
    throw new Error(params.get("error_description")!);
  }

  if (params.has("access_token")) {
    const access_token = params.get("access_token"),
      refresh_token = params.get("refresh_token");
    if (!access_token || !refresh_token) {
      clearAuthCallbackFromAddress();
      throw new Error("This sign-in link is incomplete. Request a new link.");
    }
    const expiresIn = Number(params.get("expires_in") || 3600);
    const handoffId = new URL(location.href).searchParams.get("auth_handoff");
    pending = {
      access_token,
      refresh_token,
      expires_in:
        Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600,
      ...(handoffId ? { handoff_id: handoffId } : {}),
    };
    window.sessionStorage.setItem(pendingCallbackKey, JSON.stringify(pending));
    clearAuthCallbackFromAddress();
  }

  if (!pending) return;
  const started = revision;
  try {
    const user = UserSchema.parse(
      await authRequest("user", undefined, pending.access_token),
    );
    if (pending.handoff_id)
      await completeAuthHandoff(
        pending.handoff_id,
        pending.refresh_token,
        pending.access_token,
      );
    const session = SessionSchema.parse({
      ...pending,
      user,
      expires_at: Date.now() / 1000 + pending.expires_in,
    });
    if (started === revision) saveSession(session);
    window.sessionStorage.removeItem(pendingCallbackKey);
  } catch (error) {
    if (
      error instanceof AuthRequestError &&
      error.status >= 400 &&
      error.status < 500
    )
      window.sessionStorage.removeItem(pendingCallbackKey);
    throw error;
  }
}

export async function getAccessToken(): Promise<string | null> {
  const session = getSession();
  if (!session) return null;
  if (session.expires_at > Date.now() / 1000 + 60) return session.access_token;
  if (refreshing) return refreshing;
  const started = revision;
  refreshing = (async () => {
    const next = parseRefreshResponse(
      await authRequest("token?grant_type=refresh_token", {
        refresh_token: session.refresh_token,
      }),
    );
    if (started !== revision) return null;
    saveSession(next);
    return next.access_token;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function signOut() {
  const session = getSession();
  saveSession(null);
  if (session)
    await authRequest("logout?scope=local", {}, session.access_token);
}
