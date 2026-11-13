import { expect, test } from "@playwright/test";

/**
 * Dispatch flow on a phone: create a shipment and move it along.
 * Uses an existing account (E2E_EMAIL / E2E_PASSWORD) whose role can manage shipments.
 */
test.skip(
  !process.env.E2E_BASE_URL || !process.env.E2E_EMAIL || !process.env.E2E_PASSWORD,
  "Set E2E_BASE_URL, E2E_EMAIL and E2E_PASSWORD to run",
);

test("log a shipment with a photo and update its status", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app\//);

  const awb = `E2E${Date.now()}`;
  await page.goto("/app/shipments/new");
  await page.getByLabel(/Recipient name|Name/).first().fill("E2E Recipient");
  await page.getByLabel(/Tracking number/).fill(awb);
  // A 1×1 PNG stands in for the camera.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.locator('input[type="file"]').first().setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText(/Uploaded/i).first()).toBeVisible();
  await page.getByRole("button", { name: /Save|Create/ }).last().click();
  await expect(page).toHaveURL(/\/app\/shipments\/[0-9a-f-]{36}/);
  await expect(page.getByText(awb)).toBeVisible();

  await page.getByRole("button", { name: /In transit/i }).first().click();
  const confirm = page.getByRole("button", { name: /Update|Confirm|Save/ }).last();
  if (await confirm.isVisible()) await confirm.click();
  await expect(page.getByText(/In transit/i).first()).toBeVisible();
});
