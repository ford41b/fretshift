import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const encoded = (["wav", "mp3", "m4a"] as const).map((extension) => ({
  name: `codec-c-major.${extension}`,
  bytes: readFileSync(`test-fixtures/audio-intelligence/codec-c-major.${extension}`).toString("base64"),
}));

test("browser decodes local WAV, MP3, and M4A in the real analysis Worker", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(async (files) => {
    const { analyzeAudioIntelligenceFile } = await import("/src/audio/intelligence/index.ts");
    const outputs = [];
    for (const input of files) {
      const bytes = Uint8Array.from(atob(input.bytes), (character) => character.charCodeAt(0));
      const file = new File([bytes], input.name);
      try {
        const result = await analyzeAudioIntelligenceFile(file);
        outputs.push({ name: input.name, version: result.version,
          duration: result.duration, beatProvider: result.beats.providerId,
          chordProvider: result.chords.providerId, notes: result.notes });
      } catch (error) {
        outputs.push({ name: input.name, error: String(error) });
      }
    }
    return outputs;
  }, encoded);
  console.log("Audio codec check", JSON.stringify(results));
  // Playwright's open-source Chromium (used on CI) ships without AAC. Where the
  // browser itself reports no AAC support, M4A must fail with the friendly
  // conversion message instead of hanging or crashing.
  const aac = await page.evaluate(
    () => new Audio().canPlayType('audio/mp4; codecs="mp4a.40.2"') !== "",
  );
  for (const result of results) {
    if (!aac && result.name.endsWith(".m4a")) {
      expect(result).toMatchObject({
        error: expect.stringContaining("could not decode the audio. Try WAV or MP3"),
      });
      continue;
    }
    expect(result, `${result.name}: ${"error" in result ? result.error : ""}`).toMatchObject({
      version: 1,
      beatProvider: "fretshift-onset-grid-v1",
      chordProvider: "fretshift-chroma-templates-v1",
      notes: null,
    });
    expect(result.duration).toBeCloseTo(4, 1);
  }
});

test("audio upload, local review, save, reopen, and Immersive entry", async ({ page }, testInfo) => {
  await page.goto("/import");
  await page.getByRole("button", { name: /Audio recording/ }).click();
  await expect(page.getByRole("heading", { name: "Audio to chords and rhythm" })).toBeVisible();
  await page.getByLabel("Choose audio for Audio Intelligence").setInputFiles(
    "test-fixtures/audio-intelligence/codec-c-major.wav");
  await expect(page.locator(".ai-regions button").first()).toBeVisible({ timeout: 30000 });
  await page.locator(".ai-review").screenshot({ path: testInfo.outputPath("desktop.png") });
  const count = await page.locator(".ai-regions button").count();
  for (let i = 0; i < count; i++) {
    await page.locator(".ai-regions button").nth(i).click();
    if (i === 0) {
      await page.getByLabel("Replacement chord").fill("C");
      await page.getByLabel("Replacement chord").blur();
    } else if (await page.locator(".ai-edit p").getByText(/Suggested chord: needs review/).count())
      await page.getByRole("button", { name: "Mark unknown" }).click();
  }
  await page.getByRole("button", { name: "Apply BPM and rebuild beats" }).click();
  await page.getByLabel(/I checked the beat grid/).check();
  await page.getByRole("button", { name: "Save as FretShift song" }).click();
  await expect(page.getByRole("link", { name: "Reopen transcription" })).toBeVisible();
  await expect.poll(() => page.evaluate(async () =>
    (await import("/src/store/songStore.ts")).useSongStore.getState().saveState))
    .toBe("Saved on this device");
  await page.getByRole("link", { name: "Reopen transcription" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Edit audio transcription" })).toBeVisible();
  await expect(page.getByText(/Raw audio was not retained/)).toBeVisible();
  await page.getByLabel("Reattach original audio").setInputFiles({
    name: "codec-c-major.wav", mimeType: "audio/wav", buffer: Buffer.from("wrong recording"),
  });
  await expect(page.getByRole("alert")).toContainText("does not match the saved recording");
  await page.getByLabel("Reattach original audio").setInputFiles(
    "test-fixtures/audio-intelligence/codec-c-major.wav");
  await expect(page.getByText("Original audio verified and attached for this session.")).toBeVisible();
  await page.getByRole("link", { name: "Immersive Practice", exact: true }).click();
  await expect(page.getByRole("region", { name: "Immersive practice" })).toBeVisible();
  await expect(page.getByText("Coming soon", { exact: false })).toHaveCount(0);
});

test("unsaved review edits are autosaved, restored after reload, and cleared on discard or save", async ({ page }) => {
  const draft = () => page.evaluate(async () =>
    (await (await import("/src/persistence/dexie/index.ts")).db.meta.get("audio-review-draft:new"))?.value ?? null);
  const openNewAnalysis = async () => {
    await page.goto("/import");
    await page.getByRole("button", { name: /Audio recording/ }).click();
  };
  await openNewAnalysis();
  await page.getByLabel("Choose audio for Audio Intelligence").setInputFiles(
    "test-fixtures/audio-intelligence/codec-c-major.wav");
  await expect(page.locator(".ai-regions button").first()).toBeVisible({ timeout: 30000 });
  await page.getByLabel("Song title").fill("Draft survives reload");
  await expect.poll(async () => (await draft() as { title?: string } | null)?.title).toBe("Draft survives reload");

  await page.reload();
  await page.getByRole("button", { name: /Audio recording/ }).click();
  await expect(page.getByText(/Restored unsaved changes from/)).toBeVisible();
  await expect(page.getByLabel("Song title")).toHaveValue("Draft survives reload");
  await expect(page.locator(".ai-regions button").first()).toBeVisible();
  // A restored draft has no audio; choosing a file reattaches rather than re-analyzing.
  await expect(page.getByLabel("Reattach original audio")).toBeAttached();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Discard unsaved changes" }).click();
  await expect(page.getByText("Unsaved changes discarded.")).toBeVisible();
  await expect(page.locator(".ai-regions button")).toHaveCount(0);
  expect(await draft()).toBeNull();
  await openNewAnalysis();
  await expect(page.getByText(/Restored unsaved changes/)).toHaveCount(0);

  // Saving clears the draft too.
  await page.getByLabel("Choose audio for Audio Intelligence").setInputFiles(
    "test-fixtures/audio-intelligence/codec-c-major.wav");
  await expect(page.locator(".ai-regions button").first()).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Mark all uncertain regions Unknown" }).click().catch(() => undefined);
  await expect.poll(draft).not.toBeNull();
  await page.getByRole("button", { name: "Save as FretShift song" }).click();
  await expect(page.getByRole("link", { name: "Reopen transcription" })).toBeVisible();
  await expect.poll(draft).toBeNull();
});

test("cancelled analysis rejects and retry succeeds", async ({ page }) => {
  await page.goto("/");
  const outcome = await page.evaluate(async (encodedFile) => {
    const { analyzeAudioIntelligenceFile } = await import("/src/audio/intelligence/index.ts");
    const bytes = Uint8Array.from(atob(encodedFile.bytes), (character) => character.charCodeAt(0));
    const file = new File([bytes], encodedFile.name);
    const controller = new AbortController();
    controller.abort();
    let cancelled = false;
    try { await analyzeAudioIntelligenceFile(file, controller.signal); }
    catch (error) { cancelled = error instanceof DOMException && error.name === "AbortError"; }
    return { cancelled, retry: (await analyzeAudioIntelligenceFile(file)).version };
  }, encoded[0]);
  expect(outcome).toEqual({ cancelled: true, retry: 1 });
});

test("large files are rejected and real-recording review remains editable offline", async ({ page, context }) => {
  await page.goto("/import");
  await page.getByRole("button", { name: /Audio recording/ }).click();
  await page.getByLabel("Choose audio for Audio Intelligence").setInputFiles({
    name: "oversized.wav", mimeType: "audio/wav", buffer: Buffer.alloc(30 * 1024 * 1024 + 1),
  });
  await expect(page.getByRole("alert")).toContainText("no larger than 30 MB");
  await page.getByLabel("Choose audio for Audio Intelligence").setInputFiles(
    "test-fixtures/audio-intelligence/guitarset/00_BN1-129-Eb_comp.wav");
  await expect(page.getByRole("button", { name: "Mark all uncertain regions Unknown" })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Mark all uncertain regions Unknown" }).click();
  await expect(page.getByRole("button", { name: "Mark all uncertain regions Unknown" })).toHaveCount(0);
  await expect(page.locator(".ai-regions button").first()).toBeVisible();
  await context.setOffline(false);
});

test("mobile timeline releases its local audio URL on navigation", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/import");
  await page.evaluate(() => {
    const original = URL.revokeObjectURL.bind(URL);
    (window as typeof window & { revokedAudioUrls?: string[] }).revokedAudioUrls = [];
    URL.revokeObjectURL = (value) => {
      (window as typeof window & { revokedAudioUrls: string[] }).revokedAudioUrls.push(value);
      original(value);
    };
  });
  await page.getByRole("button", { name: /Audio recording/ }).click();
  await page.getByLabel("Choose audio for Audio Intelligence").setInputFiles(
    "test-fixtures/audio-intelligence/codec-c-major.wav");
  await expect(page.locator(".ai-regions button").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const waveform = await page.locator(".ai-waveform").boundingBox();
  const lastBar = await page.locator(".ai-waveform i").last().boundingBox();
  expect(lastBar!.x + lastBar!.width).toBeLessThanOrEqual(waveform!.x + waveform!.width + 1);
  await page.locator(".ai-waveform").click({ position: { x: waveform!.width * .75, y: waveform!.height / 2 } });
  await expect.poll(() => page.locator(".ai-player audio").evaluate((node: HTMLAudioElement) => node.currentTime))
    .toBeCloseTo(3, 1);
  await page.locator(".ai-review").screenshot({ path: testInfo.outputPath("mobile.png") });
  const url = await page.locator(".ai-player audio").getAttribute("src");
  await page.getByRole("link", { name: "fretshift" }).click();
  await expect.poll(() => page.evaluate((source) =>
    (window as typeof window & { revokedAudioUrls: string[] }).revokedAudioUrls.includes(source), url)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("unconfirmed audio timing is not rhythm graded in Practice", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your songbook" })).toBeVisible();
  const id = await page.evaluate(async (encodedFile) => {
    const { analyzeAudioIntelligenceFile } = await import("/src/audio/intelligence/index.ts");
    const { createAudioReview, audioReviewToSong, gridAtBpm } = await import("/src/audio/intelligence/review.ts");
    const { useSongStore, flushPersistence } = await import("/src/store/songStore.ts");
    const bytes = Uint8Array.from(atob(encodedFile.bytes), (character) => character.charCodeAt(0));
    const file = new File([bytes], encodedFile.name);
    const result = await analyzeAudioIntelligenceFile(file);
    const review = createAudioReview(result, file.name, []);
    review.reviewed.beats = gridAtBpm(result.duration, 120, 0);
    review.reviewed.firstDownbeatIndex = 0;
    review.reviewed.segments.forEach((segment) => {
      if (!segment.label) segment.decision = "unknown";
    });
    review.reviewed.segments[0].label = "C";
    review.reviewed.segments[0].decision = "corrected";
    const song = audioReviewToSong("Needs timing review", result.chords.providerId, review);
    useSongStore.getState().add(song);
    await flushPersistence();
    return song.id;
  }, encoded[0]);
  await page.goto(`/practice/${id}`);
  await expect(page.getByRole("alert")).toContainText("Timing needs confirmation");
});
