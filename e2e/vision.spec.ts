import { expect, test } from "@playwright/test";

test("photo import explains configuration or transient processing", async ({
  page,
}) => {
  await page.goto("/import");
  await page.getByRole("button", { name: /Photos & scans/ }).click();
  const workspace = page.locator(".import-workspace");
  await expect(workspace).toContainText(
    /requires signing in under Account & sync|Smart photo & PDF import/,
  );
  await expect(workspace).toContainText(/sent temporarily to OCR/);
});
