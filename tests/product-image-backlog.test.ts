import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { AuthService } from "../src/server/auth-service.ts";
import { loadConfig } from "../src/server/config.ts";
import { openDatabase } from "../src/server/database.ts";
import { ProductImageBacklog } from "../src/server/product-image-backlog.ts";
import { ShoppingService } from "../src/server/shopping-service.ts";

const manifest = {
  version: 2,
  images: [{ id: "milch", file: "images/products/milch.jpg" }],
  products: [{ id: "milch", image: "milch", names: ["Milch"] }],
};

test("saved unknown products are deduplicated; reports require item access and resolve after deployment", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "image-backlog-"));
  const database = await openDatabase(":memory:");
  try {
    await mkdir(resolve(directory, "images/products"), { recursive: true });
    await writeFile(resolve(directory, "images/product-images.json"), JSON.stringify(manifest));
    await writeFile(resolve(directory, "images/products/milch.jpg"), "original image bytes");
    const backlog = new ProductImageBacklog(database, directory);
    const shopping = new ShoppingService(database, backlog);
    const auth = new AuthService(database, loadConfig({ APP_ENV: "test" }));
    const owner = (
      await auth.register({
        displayName: "Chris",
        email: "backlog@example.com",
        password: "Ein ausreichend langes Passwort",
      })
    ).user;
    const outsider = (
      await auth.register({
        displayName: "Dana",
        email: "other@example.com",
        password: "Ein weiteres langes Passwort",
      })
    ).user;
    const list = shopping.createList(owner, "Einkauf");
    const milk = shopping.addItem(owner, list.id, { name: "Milch" });
    assert.equal(backlog.export().products.length, 0);
    assert.throws(() => shopping.addItem(outsider, list.id, { name: "Secret" }));
    assert.throws(() => shopping.addItem(owner, list.id, { name: "", quantities: [] }));
    const unknown = shopping.addItem(owner, list.id, { name: "  Drachenfrucht  " });
    shopping.addItem(owner, list.id, { name: "DRACHENFRUCHT" });
    let exported = backlog.export();
    assert.equal(exported.products.length, 1);
    assert.equal(exported.products[0]?.occurrences, 2);
    assert.equal(exported.products[0]?.reason, "missing");
    assert.equal("householdId" in (exported.products[0] ?? {}), false);
    assert.throws(() => shopping.reportItemImage(outsider, milk.item.id));
    shopping.reportItemImage(owner, milk.item.id);
    assert.equal(backlog.export().products.length, 2);
    // No observations when loading/rendering or changing only notes.
    shopping.getState(owner);
    shopping.updateItem(owner, unknown.item.id, { persistentNote: "test" });
    assert.equal(
      backlog.export().products.find((entry) => entry.reason === "missing")?.occurrences,
      2,
    );
    shopping.updateItem(owner, unknown.item.id, { name: "Unbekanntes Shampoo" });
    assert.equal(backlog.export().products.length, 3);
    // A failed batch rolls observations back with its items.
    assert.throws(() =>
      shopping.addRecipeItems(owner, list.id, [{ name: "Rollback-Produkt" }, { name: "" }]),
    );
    assert.equal(
      backlog.export().products.some((entry) => entry.name === "Rollback-Produkt"),
      false,
    );
    await writeFile(resolve(directory, "images/products/milch.jpg"), "new image bytes");
    exported = new ProductImageBacklog(database, directory).export();
    assert.equal(
      exported.products.some((entry) => entry.reason === "reported"),
      false,
    );
    await writeFile(
      resolve(directory, "images/product-images.json"),
      JSON.stringify({
        ...manifest,
        products: [
          ...manifest.products,
          { id: "drachenfrucht", image: "milch", names: ["Drachenfrucht"] },
        ],
      }),
    );
    assert.equal(new ProductImageBacklog(database, directory).export().products.length, 1);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("VPS export is read-only, repeatable and writes only product knowledge with private permissions", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "image-backlog-export-"));
  const dbPath = resolve(directory, "app.db");
  const output = resolve(directory, "export.json");
  const database = await openDatabase(dbPath);
  try {
    await mkdir(resolve(directory, "images"), { recursive: true });
    await writeFile(
      resolve(directory, "images/product-images.json"),
      JSON.stringify({ version: 2, images: [], products: [] }),
    );
    const backlog = new ProductImageBacklog(database, directory);
    backlog.record("Hafercuisine");
    const args = [
      "--import",
      "tsx",
      "scripts/export-product-image-backlog.ts",
      "--database",
      dbPath,
      "--public",
      directory,
      "--output",
      output,
    ];
    const run = promisify(execFile);
    await run(process.execPath, args);
    await run(process.execPath, args);
    const exported = JSON.parse(await readFile(output, "utf8"));
    assert.equal(exported.products.length, 1);
    assert.equal(exported.products[0].name, "Hafercuisine");
    assert.equal(exported.products[0].occurrences, 1);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.equal(backlog.export().products[0]?.occurrences, 1);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
