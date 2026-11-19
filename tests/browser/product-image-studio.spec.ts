import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const studio = resolve("tools/product-image-studio/web");

test("studio imports a backlog, submits an explicit paid job and adopts its selected variant", async ({
  page,
}, testInfo) => {
  let adopted = false;
  let submitted: Record<string, unknown> | undefined;
  const job = {
    id: "fixture",
    productName: "Hafercuisine",
    provider: "openai",
    model: "gpt-image-1.5",
    quality: "medium",
    variantCount: 1,
    imageSize: 1024,
    seed: 42,
    status: "completed",
    progress: 100,
    referenceCount: 0,
    results: [{ filename: "variant.png", url: "/fixture.png" }],
    selectedIndex: null as number | null,
    adoptedIndex: null as number | null,
    error: null,
  };
  const backlog = () => ({
    images: [{ id: "milch", file: "images/products/milch.jpg" }],
    products: [
      {
        name: "Hafercuisine",
        occurrences: 4,
        reason: "missing",
        localImage: "images/products/unbekannt.jpg",
        resolvedLocally: adopted,
      },
    ],
  });
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/studio-test")
      return route.fulfill({ path: resolve(studio, "index.html"), contentType: "text/html" });
    if (path === "/app.js" || path === "/styles.css")
      return route.fulfill({
        path: resolve(studio, path.slice(1)),
        contentType: path.endsWith("js") ? "text/javascript" : "text/css",
      });
    let payload: unknown;
    if (path === "/api/health") payload = { model: "FLUX", device: "mps", openAiAvailable: true };
    else if (path === "/api/backlog" || path === "/api/backlog/import") payload = backlog();
    else if (path === "/api/jobs" && route.request().method() === "POST") {
      submitted = route.request().postDataJSON();
      payload = { job };
    } else if (path === "/api/jobs") payload = { jobs: submitted ? [job] : [] };
    else if (path === "/api/jobs/fixture/select") {
      job.selectedIndex = 0;
      payload = { job };
    } else if (path === "/api/jobs/fixture/adopt") {
      adopted = true;
      job.adoptedIndex = 0;
      payload = { job };
    } else if (path.startsWith("/catalog/") || path === "/fixture.png") {
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQvQAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    } else return route.continue();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.goto("/studio-test");
  await page.locator("[data-backlog-file]").setInputFiles({
    name: "product-image-backlog.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ version: 1, kind: "product-image-backlog", products: [] }),
    ),
  });
  await expect(page.getByText(/Backlog importiert/)).toBeVisible();
  await page.getByRole("button", { name: "Generieren / neu versuchen" }).click();
  await expect(page.locator('[name="productName"]')).toHaveValue("Hafercuisine");
  await page.locator('[name="provider"]').selectOption("openai");
  await page.locator('[name="variantCount"]').selectOption("1");
  await expect(page.getByText(/Jede Variante erzeugt einen kostenpflichtigen/)).toBeVisible();
  await expect(page.locator('[name="imageSize"]')).toBeDisabled();
  await page.getByRole("button", { name: "Kostenpflichtig generieren" }).click();
  await expect(page.locator("[data-job-name]")).toHaveText("Hafercuisine");
  expect(submitted).toMatchObject({
    productName: "Hafercuisine",
    provider: "openai",
    model: "gpt-image-1.5",
    quality: "medium",
    imageSize: 1024,
    variantCount: 1,
  });
  await expect(page.getByRole("button", { name: "In Bildersammlung übernehmen" })).toBeDisabled();
  await page.locator("[data-select-result]").click();
  await page.getByRole("button", { name: "In Bildersammlung übernehmen" }).click();
  await expect(page.getByRole("button", { name: "Lokal übernommen" })).toBeDisabled();
  await expect(page.getByText(/Lokal erledigt · Deployment separat/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("studio.png"), fullPage: true });
});
