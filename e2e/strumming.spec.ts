import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const width of [390, 1280]) {
  test(`strumming editing, persistence and playback at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/song/sample-1");
    const studio = page.getByRole("region", {
      name: "Strumming pattern",
      exact: true,
    });
    await expect(
      studio.getByRole("heading", { name: "Strumming pattern", exact: true }),
    ).toBeVisible();
    await studio.getByRole("button", { name: /^Simple / }).click();
    await expect(
      studio
        .getByRole("group", { name: "Strumming rhythm grid" })
        .getByRole("button"),
    ).toHaveCount(3);
    await studio.getByRole("button", { name: /Beat 1:/, exact: false }).click();
    await studio
      .getByRole("combobox", { name: "Stroke", exact: true })
      .selectOption("rest");
    await expect(
      studio.getByRole("button", { name: "Beat 1: rest", exact: true }),
    ).toBeVisible();
    await studio.getByLabel("Variation name").fill("Quiet opening");
    await studio
      .getByRole("button", { name: "Save variation", exact: true })
      .click();
    await expect(
      studio.getByRole("heading", { name: "Quiet opening" }),
    ).toBeVisible();
    await expect(
      page.getByText("Saved on this device", { exact: true }).first(),
    ).toBeVisible();
    await page.reload();
    await expect(
      studio.getByRole("heading", { name: "Quiet opening" }),
    ).toBeVisible();
    await expect(
      studio.getByRole("button", { name: "Beat 1: rest", exact: true }),
    ).toBeVisible();
    await studio.locator("summary").click();
    await studio.getByLabel("Practice BPM (quarter note)").fill("85");
    await studio.getByLabel("Practice BPM (quarter note)").press("Tab");
    await expect(studio.getByText(/Song inputs changed/)).toBeVisible();
    await studio
      .getByRole("button", { name: "Regenerate alternatives" })
      .click();
    await expect(
      studio.getByRole("heading", { name: "Quiet opening" }),
    ).toBeVisible();
    await studio.locator("summary").click();
    await studio
      .getByRole("button", { name: "Play strumming", exact: true })
      .click();
    await expect(
      studio.getByRole("button", { name: "Pause strumming", exact: true }),
    ).toBeVisible();
    await expect.poll(() => studio.locator(".is-playing").count()).toBe(1);
    await studio
      .getByRole("button", { name: "Pause strumming", exact: true })
      .click();
    await expect(studio.locator(".is-playing")).toHaveCount(0);
    await studio
      .getByRole("button", { name: "Reset to recommendation" })
      .click();
    await expect(
      studio.getByRole("heading", { name: "Quiet opening" }),
    ).toHaveCount(0);
    await studio
      .getByRole("combobox", { name: "Saved variations", exact: true })
      .selectOption({ label: "Quiet opening · 3/4" });
    await expect(
      studio.getByRole("heading", { name: "Quiet opening" }),
    ).toBeVisible();
    const scan = await new AxeBuilder({ page })
      .include(".strumming-card")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await studio.screenshot({ path: `test-results/strumming-${width}.png` });
    await page.goto("/practice/sample-1");
    await expect(
      studio.getByRole("heading", { name: "Quiet opening" }),
    ).toBeVisible();
    await studio
      .getByRole("button", { name: "Play strumming", exact: true })
      .click();
    await expect(
      studio.getByRole("button", { name: "Pause strumming", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: /^Songbook/ })
      .first()
      .click();
    await expect(studio).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
test("compound meter, difficulty, single pass, and theme retain readable grids", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/settings");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.goto("/song/sample-1");
  const studio = page.getByRole("region", {
    name: "Strumming pattern",
    exact: true,
  });
  await studio.locator("summary").click();
  await studio
    .getByRole("combobox", { name: "Practice meter", exact: true })
    .selectOption("6/8");
  await studio
    .getByRole("combobox", { name: "Playing level", exact: true })
    .selectOption("advanced");
  await studio.getByLabel("Practice BPM (quarter note)").fill("120");
  await studio
    .getByLabel("I have confirmed the practice tempo and meter")
    .check();
  await studio.locator("summary").click();
  await expect(
    studio
      .getByRole("group", { name: "Strumming rhythm grid" })
      .getByRole("button"),
  ).toHaveCount(6);
  await studio.getByLabel("Loop", { exact: true }).uncheck();
  await studio.getByRole("button", { name: "Play strumming" }).click();
  await expect(
    studio.getByRole("button", { name: "Pause strumming" }),
  ).toBeVisible();
  await expect(
    studio.getByRole("button", { name: "Play strumming" }),
  ).toBeVisible({ timeout: 5000 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
  const scan = await new AxeBuilder({ page })
    .include(".strumming-card")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(scan.violations).toEqual([]);
  await studio.screenshot({ path: "test-results/strumming-dark-375.png" });
});

test("sixteenth-note controls fit an iPhone without shrinking touch targets", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/song/sample-4");
  const studio = page.getByRole("region", {
    name: "Strumming pattern",
    exact: true,
  });
  await studio.locator("summary").click();
  await studio
    .getByRole("combobox", { name: "Playing level", exact: true })
    .selectOption("advanced");
  await studio
    .getByRole("combobox", { name: "Style", exact: true })
    .selectOption("funk");
  await studio.locator("summary").click();
  const cells = studio
    .getByRole("group", { name: "Strumming rhythm grid" })
    .getByRole("button");
  await expect(cells).toHaveCount(16);
  const box = await cells.first().boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
  await cells.nth(15).click();
  await studio
    .getByRole("combobox", { name: "Stroke", exact: true })
    .selectOption("rest");
  await expect(cells.nth(15)).toHaveAttribute("aria-label", "Beat 4.75: rest");
  await studio.locator("summary").click();
  await studio
    .getByRole("combobox", { name: "Practice meter", exact: true })
    .selectOption("2/4");
  await expect(studio.getByText(/Song inputs changed/)).toBeVisible();
  await studio.getByRole("button", { name: "Reset to recommendation" }).click();
  await studio
    .getByRole("combobox", { name: "Stroke", exact: true })
    .selectOption("up");
  await expect(
    studio.getByRole("button", { name: /Beat 1: up/ }),
  ).toBeVisible();
});

test("content above the strumming card does not shift after scrolling to it", async ({
  page,
}) => {
  // WebKit has no CSS scroll anchoring, so any height change above the
  // viewport moves what the user is pointing at. Disable anchoring in every
  // engine so this guards the layout itself, not a browser compensation.
  await page.addInitScript(() =>
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "* { overflow-anchor: none !important; }";
      document.head.append(style);
    }),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/song/sample-1");
  const simple = page
    .getByRole("region", { name: "Strumming pattern", exact: true })
    .getByRole("button", { name: /^Simple / });
  await simple.waitFor();
  await expect(page.locator(".launch-splash")).toHaveCount(0, { timeout: 10000 });
  // Page-absolute position: scrolling must not change the layout above.
  const pageY = () => simple.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  const before = await pageY();
  await simple.scrollIntoViewIfNeeded();
  // Give IntersectionObserver-driven virtualization time to react.
  await page.waitForTimeout(1000);
  expect(Math.round(await pageY())).toBe(Math.round(before));
  await simple.click({ timeout: 5000 });
  await expect(simple).toHaveAttribute("aria-pressed", "true");
});
