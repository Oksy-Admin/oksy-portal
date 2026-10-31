import { expect, test } from "@playwright/test";

// Hospital list upload (Stage 1c): the rows and their problems are shown before anything is
// saved; a file with a problem cannot be saved. Invented hospitals and sheet IDs only. Nobody
// is logged in, so the save itself is refused by the real server action: nothing is written.
const HEAD = "Hospital ID,Hospital Name,Other Names,Status,Scheme,Google Sheet Link,Question Sheet Link";
const URL1 = "https://docs.google.com/spreadsheets/d/FAKEsheetUPLOAD000000000000001/edit";
const csv = (body: string) => ({ name: "hospitals.csv", mimeType: "text/csv", buffer: Buffer.from(`${HEAD}\n${body}\n`) });

test("upload: preview first; a file with problems cannot be saved", async ({ page }) => {
  await page.goto("/dev/hospitals");
  await page.getByRole("button", { name: "Upload Hospital List" }).click();

  await page.locator('input[name="csv_file"]').setInputFiles(csv(`HOSPTEST0002,Test Two,,Active,Private,${URL1},\nHOSPTEST0003,,,Paused,Private,not a link,`));
  await page.getByRole("button", { name: "Check file" }).click();
  const preview = page.getByTestId("upload-preview");
  await expect(preview).toContainText("2 rows read, 1 with problems.");
  await expect(preview.locator("tbody tr")).toHaveCount(2);
  await expect(preview).toContainText("Hospital Name is missing.");
  await expect(preview).toContainText('Status "Paused" is not Active or Stopped.');
  await expect(page.getByTestId("upload-save")).toBeDisabled();

  // A corrected file: Save is offered; without a login the server refuses it.
  await page.getByRole("button", { name: "Choose another file" }).click();
  await page.locator('input[name="csv_file"]').setInputFiles(csv(`HOSPTEST0002,Test Two,,Active,Private,${URL1},`));
  await page.getByRole("button", { name: "Check file" }).click();
  await expect(preview).toContainText("1 row read, 0 with problems.");
  await page.getByTestId("upload-save").click();
  await expect(page.getByText("Only Owner, Admin or users with the Hospitals edit tick can upload hospital lists.")).toBeVisible();
  await page.screenshot({ path: "test-results/hospital-upload-preview.png", fullPage: true });
});
