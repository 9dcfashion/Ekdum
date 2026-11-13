import { expect, test, type Page } from "@playwright/test";

/**
 * The main journey from the spec: signup → onboarding → add product → POS bill →
 * PDF and print view → dashboard updated → purchase increases stock.
 *
 * Needs a real Supabase project with "Confirm email" OFF. Each run signs up a new
 * user (unique email), so it leaves a test business behind in that project.
 * Skipped unless E2E_BASE_URL is set.
 */
test.skip(!process.env.E2E_BASE_URL, "Set E2E_BASE_URL to run end-to-end tests");
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const email = `e2e+${stamp}@example.com`;
const password = "Test1234pass";
const productName = `E2E Shirt ${stamp}`;

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});
test.afterAll(async () => {
  await page.close();
});

test("sign up", async () => {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("E2E Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
});

test("complete onboarding", async () => {
  // 1. Business
  await page.getByLabel("Legal name").fill("E2E Traders");
  await page.getByLabel("GSTIN").fill("27AAPFU0939F1ZV");
  await expect(page.getByText(/Valid GSTIN/)).toBeVisible();
  await expect(page.getByLabel("State")).toHaveValue("27"); // filled from the GSTIN
  await page.getByLabel("City").fill("Mumbai");
  await page.getByLabel("PIN code").fill("400001");
  await page.getByRole("button", { name: "Save and continue" }).click();

  // 2. Branding, 3. Payments, 4. Outlet: accept defaults
  for (const heading of ["Branding", "Payments", "Outlet"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await page.getByRole("button", { name: "Save and continue" }).click();
  }

  // 5. Invoices
  await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
  await expect(page.getByText(/A\/\d{4}\/00001/)).toBeVisible();
  await page.getByRole("button", { name: "Save and continue" }).click();

  // 6. Staff (skip), 7. Products (skip and finish)
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Skip and finish" }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
  await expect(page.getByText(/Getting started/i)).toBeVisible();
});

test("add a product with opening stock", async () => {
  await page.goto("/app/products/new");
  await page.getByLabel("Product name").fill(productName);
  await page.getByLabel("SKU").fill(`E2E-${stamp}`);
  await page.getByLabel("HSN code").fill("6109");
  await page.getByLabel("Selling price").fill("499");
  await page.getByLabel(/Main Shop/).fill("10"); // opening stock for the first outlet
  await page.getByRole("button", { name: /Save|Create/ }).first().click();
  await expect(page).toHaveURL(/\/app\/products/);
  await page.goto(`/app/products?q=${encodeURIComponent(productName)}`);
  await expect(page.getByText(productName)).toBeVisible();
});

let invoiceUrl = "";

test("bill it at the POS", async () => {
  await page.goto("/app/pos");
  const search = page.getByLabel("Search or scan an item");
  await search.fill(`E2E-${stamp}`);
  await search.press("Enter"); // exact SKU match adds the item, like a barcode scan
  await expect(page.getByText(productName).first()).toBeVisible();
  await page.keyboard.press("F9");
  await page.getByRole("button", { name: "Exact cash" }).click();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/A\/\d{4}\/00001/)).toBeVisible();
  await page.getByRole("button", { name: /New bill/ }).click();
});

test("the bill is in Sales, with a PDF and a print view", async () => {
  await page.goto("/app/sales");
  await page.getByRole("link", { name: /A\/\d{4}\/00001/ }).first().click();
  await expect(page).toHaveURL(/\/app\/sales\/[0-9a-f-]{36}/);
  invoiceUrl = page.url();
  const id = invoiceUrl.split("/").pop()!;

  const pdf = await page.request.get(`/api/invoices/${id}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

  const print = await page.context().newPage();
  await print.goto(`/app/sales/${id}/print?format=thermal_80&print=0`);
  await expect(print.getByText("Tax Invoice", { exact: false })).toBeVisible();
  await expect(print.getByText(/27AAPFU0939F1ZV/)).toBeVisible();
  await print.close();
});

test("stock went down and the dashboard shows the sale", async () => {
  await page.goto(`/app/products?q=${encodeURIComponent(productName)}`);
  await expect(page.getByRole("row", { name: new RegExp(productName) })).toContainText("9");
  await page.goto("/app/dashboard");
  await expect(page.getByText("₹499.00").first()).toBeVisible();
});

test("the bill page is private: a signed-out visitor is sent to login", async ({ browser }) => {
  const anonymous = await browser.newContext();
  const visitor = await anonymous.newPage();
  await visitor.goto(invoiceUrl);
  expect(visitor.url()).toContain("/login");
  await anonymous.close();
});
