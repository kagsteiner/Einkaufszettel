import { expect, test } from "@playwright/test";

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
