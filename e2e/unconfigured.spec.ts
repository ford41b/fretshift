import { expect, test } from "@playwright/test";

test("cloud features stay explicit when the build is unconfigured", async ({
  page,
}) => {
  await page.goto("/settings");
  await expect(page.getByText("Sign in isn't configured")).toBeVisible();
  await page.goto("/import");
  await page.getByRole("button", { name: /Photos & scans/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Photo and visual PDF recognition requires signing in" }),
  ).toContainText("Local PDF text works without an account.");
});
