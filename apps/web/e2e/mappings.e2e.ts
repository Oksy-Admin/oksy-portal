import { expect, test } from "@playwright/test";

// Column Mappings (Stage 1b-ii) on the pilot fixtures: HMS shown as a new hospital, its
// headers pre-filled from Badagara and Tree G. Nobody is logged in, so every save is refused
// by the real server actions: nothing is written anywhere.
test("suggestions, Confirm all with the list first, undo, and refusals without a login", async ({ page }) => {
  await page.goto("/dev/mappings");
  const hms = page.locator(".card", { hasText: "HMS (fixture, as new) (HOSPPVTP0003)" });
  await expect(hms.locator("h3")).toBeVisible();

  // Pre-filled from other hospitals of the same scheme.
  await expect(hms.getByText("Same as Badagara (fixture), Tree G (fixture): Bill Amount").first()).toBeVisible();

  // Confirm all: the list and the count come first; nothing is saved until "Confirm these".
  await hms.getByTestId("confirm-all").click();
  const list = hms.getByTestId("confirm-all-list");
  await expect(list.locator("li")).toHaveCount(30);
  await expect(list).toContainText("30 headers will be decided as other hospitals of scheme PRIVATE decided them");
  const started = Date.now();
  await list.getByTestId("confirm-all-go").click();
  await expect(page.getByRole("status")).toContainText("Only Owner or Admin can confirm headers in bulk.");
  console.log(`[timing] bulk confirm round trip ${Date.now() - started}ms`);

  // One header on its own: Ignore saves at once (refused here: no login).
  const row = hms.locator("tr", { hasText: "MAIL SUBJECT" });
  const t2 = Date.now();
  await row.locator("select").selectOption("IGNORE");
  await expect(page.getByRole("status")).toContainText("Only Owner, Admin or users with the Hospitals edit tick");
  console.log(`[timing] single decision round trip ${Date.now() - t2}ms`);

  // A bulk confirm can be undone as a group.
  const tree = page.locator(".card", { hasText: "Tree G (fixture) (HOSPPVTP0002)" });
  await expect(tree).toContainText("Bulk confirm of 3 headers");
  await tree.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("status")).toContainText("Only Owner or Admin can undo a bulk confirm.");
  await page.screenshot({ path: "test-results/mappings-preview.png", fullPage: true });
});
