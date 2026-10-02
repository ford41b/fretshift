import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resumeChromiumWorklets } from "./support/worklets";
type TestGuitar = {
  play: (midi: number, decay?: number) => void;
  playAt: (midi: number, delay: number, decay?: number) => void;
  noiseAt: (delay: number) => void;
  stop: () => void;
  tracks: () => string[];
  disconnect: () => void;
};
declare global {
  interface Window {
    testGuitar: TestGuitar;
    /** Called for each sound the app schedules (calibration clicks), with its delay until estimated output. */
    onAppClick?: (outputDelay: number) => void;
    appClicks: number;
    micRequests: number;
  }
}
async function guitar(page: Page) {
  await resumeChromiumWorklets(page);
  await page.addInitScript(() => {
    let ctx: AudioContext, stream: MediaStream;
    let sources: AudioScheduledSourceNode[] = [];
    // Observe sounds the app schedules on its own context. Nothing the app
    // plays reaches this fake microphone unless a test routes it there.
    window.appClicks = 0;
    window.micRequests = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, ...rest: number[]) {
      if (this.context !== ctx) {
        window.appClicks++;
        const app = this.context as AudioContext;
        window.onAppClick?.(
          when - app.currentTime + (app.baseLatency || 0) + (app.outputLatency || 0),
        );
      }
      return start.call(this, when, ...rest);
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          window.micRequests++;
          ctx = new AudioContext();
          await ctx.resume();
          const dest = ctx.createMediaStreamDestination();
          stream = dest.stream;
          window.testGuitar = {
            play(midi, decay = 0.3) {
              window.testGuitar.playAt(midi, 0, decay);
            },
            playAt(midi, delay, decay = 0.3) {
              const t = ctx.currentTime + Math.max(0, delay);
              for (let h = 1; h <= 5; h++) {
                const osc = ctx.createOscillator(),
                  gain = ctx.createGain();
                osc.frequency.value = 440 * 2 ** ((midi - 69) / 12) * h;
                gain.gain.setValueAtTime(0, t);
                gain.gain.linearRampToValueAtTime(0.16 / (h * h), t + 0.003);
                gain.gain.exponentialRampToValueAtTime(0.0001, t + decay * 4);
                osc.connect(gain).connect(dest);
                osc.start(t);
                osc.stop(t + decay * 4);
                sources.push(osc);
              }
            },
            noiseAt(delay) {
              // A speaker click leaking into the microphone: unpitched and short.
              const buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.012), ctx.sampleRate);
              const data = buffer.getChannelData(0);
              for (let i = 0; i < data.length; i++)
                data[i] = (Math.random() * 2 - 1) * 0.3 * Math.exp(-i / (data.length / 4));
              const noise = ctx.createBufferSource();
              noise.buffer = buffer;
              noise.connect(dest);
              noise.start(ctx.currentTime + Math.max(0, delay));
              sources.push(noise);
            },
            stop() {
              for (const s of sources) {
                try {
                  s.stop();
                } catch {
                  /* already ended */
                }
              }
              sources = [];
            },
            tracks() {
              return stream.getTracks().map((t) => t.readyState);
            },
            disconnect() {
              stream
                .getTracks()
                .forEach((t) => t.dispatchEvent(new Event("ended")));
            },
          };
          return stream;
        },
      },
    });
  });
}
/**
 * Give a fixture the minimal valid reviewed-audio provenance, so a test can
 * exercise the audio-review route as well as the ordinary-song route.
 * `confirmTiming` marks every measure confirmed so tempo-grid tab targets keep
 * their original (ungated) timing behaviour.
 */
async function asReviewedAudio(page: Page, id: string, confirmTiming: boolean) {
  await page.evaluate(
    async ({ id, confirmTiming }) => {
      const storePath = "/src/store/songStore.ts",
        dbPath = "/src/persistence/dexie/index.ts";
      const { useSongStore } = await import(storePath),
        { db } = await import(dbPath);
      type Row = { id: string; provenance?: object; measures: { timingConfirmed?: boolean }[] };
      const songs = useSongStore.getState().songs as Row[];
      const s = structuredClone(songs.find((x) => x.id === id)!);
      s.provenance = {
        ...(s.provenance ?? {}),
        source: "audio",
        audioReview: {
          fileName: "fixture.wav",
          duration: 60,
          waveform: [],
          detected: { tempoBpm: null, beats: [], downbeats: [], meter: null, segments: [] },
          reviewed: {
            tempoBpm: 60,
            beats: [0, 1, 2, 3, 4, 5, 6, 7],
            meter: 4,
            firstDownbeatIndex: 0,
            timingConfirmed: false,
            segments: [],
          },
        },
      };
      if (confirmTiming) s.measures.forEach((m) => (m.timingConfirmed = true));
      await db.songs.put(s);
      useSongStore.setState({ songs: [...songs.filter((x) => x.id !== id), s] });
    },
    { id, confirmTiming },
  );
}
async function chart(page: Page, source: "ordinary" | "audio-review" = "ordinary") {
  await page.goto("/immersive");
  await expect(
    page.getByRole("heading", { name: /Immersive practice/ }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const schemaPath = "/src/schema/song.v1.ts",
      storePath = "/src/store/songStore.ts",
      dbPath = "/src/persistence/dexie/index.ts";
    const { newSong } = await import(schemaPath),
      { useSongStore } = await import(storePath),
      { db } = await import(dbPath);
    const s = newSong("Three clear notes");
    s.id = "immersive-test";
    s.tempo = 60;
    s.measures[0].tab.slots[0][0] = 0;
    s.measures[0].tab.slots[2][0] = 0;
    s.measures[0].tab.slots[4][0] = 3;
    await db.songs.put(s);
    useSongStore.setState({
      songs: [
        ...useSongStore
          .getState()
          .songs.filter((x: { id: string }) => x.id !== s.id),
        s,
      ],
    });
  });
  if (source === "audio-review") await asReviewedAudio(page, "immersive-test", true);
  await page.goto("/immersive/immersive-test");
  await expect(
    page.getByRole("heading", { name: "Three clear notes", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".launch-splash")).toHaveCount(0);
}
async function connect(page: Page) {
  // Chromium runs these too: `guitar()` installs the Playwright worklet
  // resume shim (e2e/support/worklets.ts). This is emulated input in headless
  // browsers, not real Chrome or Safari hardware.
  await page
    .getByRole("button", { name: "Connect microphone", exact: true })
    .click();
  await expect(page.getByText("Microphone ready", { exact: true })).toBeVisible(
    { timeout: 12000 },
  );
}
for (const source of ["ordinary", "audio-review"] as const)
test(`learn through controlled microphone (${source} song): wrong pitch, sustain, fresh attack, cleanup and persisted summary`, async ({
  page,
}) => {
  await guitar(page);
  await chart(page, source);
  await connect(page);
  await page
    .getByRole("button", { name: "Start learning", exact: true })
    .click();
  await page.waitForTimeout(250);
  await page.evaluate(() => window.testGuitar.play(65));
  await expect(page.locator(".imm-feedback")).toContainText("Wrong pitch");
  await expect(page.locator(".imm-lane-bottom")).toContainText("1 / 3");
  await page.waitForTimeout(400);
  await page.evaluate(() => window.testGuitar.play(64, 2));
  await expect(page.locator(".imm-lane-bottom")).toContainText("2 / 3");
  await page.waitForTimeout(650);
  await expect(page.locator(".imm-lane-bottom")).toContainText("2 / 3");
  await page.evaluate(() => window.testGuitar.stop());
  await page.waitForTimeout(250);
  await page.evaluate(() => window.testGuitar.play(64));
  await expect(page.locator(".imm-lane-bottom")).toContainText("3 / 3");
  await page.waitForTimeout(450);
  await page.evaluate(() => window.testGuitar.play(67));
  await expect(
    page.getByRole("heading", { name: "Your practice, honestly." }),
  ).toBeVisible();
  await expect(
    page.getByText("Saved on this device", { exact: false }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.testGuitar.tracks())).toEqual([
    "ended",
  ]);
  const result = await page.evaluate(async () => {
    const p = "/src/persistence/dexie/index.ts";
    const { db } = await import(p);
    return (await db.sessions.toArray())[0].immersive;
  });
  expect(result).toMatchObject({ matched: 3, assessed: 3, total: 3, timed: 0 });
  await page.reload();
  await page.goto("/progress");
  await expect(page.locator(".practice-log")).toContainText(
    "Three clear notes",
  );
});
test("healthy silence in Rhythm yields missed notes, not uncertain successes", async ({
  page,
}) => {
  await guitar(page);
  await chart(page);
  await page.getByRole("button", { name: /^Rhythm\b/ }).click();
  await page
    .getByRole("group", { name: "Playback speed" })
    .getByRole("button", { name: "100%", exact: true })
    .click();
  await connect(page);
  await page.getByRole("button", { name: "Start rhythm practice" }).click();
  await expect(
    page.getByRole("heading", { name: "Your practice, honestly." }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByText(/0 wrong · 3 missed · 0 uncertain/),
  ).toBeVisible();
  await expect(page.locator(".imm-stats")).toContainText("0%");
});
test("permission denial recovers into unscored visual mode; no capture or guide leakage credit", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException("denied", "NotAllowedError");
        },
      },
    }),
  );
  await chart(page);
  await page.getByRole("button", { name: "Connect microphone" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Microphone permission denied",
  );
  await page.getByRole("button", { name: /^Quiet visual\b/ }).click();
  await page.getByRole("button", { name: "Start visual practice" }).click();
  await page.getByRole("button", { name: "Finish visual practice" }).click();
  const summary = page.getByLabel("Quiet visual practice summary");
  await expect(summary).toContainText("Time practiced · unscored");
  await expect(summary).toContainText("0/1 measures passed");
});
test("pause and disconnect stop input, resume rearms without stale credit", async ({
  page,
}) => {
  await guitar(page);
  await chart(page);
  await connect(page);
  await page.getByRole("button", { name: "Start learning" }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  expect(await page.evaluate(() => window.testGuitar.tracks())).toEqual([
    "ended",
  ]);
  await page.getByRole("button", { name: "Reconnect microphone" }).click();
  await expect(
    page.getByText("Microphone ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.evaluate(() => window.testGuitar.disconnect());
  await expect(page.getByRole("alert")).toContainText("disconnected");
  await page.getByRole("button", { name: "Finish & see results" }).click();
  await expect(page.getByText(/3 unassessed/)).toBeVisible();
});
test("backgrounding and exit release tracks", async ({ page }) => {
  await guitar(page);
  await chart(page);
  await connect(page);
  await page.getByRole("button", { name: "Start learning" }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText(/Paused while FretShift/)).toBeVisible();
  expect(await page.evaluate(() => window.testGuitar.tracks())).toEqual([
    "ended",
  ]);
  await page.evaluate(() =>
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    }),
  );
  await page.getByRole("button", { name: "Reconnect microphone" }).click();
  await expect(
    page.getByText("Microphone ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Exit", exact: true }).click();
  expect(await page.evaluate(() => window.testGuitar.tracks())).toEqual([
    "ended",
  ]);
});
for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  test(`portrait/landscape ${viewport.width}: lane, controls, keyboard and accessibility`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await chart(page);
    await page
      .getByRole("button", { name: /^Quiet visual\b/ })
      .click();
    await page.getByRole("button", { name: "Start visual practice" }).click();
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeInViewport();
    const pauseBounds = await page
      .getByRole("button", { name: "Pause", exact: true })
      .boundingBox();
    expect(pauseBounds!.y + pauseBounds!.height).toBeLessThanOrEqual(
      viewport.height,
    );
    expect(
      await page.evaluate(
        () => document.querySelector(".immersive")!.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const scan = await new AxeBuilder({ page })
      .include(".immersive")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      scan.violations
        .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
        .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.html) })),
    ).toEqual([]);
    await page.screenshot({
      path: `test-results/immersive-${viewport.width}.png`,
    });
  });
test("chord-only audio songs stay visual: scored modes cannot grade guided chords", async ({
  page,
}) => {
  // Current design (REVIEW_FIXES.md, IMMERSIVE_BETA_GATE.md): passages with
  // guided chord targets default to Quiet visual and never award chord credit.
  await page.goto("/immersive");
  await expect(
    page.getByRole("heading", { name: /Immersive practice/ }),
  ).toBeVisible();
  await asReviewedAudio(page, "sample-1", false);
  await page.goto("/immersive/sample-1");
  await expect(page.locator(".launch-splash")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Rhythm\b/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Learn\b/ })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /^Quiet visual\b/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Connect microphone" }),
  ).toHaveCount(0);
});
test("loop restart counts a fresh passage without credit from the previous pass", async ({
  page,
}) => {
  await guitar(page);
  await chart(page);
  await page.getByRole("button", { name: /^Rhythm\b/ }).click();
  await page
    .getByRole("group", { name: "Playback speed" })
    .getByRole("button", { name: "100%", exact: true })
    .click();
  await page.getByLabel("Loop passage").check();
  await connect(page);
  await page.getByRole("button", { name: "Start rhythm practice" }).click();
  await expect(page.getByText("Pass 2", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole("button", { name: "Finish & see results" }).click();
  await expect(page.getByText(/3 missed/)).toBeVisible();
  await expect(page.getByText(/3 unassessed/)).toBeVisible();
  await expect(page.locator(".imm-stats")).toContainText("50%");
});
test("a stalled processor offers recovery and stops tracks instead of hanging", async ({
  page,
}) => {
  await guitar(page);
  await page.addInitScript(() => {
    Worklet.prototype.addModule = () => new Promise(() => {});
  });
  await chart(page);
  await page
    .getByRole("button", { name: "Connect microphone", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "processor did not start",
    { timeout: 12000 },
  );
  expect(await page.evaluate(() => window.testGuitar.tracks())).toEqual([
    "ended",
  ]);
  await expect(
    page.getByRole("button", { name: "Connect microphone", exact: true }),
  ).toBeEnabled();
});
test("ordinary song with chords: chord passages stay visual without the microphone; a single-note passage is scored", async ({
  page,
}) => {
  await guitar(page);
  await page.goto("/immersive");
  await expect(page.locator(".launch-splash")).toHaveCount(0);
  await page.evaluate(async () => {
    const { newSong, newMeasure } = await import("/src/schema/song.v1.ts");
    const { useSongStore } = await import("/src/store/songStore.ts");
    const { db } = await import("/src/persistence/dexie/index.ts");
    const s = newSong("Chords then melody");
    s.id = "mixed-test";
    s.tempo = 60;
    s.measures = [newMeasure(0), newMeasure(1)];
    s.measures[0].tab!.slots[0][1] = 1; // C shape fragment: two strings → chord target
    s.measures[0].tab!.slots[0][2] = 2;
    s.measures[1].tab!.slots[0][0] = 0; // E4
    s.measures[1].tab!.slots[2][0] = 0; // E4 again (fresh attack)
    s.measures[1].tab!.slots[4][0] = 3; // G4
    await db.songs.put(s);
    useSongStore.setState({
      songs: [...useSongStore.getState().songs.filter((x: { id: string }) => x.id !== s.id), s],
    });
  });
  await page.goto("/immersive/mixed-test");
  await expect(page.getByRole("heading", { name: "Chords then melody", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Coming soon/ })).toHaveCount(0);
  // Whole song includes a chord: scored modes are unavailable, visual is the default.
  await expect(page.getByRole("button", { name: /^Learn\b/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Rhythm\b/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Quiet visual\b/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Connect microphone" })).toHaveCount(0);
  await page.getByRole("button", { name: "Start visual practice" }).click();
  await page.getByRole("button", { name: "Finish visual practice" }).click();
  await expect(page.getByLabel("Quiet visual practice summary")).toContainText("unscored");
  expect(await page.evaluate(() => window.micRequests)).toBe(0);
  await page.getByRole("button", { name: "Practice this passage again" }).click();
  // The single-note measure is offered and uses the same scored Learn path.
  await page
    .getByRole("group", { name: "Scored single-note passages" })
    .getByRole("button", { name: "Measure 2 · 3 notes" })
    .click();
  await expect(page.getByRole("button", { name: /^Learn\b/ })).toHaveAttribute("aria-pressed", "true");
  await connect(page);
  await page.getByRole("button", { name: "Start learning", exact: true }).click();
  await page.waitForTimeout(250);
  for (const [midi, progress] of [[64, "2 / 3"], [64, "3 / 3"]] as const) {
    await page.evaluate((m) => window.testGuitar.play(m, 0.2), midi);
    await expect(page.locator(".imm-lane-bottom")).toContainText(progress);
    await page.waitForTimeout(450);
  }
  await page.evaluate(() => window.testGuitar.play(67, 0.2));
  await expect(page.getByRole("heading", { name: "Your practice, honestly." })).toBeVisible();
  const saved = await page.evaluate(async () => {
    const { db } = await import("/src/persistence/dexie/index.ts");
    return (await db.sessions.toArray()).find((x) => x.immersive?.mode === "learn")?.immersive;
  });
  expect(saved).toMatchObject({ firstMeasure: 1, lastMeasure: 1, matched: 3, assessed: 3, unsupported: 0 });
});
test("library and navigation show the beta badge and which features are on", async ({ page }) => {
  await page.goto("/immersive");
  await expect(page.locator(".launch-splash")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Immersive practice/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Coming soon/ })).toHaveCount(0);
  await expect(page.locator(".imm-library .imm-beta-chip")).toHaveText("BETA");
  await page.getByText("What’s on in this beta").click();
  const notes = page.locator(".imm-release");
  await expect(notes).toContainText("Scored single notes on ordinary songs: on");
  await expect(notes).toContainText("Guided timing calibration: on");
  await expect(notes).toContainText("Chord scoring (required-tone coverage): off");
  await page.getByRole("link", { name: /House of the Rising Sun/ }).click();
  await expect(page.getByRole("heading", { name: "House of the Rising Sun", exact: true })).toBeVisible();
});
test("timing calibration: median of taps, outliers rejected, stored per device and used as the default", async ({
  page,
}) => {
  test.setTimeout(60000);
  await guitar(page);
  await chart(page);
  await connect(page);
  await expect(page.getByLabel("Timing calibration")).toContainText(
    "Not calibrated on this device",
  );
  // A steady player: pluck at each cue's output time. Cues 3 and 8 are 200 ms late.
  await page.evaluate(() => {
    let n = 0;
    window.onAppClick = (delay) => {
      const i = n++ - 7; // 3 still clicks + 4 count-in: no playing
      if (i < 0) return;
      window.testGuitar.playAt(i % 2 ? 45 : 50, delay + (i === 3 || i === 8 ? 0.2 : 0), 0.2);
    };
  });
  await page.getByRole("button", { name: "Calibrate timing" }).click();
  await expect(page.locator(".imm-calibration-step")).toContainText(
    "Keep the strings still",
  );
  await expect(
    page.getByRole("button", { name: "Start learning", exact: true }),
  ).toBeDisabled();
  const result = page.locator(".imm-calibration-result");
  await expect(result).toContainText("Measured", { timeout: 30000 });
  // Both 200 ms-late taps are rejected; emulated jitter may reject one more.
  await expect(result).toContainText(/from (9|10) of 12 taps \((2|3) outliers rejected\)/);
  await expect(result).toContainText("Saved for this microphone on this device");
  expect(await page.evaluate(() => window.appClicks)).toBe(19);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fretshift:immersive-calibration:v1")!),
  );
  const record = Object.values(stored)[0] as { offsetMs: number; used: number; cue: string };
  expect(record.cue).toBe("click");
  expect(record.used).toBeGreaterThanOrEqual(9);
  console.log(`[emulated ${test.info().project.name}] calibration ${JSON.stringify(record)}`);
  // Emulated pipeline delay only; plausibility bounds are enforced by the app.
  expect(record.offsetMs).toBeGreaterThanOrEqual(-100);
  expect(record.offsetMs).toBeLessThanOrEqual(250);
  await page.getByText("Advanced · timing and technical details").click();
  await expect(page.getByText(`${record.offsetMs > 0 ? "+" : ""}${record.offsetMs} ms · calibrated`)).toBeVisible();
  // Manual override stays available and can be reverted.
  await page.getByLabel("Timing adjustment").fill("120");
  await expect(page.getByText("120 ms · manual override")).toBeVisible();
  await page.getByRole("button", { name: /Use calibrated value/ }).click();
  await expect(page.getByText(/ms · calibrated/)).toBeVisible();
  // Scored practice after calibration plays no clicks and records the offset source.
  const clicks = await page.evaluate(() => window.appClicks);
  await page.getByRole("button", { name: "Start learning", exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Finish & see results" }).click();
  expect(await page.evaluate(() => window.appClicks)).toBe(clicks);
  const session = await page.evaluate(async () => {
    const { db } = await import("/src/persistence/dexie/index.ts");
    return (await db.sessions.toArray())[0].immersive;
  });
  expect(session).toMatchObject({ timingOffsetMs: record.offsetMs, timingOffsetSource: "calibrated" });
  // Per device: a fresh page load reconnects to the stored value.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Three clear notes", exact: true })).toBeVisible();
  await connect(page);
  await expect(page.getByLabel("Timing calibration")).toContainText(
    `${record.offsetMs > 0 ? "+" : ""}${record.offsetMs} ms · ${record.used} taps`,
  );
});
test("timing calibration refuses a microphone that hears the click and saves nothing", async ({
  page,
}) => {
  test.setTimeout(60000);
  await guitar(page);
  await chart(page);
  await connect(page);
  await page.evaluate(() => {
    let n = 0;
    window.onAppClick = (delay) => {
      const i = n++;
      // Every click leaks into the microphone (speaker playback); the player plays too.
      window.testGuitar.noiseAt(delay);
      if (i >= 7) window.testGuitar.playAt(i % 2 ? 45 : 50, delay + 0.03, 0.2);
    };
  });
  await page.getByRole("button", { name: "Calibrate timing" }).click();
  await expect(page.locator(".imm-calibration-result")).toContainText(
    "picked up the click itself",
    { timeout: 30000 },
  );
  expect(
    await page.evaluate(() => localStorage.getItem("fretshift:immersive-calibration:v1")),
  ).toBeNull();
  await expect(page.getByLabel("Timing calibration")).toContainText(
    "Not calibrated on this device",
  );
});
