import { expect, test } from "@playwright/test";

// Words & Names (Stage 2b) on fake data. Nobody is logged in, so every save is refused by the
// real server actions: nothing is written anywhere.
test("pre-filled cross-hospital suggestion, Confirm all, single decide and undo refusals without a login", async ({ page }) => {
  await page.goto("/dev/dictionary");

  // A new hospital's word, pre-filled from HMS (the Policy B + D pattern): one click away.
  const row = page.locator("tr", { hasText: "Paid" });
  await expect(row).toContainText("pre-filled from HMS (fixture)");

  // "Confirm all" for Badagara's status words is offered (at least the pre-filled one).
  const confirmAll = page.getByRole("button", { name: /Confirm all pre-filled status words for Badagara/ });
  await expect(confirmAll).toBeVisible();
  const started = Date.now();
  await confirmAll.click();
  await expect(page.locator(".notice.warn")).toContainText("Only Owner or Admin can confirm entries in bulk.");
  console.log(`[timing] bulk confirm round trip ${Date.now() - started}ms`);

  // A new word with no suggestion yet: Confirm / Reject are offered, refused without a login.
  const t2 = Date.now();
  await page.locator("tr", { hasText: "In Process" }).getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator(".notice.warn")).toContainText("Only Owner, Admin or users with the Hospitals edit tick");
  console.log(`[timing] single decision round trip ${Date.now() - t2}ms`);

  // Decided and rejected entries are hidden by default, shown with the checkbox.
  await expect(page.locator("tr", { hasText: "Test Co" })).toHaveCount(0);
  await page.getByLabel("Show decided").check();
  await expect(page.locator("tr", { hasText: "Test Co" })).toContainText("Rejected");

  // A bulk confirm can be undone as a group.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".notice.warn")).toContainText("Only Owner or Admin can undo a bulk confirm.");
  await page.screenshot({ path: "test-results/dictionary-preview.png", fullPage: true });
});
