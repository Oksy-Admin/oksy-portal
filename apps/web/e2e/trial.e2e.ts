import { expect, test } from "@playwright/test";

// Rule trial and check sets (Stage 2e) on fake data. Nobody is logged in, so every server
// action (run trial, approve, pick, accept) is refused by the real code: nothing is written
// anywhere, same pattern as /dev/rules and /dev/dictionary.
test("rule trial, approve, pick and accept all refuse without a login", async ({ page }) => {
  await page.goto("/dev/trial");

  // Check sets: one pass, one fail with its changed field and open issue shown.
  const passRow = page.locator("tr", { hasText: "CL1001" });
  await expect(passRow).toContainText("Pass");
  const failRow = page.locator("tr", { hasText: "CL1002" });
  await expect(failRow).toContainText("Fail");
  await expect(failRow).toContainText("settled_amount");
  await expect(failRow).toContainText("R-A05");

  // Run trial: refused server-side (the add/edit tick check happens there, not client-side).
  await page.getByRole("button", { name: "Run trial" }).click();
  await expect(page.getByText(/Rule Library add\/edit tick/)).toBeVisible();

  // Accept new values on the failing claim: a reason is required, then refused server-side.
  await failRow.getByPlaceholder("Reason").fill("a new payment came in");
  await failRow.getByRole("button", { name: "Accept new values" }).click();
  await expect(page.getByText(/Only Owner or Admin can do this\./)).toBeVisible();

  // Pick a new claim: search is itself a gated server action, refused the same way.
  await page.getByPlaceholder("Search claim number").fill("CL");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText(/Only Owner or Admin can do this\./)).toBeVisible();

  await page.screenshot({ path: "test-results/trial-preview.png", fullPage: true });
});
