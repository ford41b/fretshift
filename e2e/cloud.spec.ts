import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newSong, resolveTuning } from "../src/schema/song.v1";

const session = {
  access_token: "e2e-access",
  refresh_token: "e2e-refresh",
  expires_at: 4_000_000_000,
  user: { id: "e2e-account", email: "player@example.com" },
};

async function signedIn(page: Page) {
  await page.addInitScript(
    (value) =>
      localStorage.setItem("fretshift-cloud-session", JSON.stringify(value)),
    session,
  );
}

async function mockCloud(page: Page) {
  const records = new Map<string, Record<string, unknown>>();
  const shares = new Map<
    string,
    {
      song: unknown;
      tuning: unknown;
      created_at: string;
      revoked_at: string | null;
    }
  >();
  await page.route("http://127.0.0.1:54321/rest/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/sync_records")) {
      // Behaves like PostgREST: honours the updated_at filter and Range, and
      // reports Content-Range (the client refuses responses without it).
      const since = new URL(request.url()).searchParams.get("updated_at");
      const rows = [...records.values()].filter(
        (row) =>
          !since ||
          Date.parse(String(row.updated_at)) >= Date.parse(since.replace(/^gte\./, "")),
      );
      const [from, to] = (request.headers()["range"] ?? "0-999").split("-").map(Number);
      const page = rows.slice(from, to + 1);
      return route.fulfill({
        status: 206,
        json: page,
        headers: {
          "Content-Range": page.length
            ? `${from}-${from + page.length - 1}/${rows.length}`
            : `*/${rows.length}`,
        },
      });
    }
    if (path.endsWith("/rpc/sync_cas")) {
      const body = request.postDataJSON();
      const key = `${body.p_kind}:${body.p_record_id}`;
      const current = records.get(key);
      const revision = Number(current?.revision ?? 0) + 1;
      const value = {
        ok: true,
        kind: body.p_kind,
        record_id: body.p_record_id,
        payload: body.p_payload,
        updated_at: new Date().toISOString(),
        deleted_at: body.p_deleted_at,
        revision,
      };
      records.set(key, value);
      return route.fulfill({ json: [value] });
    }
    if (path.endsWith("/song_shares")) {
      return route.fulfill({
        json: [...shares].map(([token, value]) => ({ token, ...value })),
      });
    }
    if (path.endsWith("/rpc/create_song_share")) {
      const body = request.postDataJSON();
      expect(body.p_song).not.toHaveProperty("ownerId");
      expect(body.p_song).not.toHaveProperty("referenceAudio");
      const token = `share-${shares.size + 1}`;
      shares.set(token, {
        song: body.p_song,
        tuning: body.p_tuning,
        created_at: new Date().toISOString(),
        revoked_at: null,
      });
      return route.fulfill({ json: [{ token }] });
    }
    if (path.endsWith("/rpc/revoke_song_share")) {
      const body = request.postDataJSON();
      const share = shares.get(body.p_token);
      if (share) share.revoked_at = new Date().toISOString();
      return route.fulfill({ json: null });
    }
    if (path.endsWith("/rpc/read_song_share")) {
      const body = request.postDataJSON();
      const share = shares.get(body.p_token);
      return route.fulfill({
        json:
          share && !share.revoked_at
            ? [{ song: share.song, tuning: share.tuning }]
            : [],
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return shares;
}

test("magic-link request has a mocked browser flow", async ({ page }) => {
  await page.route("http://127.0.0.1:54321/auth/v1/otp**", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.goto("/settings");
  await page.getByLabel("Email address").fill("player@example.com");
  await page.getByRole("button", { name: "Magic link", exact: true }).click();
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText(/Check your email/)).toBeVisible();
});

test("password sign-up confirms the emailed code before saving the password", async ({
  page,
}) => {
  await mockCloud(page);
  const sent: Array<{ path: string; body: unknown }> = [];
  await page.route("http://127.0.0.1:54321/functions/v1/password-signup", (route) => {
    sent.push({ path: "signup", body: route.request().postDataJSON() });
    return route.fulfill({ status: 202, json: { status: "code_sent" } });
  });
  await page.route("http://127.0.0.1:54321/auth/v1/verify", (route) => {
    sent.push({ path: "verify", body: route.request().postDataJSON() });
    return route.fulfill({
      json: {
        access_token: "e2e-access",
        refresh_token: "e2e-refresh",
        expires_in: 3600,
        user: { id: "e2e-account", email: "new@example.com" },
      },
    });
  });
  await page.route("http://127.0.0.1:54321/auth/v1/user", (route) => {
    sent.push({ path: "user", body: route.request().postDataJSON() });
    return route.fulfill({ json: {} });
  });
  await page.goto("/settings");
  await page.getByLabel("Email address").fill("new@example.com");
  await page.getByRole("button", { name: "Email + password", exact: true }).click();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill("chosen-password");
  await page.getByRole("button", { name: "Create account · email me a code" }).click();
  await expect(page.getByText(/Code sent\. Enter the 8-digit code/)).toBeVisible();
  // Nothing is signed in yet and the password has not left the browser.
  expect(sent).toHaveLength(1);
  expect(JSON.stringify(sent[0].body)).not.toContain("chosen-password");
  await page.getByLabel("8-digit verification code").fill("12345678");
  await page.getByRole("button", { name: "Verify & create account" }).click();
  await expect(page.getByText(/Signed in as/)).toContainText("new@example.com");
  expect(sent.map((entry) => entry.path)).toEqual(["signup", "verify", "user"]);
  expect(sent[2].body).toEqual({ password: "chosen-password" });
});

test("signed-in sync and owner share management survive reopening", async ({
  page,
}) => {
  await signedIn(page);
  await mockCloud(page);
  await page.goto("/settings");
  await expect(page.getByText(/Signed in as/)).toContainText(
    "player@example.com",
  );
  await page.goto("/song/sample-1");
  await page.getByRole("button", { name: "Source and export" }).click();
  await page.getByRole("button", { name: "Create read-only link" }).click();
  await expect(page.getByLabel("Share link")).toHaveValue(/\/share\/share-1$/);
  await page.goto("/");
  await page.goto("/song/sample-1");
  await page.getByRole("button", { name: "Source and export" }).click();
  await expect(page.getByLabel("Share link")).toHaveValue(/\/share\/share-1$/);
  await page.getByRole("button", { name: "Revoke link" }).click();
  await expect(page.getByLabel("Share link")).toHaveCount(0);
});

test("public share loads, transposes, and saves a private copy", async ({
  page,
}) => {
  const shares = await mockCloud(page);
  const song = {
    ...newSong("Shared Road"),
    id: "shared-song",
    ownerId: "private-owner",
    referenceAudio: { fileName: "private.wav", offsetMs: 0, sourceTempo: 120 },
  };
  shares.set("public-token", {
    song,
    tuning: resolveTuning("standard"),
    created_at: new Date().toISOString(),
    revoked_at: null,
  });
  await page.goto("/share/public-token");
  await expect(
    page.getByRole("heading", { name: "Shared Road" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Transpose up" }).click();
  await page.getByRole("button", { name: "Save a copy" }).click();
  await expect(page).toHaveURL(/\/song\//);
});

test("photo import sends prepared pages and accepts a validated mocked draft", async ({
  page,
}) => {
  await signedIn(page);
  await mockCloud(page);
  await page.route(
    "http://127.0.0.1:54321/functions/v1/vision-import",
    async (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: { providerConfigured: true } });
      const body = route.request().postDataJSON();
      return route.fulfill({
        json: {
          pages: body.pages.map((value: { id: string }) => ({
            id: value.id,
            text: "Vision Draft\nKey: C\nVerse\nC G Am F\nSing along",
          })),
          pageIds: body.pages.map((value: { id: string }) => value.id),
          modelId: "ocr-space-engine-3",
          promptVersion: "ocr-v1",
          processedAt: new Date().toISOString(),
        },
      });
    },
  );
  await page.goto("/import");
  await page.getByRole("button", { name: /Photos & scans/ }).click();
  await page
    .getByLabel("Choose chart photos or a PDF")
    .setInputFiles("test-fixtures/vision-corpus/provisional-01-page-1.jpg");
  await page.getByRole("button", { name: "Prepare exact OCR previews" }).click();
  await page.getByRole("button", { name: "Recognize prepared pages" }).click();
  await expect(page.getByText("1 draft ready for review")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vision Draft" })).toBeVisible();
});

test("new cloud surfaces have no serious axe findings in mobile dark mode", async ({
  page,
}) => {
  await signedIn(page);
  await mockCloud(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.waitForTimeout(250);
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});
