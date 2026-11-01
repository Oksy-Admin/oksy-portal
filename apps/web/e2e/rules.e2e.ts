import { expect, test } from "@playwright/test";

// Rule Library (Stage 2d) on fake data. Nobody is logged in, so every server action (save,
// test, upload, plain-words) is refused by the real code: nothing is written anywhere. The
// conflict check itself is pure client-side code (packages/rules/src/conflict.ts), so it
// still runs and can be checked without a login.
test("3-part form, save-time conflict, test-before-save gate, upload preview and plain-words all refuse without a login", async ({ page }) => {
  await page.goto("/dev/rules");

  // A REFERENCE rule (code-only) has no Edit button; hidden by default, same as before 2d.
  await page.getByLabel("Show reference items (code only)").check();
  const referenceRow = page.locator("tr", { hasText: "R-C01" });
  await expect(referenceRow).toContainText("Code only");
  await expect(referenceRow.getByRole("button", { name: "Edit" })).toHaveCount(0);

  // Open the Add Rule form.
  await page.getByRole("button", { name: "+ Add Rule" }).click();
  await page.getByLabel("Rule ID").fill("R-W09");
  await page.getByLabel("Title").fill("Stay under 10 days looks too short");

  // A condition on the same field (los_days) in the opposite direction of R-W01's
  // "GREATER_THAN 30" is a save-time conflict (stage-plan 2d's own example: two checks,
  // same scope, same field, opposite condition). Scoped selects, not getByLabel: a <select>'s
  // computed accessible name can fold in its own selected option text, which collides with
  // other labels on this form.
  const checkFieldset = page.getByRole("group", { name: /What to check/ });
  await checkFieldset.locator("select").nth(1).selectOption({ label: "Length of stay (days)" });
  await checkFieldset.locator("select").nth(2).selectOption("LESS_THAN");
  await checkFieldset.locator("select").nth(3).selectOption("VALUE");
  await checkFieldset.locator('input[placeholder="number or YYYY-MM-DD"]').fill("10");
  await expect(page.locator(".notice.warn", { hasText: "Conflict" })).toContainText("R-W01");

  // Test before save is gated: Save stays disabled until a test has run.
  const saveButton = page.getByRole("button", { name: "Save Rule" });
  await expect(saveButton).toBeDisabled();
  await page.getByRole("button", { name: "Run test" }).click();
  await expect(page.getByText(/Rule Library add\/edit tick/)).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();

  // Upload: CSV parsing and preview are pure client-side code, no login needed.
  await page.getByRole("button", { name: "Upload" }).click();
  const csv = [
    "rule_id,title,severity,action,hospital_filter,scheme_filter,insurer_filter,valid_from,valid_to,condition,issue_field,staff_message",
    "R-W10,Stay over 50 days,W,ASK_STAFF,,,,,,los_days GREATER_THAN 50,,Stay is {los_days} days.",
  ].join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "rules.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText("1 of 1 row(s) ready to save")).toBeVisible();
  await page.getByRole("button", { name: "Save 1 rule" }).click();
  await expect(page.getByText(/Rule Library add\/edit tick/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  // Plain-words box: refused the same way (it needs the same add/edit tick before it ever
  // reaches the AI call).
  await page.getByRole("button", { name: "+ Add Rule" }).click();
  await page.getByPlaceholder(/Plain words/).fill("Warn when the stay is over 45 days");
  await page.getByRole("button", { name: "Fill from words" }).click();
  await expect(page.getByText(/Rule Library add\/edit tick/)).toBeVisible();

  await page.screenshot({ path: "test-results/rules-preview.png", fullPage: true });
});
