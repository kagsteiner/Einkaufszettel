import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createProductImageCatalog,
  normalizeProductName,
  productImageFile,
  unknownProductImageFile,
} from "../shared/product-image-catalog.ts";
import type { AppDatabase } from "./database.ts";

type BacklogRow = {
  name: string;
  reason: "missing" | "reported";
  image_signature: string;
  first_seen: string;
  last_seen: string;
  occurrences: number;
};

/** Uses the same deployed catalog and matching rules as the browser. */
export class ProductImageBacklog {
  private readonly catalog;
  private readonly database: AppDatabase;
  private readonly publicDirectory: string;

  constructor(database: AppDatabase, publicDirectory: string) {
    this.database = database;
    this.publicDirectory = publicDirectory;
    this.catalog = createProductImageCatalog(
      JSON.parse(readFileSync(resolve(publicDirectory, "images/product-images.json"), "utf8")),
    );
  }

  record(name: string, reported = false): void {
    const file = productImageFile(this.catalog, name);
    if (!reported && this.signature(file) !== "unknown") {
      return;
    }
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO product_image_backlog
          (normalized_name, name, reason, image_signature, first_seen, last_seen, occurrences)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(normalized_name) DO UPDATE SET
           name = excluded.name,
           reason = CASE WHEN excluded.reason = 'reported' THEN 'reported' ELSE reason END,
           image_signature = excluded.image_signature,
           last_seen = excluded.last_seen,
           occurrences = occurrences + 1`,
      )
      .run(
        normalizeProductName(name),
        name,
        reported ? "reported" : "missing",
        this.signature(file),
        now,
        now,
      );
  }

  export() {
    const products = (
      this.database
        .prepare("SELECT * FROM product_image_backlog ORDER BY occurrences DESC, normalized_name")
        .all() as BacklogRow[]
    ).flatMap((row) => {
      const currentImage = productImageFile(this.catalog, row.name);
      // A deployment that supplies/changes the image resolves the old request.
      if (
        (row.reason === "missing" && this.signature(currentImage) !== "unknown") ||
        (row.reason === "reported" && row.image_signature !== this.signature(currentImage))
      ) {
        return [];
      }
      return [
        {
          name: row.name,
          reason: row.reason,
          currentImage,
          imageSignature: row.image_signature,
          firstSeen: row.first_seen,
          lastSeen: row.last_seen,
          occurrences: row.occurrences,
        },
      ];
    });
    return {
      version: 1,
      kind: "product-image-backlog",
      exportedAt: new Date().toISOString(),
      products,
    };
  }

  private signature(file: string): string {
    if (file === unknownProductImageFile) {
      return "unknown";
    }
    try {
      return createHash("sha256")
        .update(file)
        .update(readFileSync(resolve(this.publicDirectory, file)))
        .digest("hex");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "unknown";
      throw error;
    }
  }
}
