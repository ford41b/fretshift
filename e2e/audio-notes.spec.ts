import { mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function upload(page: Page) {
  await page.goto("/import");
  await page.getByRole("button", { name: /Audio recording/ }).click();
  await page.getByLabel(/Also transcribe a single-note/).check();
  await page
    .getByLabel("Choose audio for Audio Intelligence")
    .setInputFiles("test-fixtures/audio-notes/single-note-melody.wav");
  await expect(
    page.getByRole("region", { name: "Guitar note editor" }),
  ).toBeVisible();
  await expect(page.locator(".ai-tab-note")).toHaveCount(5);
}
async function timing(page: Page) {
  if (
    await page
      .getByRole("button", { name: "Mark all uncertain regions Unknown" })
      .count()
  )
    await page
      .getByRole("button", { name: "Mark all uncertain regions Unknown" })
      .click();
  await page.getByLabel("BPM", { exact: true }).fill("120");
  await page.getByLabel("First beat (s)").fill("0");
  await page
    .getByRole("button", { name: "Apply BPM and rebuild beats" })
    .click();
  await page.getByLabel(/I checked the beat grid/).check();
}
async function confirmAll(page: Page) {
  const values = await page
    .getByLabel("Selected note")
    .locator("option")
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLOptionElement).value));
  for (const value of values) {
    await page.getByLabel("Selected note").selectOption(value);
    const confirm = page.getByRole("button", {
      name: "Confirm note",
      exact: true,
    });
    if (await confirm.isEnabled()) await confirm.click();
  }
}
test("note import, fingering/timing edits, playback, persistence and scored target bridge", async ({
  page,
}, info) => {
  await upload(page);
  await page.getByLabel("Note pitch", {exact:true}).selectOption("53");
  await expect(page.locator(".ai-note-identity strong")).toHaveText("F3");
  await page.getByLabel("Note pitch", {exact:true}).selectOption("52");
  await page.getByLabel("Playback speed", { exact: true }).selectOption(".5");
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.playbackRate),
    )
    .toBe(0.5);
  await page.getByRole("button", { name: "Loop selected note" }).click();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.paused),
    )
    .toBe(false);
  await page.locator("audio").evaluate((a: HTMLAudioElement) => a.pause());
  await page.locator(".ai-fingerings button").last().click();
  await page.getByLabel("Onset seconds").fill("0.22");
  await page.getByLabel("Onset seconds").blur();
  await page.getByLabel("Duration seconds").fill("0.3");
  await page.getByLabel("Duration seconds").blur();
  await page.getByRole("button", { name: "Confirm note", exact: true }).click();
  await expect(
    page.getByText("Confirmed by you", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Mark uncertain", { exact: true }).check();
  await expect(
    page.getByText("Uncertain · listen and review", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add note at playhead" }).click();
  await expect(page.locator(".ai-tab-note")).toHaveCount(6);
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await expect(page.locator(".ai-tab-note")).toHaveCount(5);
  await timing(page);
  await confirmAll(page);
  mkdirSync("docs/post-phase-3-validation/browser", { recursive: true });
  await page
    .locator(".ai-note-editor")
    .screenshot({ path: `docs/post-phase-3-validation/browser/${info.project.name}-editor.png` });
  await page
    .locator(".ai-track")
    .screenshot({ path: `docs/post-phase-3-validation/browser/${info.project.name}-tab.png` });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page
    .locator(".ai-note-editor")
    .screenshot({ path: `docs/post-phase-3-validation/browser/${info.project.name}-dark.png` });
  const darkAudit = await new AxeBuilder({ page })
    .include(".ai-note-editor")
    .analyze();
  expect(
    darkAudit.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
  await page.getByRole("button", { name: "Save as FretShift song" }).click();
  await expect(
    page.getByRole("link", { name: "Reopen transcription" }),
  ).toBeVisible();
  const state = await page.evaluate(async () => {
    const { useSongStore } = await import("/src/store/songStore.ts");
    const { compileTargets } = await import("/src/audio/immersive/score.ts");
    const song = useSongStore
      .getState()
      .songs.find((s) => s.provenance?.audioReview?.noteTranscription)!;
    return {
      raw: song.provenance!.audioReview!.noteTranscription!.detected.notes[0],
      edited: song.provenance!.audioReview!.noteTranscription!.notes[0],
      plan: compileTargets(song),
    };
  });
  expect(state.raw.start).not.toBe(0.22);
  expect(state.edited.start).toBe(0.22);
  expect(state.edited.fingering?.source).toBe("user");
  expect(state.plan.targets).toHaveLength(5);
  expect(state.plan.targets.every((t) => t.supported)).toBe(true);
  await page.getByRole("link", { name: "Reopen transcription" }).click();
  await page.reload();
  await expect(page.locator(".ai-tab-note.confirmed")).toHaveCount(5);
  await page
    .getByLabel("Reattach original audio")
    .setInputFiles("test-fixtures/audio-notes/single-note-melody.wav");
  await expect(
    page.getByText("Original audio verified and attached for this session."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Loop selected note" }).click();
  await page.evaluate(() => {
    (window as typeof window & { oldAudio: HTMLAudioElement }).oldAudio =
      document.querySelector("audio")!;
  });
  await page
    .getByRole("link", { name: "Immersive Practice", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Immersive practice" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { oldAudio: HTMLAudioElement }).oldAudio
          .paused,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Connect microphone", exact: true }),
  ).toBeVisible();
});

test("narrow tab layout, keyboard selection, setup constraints and accessibility", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await upload(page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.locator(".ai-tab-note").nth(2).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".ai-tab-note").nth(2)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page
    .getByText("Guitar setup & playing position", { exact: true })
    .click();
  await page.getByLabel("Tuning", { exact: true }).selectOption("drop-d");
  await page.getByLabel("Capo", { exact: true }).fill("2");
  await expect(page.getByText(/Frets are relative to the capo/)).toBeVisible();
  await page.getByLabel("Highest fret").fill("1");
  await expect(
    page.getByText("No playable position in this setup.", { exact: false }),
  ).toBeVisible();
  const audit = await new AxeBuilder({ page })
    .include(".ai-note-editor")
    .analyze();
  expect(
    audit.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
  mkdirSync("docs/post-phase-3-validation/browser", { recursive: true });
  await page
    .locator(".ai-review")
    .screenshot({ path: `docs/post-phase-3-validation/browser/${info.project.name}-mobile.png` });
});

test("note Worker cancellation terminates an in-flight pass and permits retry", async ({
  page,
}) => {
  await page.goto("/");
  const bytes = readFileSync(
    "test-fixtures/audio-notes/single-note-melody.wav",
  ).toString("base64");
  const result = await page.evaluate(async (encoded) => {
    const { analyzeAudioIntelligenceFile } = await import(
      "/src/audio/intelligence/index.ts"
    );
    const file = new File(
      [Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))],
      "notes.wav",
    );
    const controller = new AbortController();
    let cancelled = false;
    try {
      await analyzeAudioIntelligenceFile(file, controller.signal, {
        transcribeNotes: true,
        onStage: (stage) => {
          if (stage === "Detecting single notes") controller.abort();
        },
      });
    } catch (e) {
      cancelled = e instanceof DOMException && e.name === "AbortError";
    }
    const retry = await analyzeAudioIntelligenceFile(file, undefined, {
      transcribeNotes: true,
    });
    return { cancelled, notes: retry.notes?.notes.length };
  }, bytes);
  expect(result).toEqual({ cancelled: true, notes: 5 });
});

test("confirmed audio notes use controlled microphone pitch, pause cleanup and no guide audio", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "webkit",
    "Controlled AudioWorklet capture is validated in WebKit; Chrome remains a separate device gate.",
  );
  await page.addInitScript(() => {
    let context: AudioContext, stream: MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          context = new AudioContext();
          await context.resume();
          const destination = context.createMediaStreamDestination();
          stream = destination.stream;
          (
            window as unknown as {
              guitar: { play: (midi: number) => void; tracks: () => string[] };
            }
          ).guitar = {
            play(midi) {
              const at = context.currentTime;
              for (let h = 1; h <= 5; h++) {
                const oscillator = context.createOscillator(),
                  gain = context.createGain();
                oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12) * h;
                gain.gain.setValueAtTime(0, at);
                gain.gain.linearRampToValueAtTime(0.16 / (h * h), at + 0.003);
                gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.2);
                oscillator.connect(gain).connect(destination);
                oscillator.start(at);
                oscillator.stop(at + 1.2);
              }
            },
            tracks: () => stream.getTracks().map((t) => t.readyState),
          };
          return stream;
        },
      },
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your songbook" }),
  ).toBeVisible();
  const id = await page.evaluate(async () => {
    const { createAudioReview, audioReviewToSong } = await import(
      "/src/audio/intelligence/review.ts"
    );
    const { useSongStore, flushPersistence } = await import(
      "/src/store/songStore.ts"
    );
    const review = createAudioReview(
      {
        version: 1,
        duration: 4,
        stemProviderId: null,
        warnings: [],
        measures: [],
        chords: {
          providerId: "fixture",
          segments: [],
          vocabulary: [],
          warnings: [],
        },
        beats: {
          providerId: "fixture",
          tempoBpm: 120,
          beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
          downbeats: [0, 2],
          meter: 4,
          status: "estimated",
          evidence: 1,
          warnings: [],
        },
        notes: {
          providerId: "controlled-fixture",
          frames: [],
          hopSeconds: 0.01,
          windowSeconds: 0.1,
          warnings: [],
          notes: [64, 67].map((midi, i) => ({
            id: String(i),
            start: 0.2 + i,
            end: 0.6 + i,
            midi,
            confidence: 0.95,
            inferredArticulation: "unknown",
          })),
        },
      },
      "controlled.wav",
      [],
    );
    review.reviewed.timingConfirmed = true;
    review.noteTranscription!.notes.forEach((n) => {
      n.confirmed = true;
      n.uncertain = false;
    });
    const song = audioReviewToSong("Confirmed audio notes", "fixture", review);
    useSongStore.getState().add(song);
    await flushPersistence();
    return song.id;
  });
  await page.goto(`/immersive/${id}`);
  await expect(
    page.getByRole("region", { name: "Immersive practice" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Connect microphone", exact: true })
    .click();
  await expect(page.getByText("Microphone ready", { exact: true })).toBeVisible(
    { timeout: 15000 },
  );
  await page
    .getByRole("button", { name: "Start learning", exact: true })
    .click();
  await expect(page.locator("audio")).toHaveCount(0);
  await page.waitForTimeout(300);
  await page.evaluate(() =>
    (
      window as unknown as { guitar: { play: (m: number) => void } }
    ).guitar.play(65),
  );
  await expect(page.locator(".imm-feedback")).toContainText("Wrong pitch");
  await page.waitForTimeout(1400);
  await page.evaluate(() =>
    (
      window as unknown as { guitar: { play: (m: number) => void } }
    ).guitar.play(64),
  );
  await expect(page.locator(".imm-lane-bottom")).toContainText("2 / 2");
  // Synthetic page visibility event: lifecycle check, not a physical screen lock.
  await page.evaluate(() => {
    Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText(/Paused while FretShift/)).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { guitar: { tracks: () => string[] } }
      ).guitar.tracks(),
    ),
  ).toEqual(["ended"]);
  await page
    .getByRole("button", { name: "Reconnect microphone", exact: true })
    .click();
  await expect(page.getByText("Microphone ready", { exact: true })).toBeVisible(
    { timeout: 15000 },
  );
  await page.getByRole("button", { name: /Resume/ }).click();
  await page.waitForTimeout(250);
  await page.evaluate(() =>
    (
      window as unknown as { guitar: { play: (m: number) => void } }
    ).guitar.play(67),
  );
  await expect(
    page.getByRole("heading", { name: "Your practice, honestly." }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { guitar: { tracks: () => string[] } }
      ).guitar.tracks(),
    ),
  ).toEqual(["ended"]);
});
