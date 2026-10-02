import { randomUUID } from "node:crypto";

const baseUrl = (
  process.env.VITE_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  ""
).replace(/\/$/, "");
const publicKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "";
const userToken = process.env.FRETSHIFT_USER_ACCESS_TOKEN ?? "";
const origin =
  process.env.FRETSHIFT_APP_ORIGIN ?? "http://127.0.0.1:5173";

if (!baseUrl || !publicKey) {
  console.error(
    "Live verification needs VITE_SUPABASE_URL plus VITE_SUPABASE_ANON_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY).",
  );
  process.exit(1);
}

let failed = false;
const rows = [];

function record(name, ok, detail) {
  rows.push({ name, ok, detail });
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${detail}`);
}

async function request(path, init = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(15_000),
    headers: {
      apikey: publicKey,
      ...(init.headers ?? {}),
    },
  });
}

async function jsonOrText(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

try {
  const response = await request("/auth/v1/settings");
  record(
    "Auth endpoint",
    response.ok,
    response.ok ? `HTTP ${response.status}` : `HTTP ${response.status}`,
  );
} catch (error) {
  record("Auth endpoint", false, String(error));
}

try {
  const response = await request("/rest/v1/rpc/read_song_share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: `live-probe-${randomUUID()}` }),
  });
  const body = await jsonOrText(response);
  record(
    "Public share RPC",
    response.ok && Array.isArray(body),
    response.ok
      ? `HTTP ${response.status}; migration RPC is reachable without mutating data`
      : `HTTP ${response.status}`,
  );
} catch (error) {
  record("Public share RPC", false, String(error));
}

try {
  const response = await request("/functions/v1/vision-import", {
    method: "OPTIONS",
    headers: { Origin: origin },
  });
  const allowOrigin = response.headers.get("access-control-allow-origin");
  record(
    "Vision function CORS",
    response.status === 204 && allowOrigin === origin,
    `HTTP ${response.status}; allow-origin=${allowOrigin ?? "missing"}`,
  );
} catch (error) {
  record("Vision function CORS", false, String(error));
}

if (!userToken) {
  console.log(
    "SKIP  Signed-in checks: FRETSHIFT_USER_ACCESS_TOKEN is not set. No account data was changed.",
  );
} else {
  let userId = "";
  try {
    const response = await request("/auth/v1/user", {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const body = await jsonOrText(response);
    userId =
      body && typeof body === "object" && typeof body.id === "string"
        ? body.id
        : "";
    record(
      "Signed-in session",
      response.ok && Boolean(userId),
      response.ok ? `HTTP ${response.status}; user verified` : `HTTP ${response.status}`,
    );
  } catch (error) {
    record("Signed-in session", false, String(error));
  }

  if (userId) {
    try {
      const response = await request(
        "/rest/v1/sync_records?select=kind,record_id,revision&limit=1",
        { headers: { Authorization: `Bearer ${userToken}` } },
      );
      const body = await jsonOrText(response);
      record(
        "Authenticated sync table",
        response.ok && Array.isArray(body),
        response.ok ? `HTTP ${response.status}; RLS-authenticated read works` : `HTTP ${response.status}`,
      );
    } catch (error) {
      record("Authenticated sync table", false, String(error));
    }

    try {
      const probeId = `live-probe-${randomUUID()}`;
      const response = await request("/rest/v1/rpc/sync_cas", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_kind: "song",
          p_record_id: probeId,
          p_payload: { probe: true },
          p_deleted_at: null,
          p_expected_revision: 2147483647,
        }),
      });
      const body = await jsonOrText(response);
      record(
        "Sync CAS RPC dry probe",
        response.ok && Array.isArray(body) && body.length === 0,
        response.ok
          ? `HTTP ${response.status}; no row created or changed`
          : `HTTP ${response.status}`,
      );
    } catch (error) {
      record("Sync CAS RPC dry probe", false, String(error));
    }

    try {
      const response = await request("/functions/v1/vision-import", {
        method: "POST",
        headers: {
          Origin: origin,
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pages: [], hints: {} }),
      });
      const body = await jsonOrText(response);
      const message =
        body && typeof body === "object" && typeof body.error === "string"
          ? body.error
          : "";
      const ok = response.status === 400;
      const detail =
        response.status === 400
          ? "HTTP 400 from request validation; auth and OCR secret path are live, and no provider call was made"
          : response.status === 503
            ? "HTTP 503; function is live but OCR_SPACE_API_KEY is not configured"
            : `HTTP ${response.status}${message ? `; ${message}` : ""}`;
      record("Vision authenticated dry probe", ok, detail);
    } catch (error) {
      record("Vision authenticated dry probe", false, String(error));
    }
  }
}

console.log("\nLive verification is non-destructive: it does not create sync rows, shares, or OCR provider calls.");
if (failed) process.exitCode = 1;
