import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
for (const theme of ["light", "dark"])
  test(`accessible practice screens in ${theme}`, async ({ page }) => {
    await page.goto("/settings");
    await page
      .getByRole("button", {
        name: theme === "light" ? "Light" : "Dark",
        exact: true,
      })
      .click();
    for (const route of [
      "/practice",
      "/practice/sample-1",
      "/tools",
      "/drills",
      "/progress",
      "/stage/sample-1",
    ]) {
      await page.goto(route);
      await expect(page.locator("h1")).toBeVisible();
      const scan = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        scan.violations
          .filter((v) => ["critical", "serious"].includes(v.impact ?? ""))
          .map((v) => ({
            id: v.id,
            nodes: v.nodes
              .slice(0, 4)
              .map((n) => ({ html: n.html, summary: n.failureSummary })),
          })),
        route,
      ).toEqual([]);
    }
  });
test("plays notation, highlights cells, saves session and leaves the song unchanged", async ({
  page,
}) => {
  await page.goto("/practice/sample-1");
  await expect(page.locator("h1")).toHaveText("Amazing Grace");
  const readSong = () =>
    page.evaluate(async () => {
      const path = "/src/persistence/dexie/index.ts";
      const { db } = await import(path);
      return db.songs.get("sample-1");
    });
  // Smart Strumming persists initial recommendations on opening this screen.
  await expect.poll(async () => (await readSong())?.strumming).toBeTruthy();
  const before = await readSong();
  await page.getByLabel("Auto-scroll", { exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Play / enable audio", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop & save session" }),
  ).toBeVisible();
  await expect(page.locator(".tab-cell.current").first()).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Stop & save session" }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = "/src/persistence/dexie/index.ts";
        const { db } = await import(path);
        return db.sessions.count();
      }),
    )
    .toBe(1);
  expect(await readSong()).toEqual(before);
  await page.goto("/progress");
  await expect(page.locator(".practice-log")).toContainText("Amazing Grace");
});
test("metronome toggles and denied microphone has a useful recovery message", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException("Test denial", "NotAllowedError");
        },
      },
    });
  });
  await page.goto("/tools");
  await page
    .getByRole("button", { name: "Enable microphone", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Microphone permission denied",
  );
  await page
    .getByRole("button", { name: "Tap to enable audio", exact: true })
    .click();
  await expect(page.locator(".metronome-ring")).toHaveClass(/running/);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".metronome-ring")).not.toHaveClass(/running/);
});
test("stage view responds to keyboard page turns", async ({ page }) => {
  await page.goto("/stage/sample-1");
  await expect(page.getByLabel("Song progress")).toHaveAttribute("value", "1");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("Song progress")).toHaveAttribute("value", "2");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByLabel("Song progress")).toHaveAttribute("value", "1");
});
test("actual time-stretch output preserves synthetic pitch", async ({
  page,
}) => {
  await page.goto("/tools");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/audio/timestretch/index.ts",
      pitchPath = "/src/audio/pitch/index.ts";
    const { stretchOffline } = await import(modulePath),
      { yin } = await import(pitchPath);
    const ctx = new OfflineAudioContext(1, 1, 44100),
      input = ctx.createBuffer(1, 44100 * 2, 44100);
    input.getChannelData(0).forEach((_: number, i: number, a: Float32Array) => {
      a[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / 44100);
    });
    const output = await stretchOffline(input, 0.75);
    const hz = yin(output.getChannelData(0).slice(22050, 22050 + 4096), 44100);
    return { duration: output.duration, cents: 1200 * Math.log2(hz / 220) };
  });
  expect(result.duration).toBeCloseTo(2 / 0.75, 2);
  expect(Math.abs(result.cents)).toBeLessThan(10);
});
