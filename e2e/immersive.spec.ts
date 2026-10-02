import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
type TestGuitar = {
  play: (midi: number, decay?: number) => void;
  stop: () => void;
  tracks: () => string[];
  disconnect: () => void;
};
declare global {
  interface Window {
    testGuitar: TestGuitar;
  }
}
async function guitar(page: Page) {
  await page.addInitScript(() => {
    let ctx: AudioContext, stream: MediaStream;
    let sources: OscillatorNode[] = [];
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          ctx = new AudioContext();
          await ctx.resume();
          const dest = ctx.createMediaStreamDestination();
          stream = dest.stream;
          window.testGuitar = {
            play(midi, decay = 0.3) {
              const t = ctx.currentTime;
              for (let h = 1; h <= 5; h++) {
                const osc = ctx.createOscillator(),
                  gain = ctx.createGain();
                osc.frequency.value = 440 * 2 ** ((midi - 69) / 12) * h;
                gain.gain.setValueAtTime(0, t);
                gain.gain.linearRampToValueAtTime(0.16 / (h * h), t + 0.003);
                gain.gain.exponentialRampToValueAtTime(0.0001, t + decay * 4);
                osc.connect(gain).connect(dest);
                osc.start();
                osc.stop(t + decay * 4);
                sources.push(osc);
              }
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
 * Ordinary songs stay behind the Immersive beta gate; only reviewed-audio songs
 * mount the live room. Give a fixture the minimal valid reviewed-audio
 * provenance so these legacy room tests exercise the route users can reach.
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
async function chart(page: Page) {
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
  await asReviewedAudio(page, "immersive-test", true);
  await page.goto("/immersive/immersive-test");
  await expect(
    page.getByRole("heading", { name: "Three clear notes", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".launch-splash")).toHaveCount(0);
}
async function connect(page: Page) {
  // Same device gate as e2e/audio-notes.spec.ts: headless Chromium on CI/Linux
  // hosts cannot start any AudioWorklet (even a trivial one), so controlled
  // capture is certified in WebKit and on real Chrome hardware.
  test.skip(
    test.info().project.name !== "webkit",
    "Controlled AudioWorklet capture is validated in WebKit; Chrome remains a separate device gate.",
  );
  await page
    .getByRole("button", { name: "Connect microphone", exact: true })
    .click();
  await expect(page.getByText("Microphone ready", { exact: true })).toBeVisible(
    { timeout: 12000 },
  );
}
test("learn through controlled microphone: wrong pitch, sustain, fresh attack, cleanup and persisted summary", async ({
  page,
}) => {
  await guitar(page);
  await chart(page);
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
test("ordinary songs stay behind the beta gate and never request the microphone", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { micRequests: number }).micRequests = 0;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          (window as unknown as { micRequests: number }).micRequests++;
          throw new Error("not expected");
        },
      },
    });
  });
  await page.goto("/immersive/sample-1");
  await expect(
    page.getByRole("heading", { name: /Coming soon/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect microphone" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { micRequests: number }).micRequests),
  ).toBe(0);
});
