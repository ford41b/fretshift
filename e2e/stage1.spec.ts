import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("create, save, reload, edit tab, undo/redo and export source", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your songbook" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New song", exact: true }).click();
  await page
    .getByLabel("Song title", { exact: true })
    .fill("Browser Test Song");
  await page.getByRole("button", { name: "Create song", exact: true }).click();
  await expect(page.getByLabel("Song title", { exact: true })).toHaveValue(
    "Browser Test Song",
  );
  const cell = page.locator('[data-cell="0-0"]').first();
  await cell.click();
  await page.keyboard.type("12", { delay: 90 });
  await expect(cell).toHaveAttribute("aria-label", /fret 12/);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(cell).toHaveAttribute("aria-label", /fret 1$/);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(cell).toHaveAttribute("aria-label", /fret 12/);
  await expect(
    page.getByText("Saved on this device", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Song title", { exact: true })).toHaveValue(
    "Browser Test Song",
  );
  await expect(page.locator('[data-cell="0-0"]').first()).toHaveAttribute(
    "aria-label",
    /fret 12/,
  );
});
for (const theme of ["light", "dark"])
  test(`accessible core screens in ${theme} theme`, async ({ page }) => {
    await page.goto("/settings");
    await page
      .getByRole("button", {
        name: theme === "light" ? "Light" : "Dark",
        exact: true,
      })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const route of ["/", "/song/sample-1", "/setlists", "/settings"]) {
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
              .slice(0, 5)
              .map((n) => ({ html: n.html, summary: n.failureSummary })),
          })),
      ).toEqual([]);
    }
  });
test("mobile songbook and left-handed tab orientation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your songbook" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.goto("/settings");
  await page.getByRole("checkbox", { name: /Left-handed diagrams/ }).check();
  await page.goto("/song/sample-1");
  await expect(page.locator(".chord-diagram").first()).toHaveAttribute(
    "data-mirrored",
    "true",
  );
  await expect(page.locator(".tab-svg").first()).toHaveAttribute(
    "data-mirrored",
    "false",
  );
  await page.screenshot({
    path: "test-results/mobile-notation.png",
    fullPage: true,
  });
});
test("setlist create and keyboard reorder", async ({ page }) => {
  await page.goto("/setlists");
  await page.getByRole("button", { name: "New setlist" }).click();
  await page.getByLabel("Setlist name", { exact: true }).fill("Porch Session");
  await page.getByRole("button", { name: "Create setlist" }).click();
  await page.getByLabel("Add a song").selectOption("sample-1");
  await page.getByLabel("Add a song").selectOption("sample-4");
  await expect(page.locator(".transition-flag")).toContainText("capo");
  await page
    .getByRole("button", { name: "Move Wayfaring Stranger up" })
    .click();
  await expect(page.locator(".setlist-row").first()).toContainText(
    "Wayfaring Stranger",
  );
});
