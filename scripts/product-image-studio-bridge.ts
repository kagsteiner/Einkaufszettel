import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createProductImageCatalog,
  productImageFile,
  unknownProductImageFile,
} from "../src/shared/product-image-catalog.ts";
import { assignProductImage, importProductImage, readManifest } from "./product-image-files.ts";

const root = resolve(import.meta.dirname, "..");
let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
  const payload = JSON.parse(input);
  if (payload.action === "adopt") {
    await importProductImage(root, payload.name, await readFile(payload.source));
  } else if (payload.action === "assign") {
    await assignProductImage(root, payload.name, payload.imageId);
  } else if (payload.action === "catalog") {
    const manifest = await readManifest(resolve(root, "public/images/product-images.json"));
    const catalog = createProductImageCatalog(manifest);
    const products = await Promise.all(
      (payload.names as string[]).map(async (name) => {
        const file = productImageFile(catalog, name);
        const signature =
          file === unknownProductImageFile
            ? "unknown"
            : createHash("sha256")
                .update(file)
                .update(await readFile(resolve(root, "public", file)))
                .digest("hex");
        return { name, file, signature };
      }),
    );
    console.info(JSON.stringify({ products, images: manifest.images }));
    process.exit(0);
  } else throw new Error("Unbekannte Aktion.");
  console.info(JSON.stringify({ ok: true }));
} catch {
  console.info(
    JSON.stringify({
      error: "Bildkatalog konnte nicht aktualisiert werden. Namen, Bild-ID und Dateien prüfen.",
    }),
  );
  process.exitCode = 1;
}
