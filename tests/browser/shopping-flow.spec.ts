import { expect, test } from "@playwright/test";

test("the app shell advertises browser, iOS and Android icons", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="icon"][sizes="32x32"]')).toHaveAttribute(
    "href",
    "favicon-32x32.png",
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "apple-touch-icon.png",
  );

  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  const manifest = (await manifestResponse.json()) as { icons?: unknown };
  expect(manifest.icons).toEqual([
    {
      purpose: "any",
      sizes: "192x192",
      src: "android-chrome-192x192.png",
      type: "image/png",
    },
    {
      purpose: "any",
      sizes: "512x512",
      src: "android-chrome-512x512.png",
      type: "image/png",
    },
    {
      purpose: "maskable",
      sizes: "512x512",
      src: "android-chrome-maskable-512x512.png",
      type: "image/png",
    },
  ]);
  for (const path of [
    "/favicon.ico",
    "/favicon-16x16.png",
    "/favicon-32x32.png",
    "/apple-touch-icon.png",
    "/android-chrome-192x192.png",
    "/android-chrome-512x512.png",
    "/android-chrome-maskable-512x512.png",
  ]) {
    expect((await page.request.get(path)).ok(), path).toBe(true);
  }
});

test("a password reset link asks once for a new password", async ({ page }) => {
  let resetPayload: unknown = null;
  await page.route("**/api/auth/password-reset", async (route) => {
    resetPayload = route.request().postDataJSON();
    await route.fulfill({ body: JSON.stringify({ ok: true }), contentType: "application/json" });
  });

  await page.goto("/passwort-zuruecksetzen/browser-reset-token");
  await expect(page.getByRole("heading", { name: "Passwort festlegen" })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(1);
  await page.getByLabel("Neues Passwort").fill("Ein ganz neues Browserpasswort");
  await page.getByRole("button", { name: "Passwort speichern" }).click();

  await expect(page.getByRole("heading", { name: "Willkommen zurück" })).toBeVisible();
  await expect(
    page.getByText("Passwort gespeichert. Du kannst dich jetzt anmelden."),
  ).toBeVisible();
  expect(resetPayload).toEqual({
    password: "Ein ganz neues Browserpasswort",
    token: "browser-reset-token",
  });
});

test("removing a household member updates the open settings immediately", async ({
  browser,
  page,
}, testInfo) => {
  const suffix = testInfo.project.name;
  await register(page, "Alex Browser", `alex-household-${suffix}@example.com`);

  await page.getByRole("button", { name: "Einstellungen" }).click();
  const settings = page.getByRole("dialog");
  await settings.getByLabel("E-Mail", { exact: true }).fill(`bea-household-${suffix}@example.com`);
  await settings.getByRole("button", { name: "Link erzeugen" }).click();
  const invitationUrl = await settings.locator(".copy-output input").inputValue();
  await settings.getByRole("button", { name: "Schließen" }).click();

  const invitedContext = await browser.newContext();
  const invitedPage = await invitedContext.newPage();
  await register(invitedPage, "Bea Browser", `bea-household-${suffix}@example.com`);
  await invitedPage.goto(invitationUrl);
  const invitation = invitedPage.getByRole("dialog");
  await invitation.getByRole("button", { name: "Beitreten" }).click();
  await expect(invitedPage.getByText("Haushalt beigetreten.", { exact: true })).toBeVisible();

  await expect(
    page.locator(".household-title").getByText("2 Personen", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Einstellungen" }).click();
  const updatedSettings = page.getByRole("dialog");
  await expect(updatedSettings.getByText("Bea Browser", { exact: true })).toBeVisible();
  page.once("dialog", (confirmation) => void confirmation.accept());
  await updatedSettings.getByRole("button", { name: "Entfernen" }).click();

  const refreshedSettings = page.getByRole("dialog");
  await expect(refreshedSettings.getByText("Bea Browser", { exact: true })).toHaveCount(0);
  await expect(
    page.locator(".household-title").getByText("1 Person", { exact: true }),
  ).toBeVisible();
  await invitedContext.close();
});

test("a household can maintain a live mobile shopping list", async ({ page }, testInfo) => {
  const documentResponse = await page.goto("/");
  expect(documentResponse?.headers()["cache-control"]).toBe("no-store");
  const scriptSource = await page.locator('script[type="module"]').getAttribute("src");
  expect(scriptSource).toMatch(/^assets\/main-[A-Z0-9]+\.js$/i);
  const assetPath = scriptSource ? new URL(scriptSource, page.url()).pathname : "";
  const assetResponse = await page.request.get(assetPath);
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

  const paperGeometry = await page.locator(".list-paper").evaluate((paper) => {
    const heading = paper.querySelector<HTMLElement>(".list-heading");
    const row = paper.querySelector<HTMLElement>(".shopping-row");
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    const rule =
      Number.parseFloat(getComputedStyle(paper).getPropertyValue("--paper-rule")) * rootFontSize;
    if (!heading || !row) {
      throw new Error("Papierkopf oder Einkaufszeile fehlt.");
    }
    const paperTop = paper.getBoundingClientRect().top;
    const headingBottom = heading.getBoundingClientRect().bottom;
    const rowRect = row.getBoundingClientRect();
    return {
      headingRules: (headingBottom - paperTop) / rule,
      rowOffsetRules: (rowRect.top - paperTop) / rule,
      rowRules: rowRect.height / rule,
    };
  });
  expect(paperGeometry.headingRules).toBeCloseTo(2, 2);
  expect(paperGeometry.rowOffsetRules).toBeCloseTo(2, 2);
  expect(paperGeometry.rowRules).toBeCloseTo(1, 2);
  const headingFits = await page.locator(".list-heading").evaluate((heading) => {
    const actions = heading.querySelector<HTMLElement>(".heading-actions");
    const title = heading.querySelector<HTMLElement>(".list-title");
    if (!actions || !title) {
      throw new Error("Zetteltitel oder Aktionen fehlen.");
    }
    const headingRect = heading.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    return {
      actionsInside: actionsRect.right <= headingRect.right + 1,
      noOverlap: titleRect.right <= actionsRect.left + 1,
    };
  });
  expect(headingFits).toEqual({ actionsInside: true, noOverlap: true });

  await page.route("**/api/ai/recipe-analysis", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        analysis: {
          ingredients: [
            {
              amount: "3",
              category: "pantry",
              inPantry: false,
              name: "Olivenöl",
              note: null,
              unit: "EL",
            },
          ],
          title: "Zutaten",
        },
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.locator("[data-recipe-file]").setInputFiles({
    buffer: Buffer.from("browser-test"),
    mimeType: "image/jpeg",
    name: "rezept.jpg",
  });
  const recipeDialog = page.getByRole("dialog");
  await expect(recipeDialog.getByRole("heading", { name: "Zutaten" })).toBeVisible();
  const ingredient = recipeDialog.locator(".ingredient-preview");
  await expect(ingredient).toHaveCount(1);
  const ingredientGeometry = await ingredient.evaluate((preview) => {
    const selection = preview.querySelector<HTMLElement>(".ingredient-select");
    const productLabel = [...preview.querySelectorAll<HTMLElement>(":scope > label")].find(
      (label) => label !== selection && label.textContent?.trim().startsWith("Produkt"),
    );
    if (!selection || !productLabel) {
      throw new Error("Rezeptauswahl oder Produktfeld fehlt.");
    }
    return {
      productTop: productLabel.getBoundingClientRect().top,
      selectionBottom: selection.getBoundingClientRect().bottom,
    };
  });
  expect(ingredientGeometry.selectionBottom).toBeLessThan(ingredientGeometry.productTop);
  await recipeDialog.getByRole("button", { name: "Schließen" }).click();

  let recurringItems: unknown = null;
  await page.route("**/api/lists/*/recurring-items", async (route) => {
    if (route.request().method() === "POST") {
      recurringItems = route.request().postDataJSON();
      await route.fulfill({ body: JSON.stringify({ items: [] }), contentType: "application/json" });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        suggestions: [
          {
            category: "drinks",
            dueAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
            itemId: "hafermilch-history",
            lastPurchasedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1_000).toISOString(),
            name: "Hafermilch",
            note: null,
            quantities: [{ amount: "2", id: "quantity", unit: "l" }],
          },
        ],
      }),
      contentType: "application/json",
    });
  });
  await page.locator("[data-recurring-items]").click();
  const recurringDialog = page.getByRole("dialog");
  await expect(recurringDialog.getByRole("heading", { name: "Was ist dran?" })).toBeVisible();
  await expect(recurringDialog.getByText("morgen fällig", { exact: true })).toBeVisible();
  await recurringDialog.getByLabel("Menge").first().fill("3");
  await recurringDialog.getByRole("button", { name: "Auswahl hinzufügen" }).click();
  await expect(page.getByText("1 Produkt hinzugefügt.", { exact: true })).toBeVisible();
  expect(recurringItems).toEqual({
    items: [
      {
        itemId: "hafermilch-history",
        name: "Hafermilch",
        quantities: [{ amount: "3", unit: "l" }],
      },
    ],
  });

  await page.getByRole("button", { name: "Als erledigt markieren" }).click();
  await expect(page.getByText("1 erledigt", { exact: true })).toBeVisible();

  const registrations = await page.evaluate(async () => navigator.serviceWorker.getRegistrations());
  expect(registrations).toHaveLength(0);
});

async function register(page: import("@playwright/test").Page, name: string, email: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Neu hier" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("E-Mail", { exact: true }).fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill("Ein langes Browser-Testpasswort");
  await page.getByRole("button", { name: "Loslegen" }).click();
  await expect(page.getByRole("heading", { name: "Dein erster Zettel" })).toBeVisible();
}
