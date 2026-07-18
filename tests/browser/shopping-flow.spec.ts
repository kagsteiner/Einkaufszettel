import { expect, test } from "@playwright/test";

test("a household can maintain a live mobile shopping list", async ({ page }, testInfo) => {
  const documentResponse = await page.goto("/");
  expect(documentResponse?.headers()["cache-control"]).toBe("no-store");
  const scriptSource = await page.locator('script[type="module"]').getAttribute("src");
  expect(scriptSource).toMatch(/^\/assets\/main-[A-Z0-9]+\.js$/i);
  const assetResponse = await page.request.get(scriptSource || "");
  expect(assetResponse.headers()["cache-control"]).toContain("immutable");
  const versionResponse = await page.request.get("/api/version");
  expect(versionResponse.headers()["cache-control"]).toBe("no-store");
  await page.getByRole("button", { name: "Neu hier" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Browser Familie");
  await page.getByLabel("E-Mail", { exact: true }).fill(`${testInfo.project.name}@example.com`);
  await page.getByLabel("Passwort", { exact: true }).fill("Ein langes Browser-Testpasswort");
  await page.getByRole("button", { name: "Loslegen" }).click();

  await expect(page.getByRole("heading", { name: "Dein erster Zettel" })).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Zettel anlegen" }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Supermarkt");
  await page.getByRole("dialog").getByRole("button", { name: "Speichern" }).click();

  await page.getByLabel("Produkt", { exact: true }).fill("Hafermilch");
  await page.getByLabel("Menge", { exact: true }).fill("2");
  await page.getByLabel("Einheit", { exact: true }).fill("l");
  await page.getByRole("button", { name: "Zum Zettel hinzufügen" }).click();
  await expect(page.getByText("2 l", { exact: true })).toBeVisible();

  await page.getByLabel("Produkt", { exact: true }).fill("HAFERMILCH");
  await page.getByLabel("Menge", { exact: true }).fill("1");
  await page.getByLabel("Einheit", { exact: true }).fill("Liter");
  await page.getByRole("button", { name: "Zum Zettel hinzufügen" }).click();
  await expect(page.getByText("3 l", { exact: true })).toBeVisible();
  await expect(page.getByText("Vorhandene Menge wurde erhöht.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Als erledigt markieren" }).click();
  await expect(page.getByText("1 erledigt", { exact: true })).toBeVisible();

  const registrations = await page.evaluate(async () => navigator.serviceWorker.getRegistrations());
  expect(registrations).toHaveLength(0);
});
