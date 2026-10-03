import { expect, test, type Page, type Route } from "@playwright/test";

// MOCKED evidence only: the Edge Function, Gemini and YouTube's IFrame API are
// all faked here. No paid API or YouTube request is made by this spec.
const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/youtube-import";
const ID = "dQw4w9WgXcQ";
const session = {
  access_token: "e2e-access",
  refresh_token: "e2e-refresh",
  expires_at: 4_000_000_000,
  user: { id: "e2e-account", email: "player@example.com" },
};

/** Real-time fake of YouTube's IFrame Player API (no network, no iframe). */
const FAKE_IFRAME_API = `
window.__ytFake = { players: [] };
window.YT = { Player: class {
  constructor(element, options) {
    this.options = options; this.offset = (options.playerVars && options.playerVars.start) || 0;
    this.startedAt = 0; this.state = -1; this.rate = 1;
    const box = document.createElement("div"); box.className = "fake-yt"; box.textContent = "Fake YouTube " + options.videoId;
    element.replaceWith(box); this.box = box; window.__ytFake.players.push(this);
    setTimeout(() => options.events && options.events.onReady && options.events.onReady(), 20);
  }
  now() { return this.state === 1 ? this.offset + (performance.now() - this.startedAt) / 1000 * this.rate : this.offset; }
  playVideo() { if (this.state !== 1) { this.startedAt = performance.now(); this.state = 1; } }
  pauseVideo() { this.offset = this.now(); this.state = 2; }
  seekTo(time) { this.offset = time; this.startedAt = performance.now(); }
  getCurrentTime() { return this.now(); }
  getDuration() { return 180; }
  getPlayerState() { return this.state; }
  setPlaybackRate(rate) { this.offset = this.now(); this.startedAt = performance.now(); this.rate = rate; }
  destroy() { this.box.remove(); }
} };
if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
`;

type Chord = [number, number, string];
function wire(body: { segment: { startSeconds: number; endSeconds: number }; pass: number; fps: number }, chords: Chord[]) {
  return {
    videoId: ID, segment: body.segment, fps: body.fps, pass: body.pass,
    analysis: {
      tempoBpm: 120, meter: 4, key: "G", capoGuess: 2, firstDownbeatSeconds: 0,
      sections: [{ label: "verse", startSeconds: 0, endSeconds: 16 }],
      chords: chords.map(([startSeconds, endSeconds, chord]) => ({ startSeconds, endSeconds,
        chord: chord === "N.C." ? null : chord, kind: chord === "N.C." ? "no-chord" : "chord", confidence: 0.9,
        evidence: "heard_and_seen" })),
      sanitized: { labels: 0, times: 0, outsideWindowSeconds: 0 }, timingSuspect: false,
    },
    video: { title: "Video title from YouTube", channel: "Teacher" },
    usage: { promptTokens: 9000, outputTokens: 400, totalTokens: 9400 },
    modelId: "gemini-3.8-flash", promptVersion: "youtube-chords-v1", processedAt: "2026-10-03T12:00:00.000Z",
  };
}

async function setup(page: Page, options: { signedIn?: boolean; post?: (route: Route, body: Record<string, unknown>) => Promise<void> } = {}) {
  const calls = { posts: [] as Array<{ body: Record<string, unknown>; authorization: string | null }>, external: [] as string[] };
  if (options.signedIn !== false)
    await page.addInitScript((value) => localStorage.setItem("fretshift-cloud-session", JSON.stringify(value)), session);
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route(FUNCTION_URL, async (route) => {
    const request = route.request();
    if (request.method() === "GET")
      return route.fulfill({ json: { status: "ok", providerConfigured: true, authentication: "required", modelId: "gemini-3.8-flash" } });
    const body = request.postDataJSON();
    calls.posts.push({ body, authorization: request.headers()["authorization"] ?? null });
    if (options.post) return options.post(route, body);
    const disputed = body.pass === 1 ? "D" : "Em";
    return route.fulfill({ json: wire(body, [[0, 8, "G"], [8, 16, "C"], [16, 24, disputed]]) });
  });
  await page.route("https://www.youtube.com/iframe_api", (route) =>
    route.fulfill({ contentType: "text/javascript", body: FAKE_IFRAME_API }));
  for (const host of ["https://www.youtube-nocookie.com/**", "https://generativelanguage.googleapis.com/**", "https://*.ytimg.com/**"])
    await page.route(host, (route) => { calls.external.push(route.request().url()); return route.abort(); });
  return calls;
}

async function openYouTubeImport(page: Page) {
  await page.goto("/import");
  await page.getByRole("button", { name: /YouTube link/ }).click();
  await expect(page.getByRole("heading", { name: "Chords from a YouTube lesson" })).toBeVisible();
}

async function acceptPrivacy(page: Page) {
  const notice = page.getByRole("region", { name: "YouTube import privacy notice" });
  await expect(notice).toContainText("Google's Gemini API");
  await expect(notice).toContainText("never downloads YouTube audio or video");
  await expect(notice).toContainText("Lyrics are never requested or stored");
  await notice.getByRole("button", { name: "I understand, continue" }).click();
  await expect(notice).toHaveCount(0);
}

test("YouTube link: privacy notice, hints, voted draft, synced player, tap-along, save and reopen", async ({ page }) => {
  const calls = await setup(page);
  await openYouTubeImport(page);
  await acceptPrivacy(page);
  await page.getByLabel("YouTube link").fill("not a link");
  await expect(page.getByText("Use a youtube.com/watch, youtu.be or youtube.com/shorts link")).toBeVisible();
  await expect(page.getByRole("button", { name: "Analyze video" })).toBeDisabled();
  await page.getByLabel("YouTube link").fill(`https://youtu.be/${ID}?si=share`);
  await expect(page.locator(".fake-yt")).toContainText(ID);
  await expect(page.getByText("Video length 3:00.0")).toBeVisible();
  await page.getByLabel("Song title (optional)").fill("Lesson Song");
  await page.getByLabel("Tuning (optional)").selectOption("drop-d");
  await page.getByLabel("Capo (optional)").fill("2");
  await page.getByLabel("End time (optional)").fill("0:24");
  await page.getByLabel(/\(d\) Independent passes/).selectOption("2");
  await expect(page.getByText("This analysis uses 2 Gemini requests from your quota.")).toBeVisible();
  await page.getByRole("button", { name: "Analyze video" }).click();

  await expect(page.getByRole("heading", { name: "Review the YouTube chord draft" })).toBeVisible();
  expect(calls.posts.map((call) => call.body.pass).sort()).toEqual([1, 2]);
  for (const { body, authorization } of calls.posts) {
    expect(authorization).toBe("Bearer e2e-access");
    expect(body).toMatchObject({ url: `https://www.youtube.com/watch?v=${ID}`, fps: 1, segment: { startSeconds: 0, endSeconds: 24 },
      videoDurationSeconds: 180, hints: { title: "Lesson Song", tuning: "Drop D", capo: 2 } });
  }
  const regions = page.locator(".ai-regions button");
  await expect(regions).toHaveText(["G", "C", "Unknown"]);
  await expect(page.getByText("1 chord regions need review")).toBeVisible();
  await expect(page.getByLabel("Song title")).toHaveValue("Lesson Song");

  // The timeline drives the embedded player.
  await regions.nth(1).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __ytFake: { players: Array<{ getCurrentTime(): number }> } })
    .__ytFake.players.at(-1)!.getCurrentTime())).toBeCloseTo(8, 0);
  await expect(page.getByText(/Suggested chord: C/)).toBeVisible();
  await regions.nth(2).click();
  await expect(page.locator(".ai-edit")).toContainText("Suggested chord: needs review");
  await expect(page.locator(".ai-edit .button-row button")).toHaveText(["D", "Em"]);

  // Tap along at 120 BPM from the start of the video.
  await regions.nth(0).click();
  await page.getByRole("button", { name: "Play video" }).click();
  await page.locator(".fake-yt").waitFor();
  await page.evaluate(async () => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent === "Tap beat")!;
    for (let i = 0; i < 8; i++) {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  });
  const tapStatus = page.locator(".yt-tap [role=status]");
  await expect(tapStatus).toContainText("8 taps");
  const bpm = Number((await tapStatus.textContent())!.match(/([\d.]+) BPM/)![1]);
  expect(bpm).toBeGreaterThan(110);
  expect(bpm).toBeLessThan(130);
  await page.getByRole("button", { name: "Use tapped tempo and downbeat" }).click();
  await expect(page.locator(".ai-notice")).toContainText(/Applied [\d.]+ BPM from 8 taps/);
  await expect(page.locator(".ai-notice")).toContainText("snapped to the beat grid");
  await expect(page.getByText("Timing needs review.")).toBeVisible();

  await page.getByRole("button", { name: "Save as FretShift song" }).click();
  await expect(page.getByRole("alert")).toContainText("Review each uncertain region");
  await page.getByRole("button", { name: "Mark all uncertain regions Unknown" }).click();
  await page.getByRole("button", { name: "Save as FretShift song" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Chord draft saved" })).toContainText("the video stays on YouTube");

  await page.getByRole("link", { name: "Reopen transcription" }).click();
  await expect(page.getByRole("heading", { name: "Edit YouTube chord timeline" })).toBeVisible();
  await expect(page.locator(".fake-yt")).toContainText(ID);
  await expect(page.locator(".ai-regions button")).toHaveText(["G", "C", "Unknown"]);
  const stored = await page.evaluate(async () => {
    const request = indexedDB.open("fretshift-v1");
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = reject; });
    const songs = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const all = db.transaction("songs").objectStore("songs").getAll();
      all.onsuccess = () => resolve(all.result); all.onerror = reject;
    });
    db.close();
    return songs.filter((song) => (song.provenance as { source?: string } | undefined)?.source === "youtube")
      .map((song) => ({ title: song.title, capo: song.capo, tuningId: song.tuningId, provenance: song.provenance }));
  });
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ title: "Lesson Song", capo: 2, tuningId: "drop-d",
    provenance: { source: "youtube", modelId: "gemini-3.8-flash", promptVersion: "youtube-chords-v1", timingNeedsConfirmation: true,
      youtube: { videoId: ID, startSeconds: 0, endSeconds: 24, requests: 2, options: { passes: 2 } } } });
  expect(JSON.stringify(stored)).not.toMatch(/lyric/i);
  expect(calls.external).toEqual([]);
});

test("YouTube link: progress, cancel, clear provider errors and retry", async ({ page }) => {
  let mode: "hang" | "private" | "ok" = "hang";
  const calls = await setup(page, {
    post: async (route, body) => {
      if (mode === "hang") { await new Promise((resolve) => setTimeout(resolve, 5000)); return route.abort().catch(() => undefined); }
      if (mode === "private")
        return route.fulfill({ status: 422, json: { error: "This video is private or its owner turned off embedding. FretShift can analyze only public videos that play in an embedded player.", code: "private-video", retryable: false } });
      return route.fulfill({ json: wire(body as never, [[0, 12, "Am"], [12, 20, "F"]]) });
    },
  });
  await openYouTubeImport(page);
  await acceptPrivacy(page);
  await page.getByLabel("YouTube link").fill(`https://www.youtube.com/shorts/${ID}`);
  await page.getByLabel("End time (optional)").fill("20");
  await expect(page.getByText("Video length 3:00.0")).toBeVisible();
  await page.getByRole("button", { name: "Analyze video" }).click();
  const progress = page.locator(".yt-progress");
  await expect(progress).toContainText("Analyzing with Gemini… 0 of 1 part done");
  await progress.getByRole("button", { name: "Cancel analysis" }).click();
  await expect(page.locator(".ai-notice")).toContainText("Analysis cancelled.");
  mode = "private";
  await page.getByRole("button", { name: "Retry analysis" }).click();
  await expect(page.getByRole("alert")).toContainText("This video is private");
  mode = "ok";
  await page.getByRole("button", { name: "Retry analysis" }).click();
  await expect(page.locator(".ai-regions button")).toHaveText(["Am", "F"]);
  expect(calls.posts.length).toBeGreaterThanOrEqual(3);
  // Unsaved review edits autosave to this device (IndexedDB) shortly after each change.
  await expect.poll(() => page.evaluate(async () => {
    const request = indexedDB.open("fretshift-v1");
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = reject; });
    const row = await new Promise<unknown>((resolve, reject) => {
      const get = db.transaction("meta").objectStore("meta").get("audio-review-draft:youtube-new");
      get.onsuccess = () => resolve(get.result); get.onerror = reject;
    });
    db.close();
    return !!row;
  })).toBe(true);

  // The privacy notice is shown once.
  await page.reload();
  await page.getByRole("button", { name: /YouTube link/ }).click();
  await expect(page.getByRole("region", { name: "YouTube import privacy notice" })).toHaveCount(0);
  await expect(page.getByText(/Unsaved review of a YouTube video/)).toBeVisible();
  await page.getByRole("button", { name: "Restore review" }).click();
  await expect(page.locator(".ai-regions button")).toHaveText(["Am", "F"]);
});

test("YouTube link explains that sign-in is required", async ({ page }) => {
  await setup(page, { signedIn: false });
  await openYouTubeImport(page);
  await expect(page.getByRole("status").filter({ hasText: "Sign in under Account & sync to analyze YouTube links" })).toBeVisible();
  await acceptPrivacy(page);
  await page.getByLabel("YouTube link").fill(`https://www.youtube.com/watch?v=${ID}`);
  await expect(page.getByRole("button", { name: "Analyze video" })).toBeDisabled();
});
