import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import type { AuthenticatedUser } from "./auth-service.ts";
import type { AppConfig } from "./config.ts";
import type { AppDatabase } from "./database.ts";
import { AppError } from "./errors.ts";

export const maximumImageBytes = 15 * 1_024 * 1_024;
const acceptedInputTypes = new Set([
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type PreparedImage = Readonly<{
  buffer: Buffer;
  height: number;
  mimeType: "image/webp";
  width: number;
}>;

type ImageRow = {
  mime_type: string;
  storage_name: string;
};

export class ImageService {
  private readonly config: AppConfig;
  private readonly database: AppDatabase;

  constructor(database: AppDatabase, config: AppConfig) {
    this.database = database;
    this.config = config;
  }

  async prepareImage(input: Buffer, contentType: string): Promise<PreparedImage> {
    if (!acceptedInputTypes.has(contentType)) {
      throw new AppError(
        415,
        "unsupported_image_type",
        "Unterstützt werden JPEG, PNG, WebP und HEIC.",
      );
    }
    if (input.length < 1 || input.length > maximumImageBytes) {
      throw new AppError(413, "image_too_large", "Das Bild darf höchstens 15 MB groß sein.");
    }

    try {
      const source = sharp(input, { failOn: "error", limitInputPixels: 48_000_000 });
      const metadata = await source.metadata();
      if (!metadata.format || !["jpeg", "png", "webp", "heif"].includes(metadata.format)) {
        throw new Error("unsupported image contents");
      }
      const converted = await source
        .rotate()
        .resize({ fit: "inside", height: 1_600, width: 1_600, withoutEnlargement: true })
        .webp({ effort: 4, quality: 84 })
        .toBuffer({ resolveWithObject: true });
      return {
        buffer: converted.data,
        height: converted.info.height,
        mimeType: "image/webp",
        width: converted.info.width,
      };
    } catch {
      throw new AppError(422, "invalid_image", "Das Bild konnte nicht verarbeitet werden.");
    }
  }

  async storeImage(
    user: AuthenticatedUser,
    input: Buffer,
    contentType: string,
  ): Promise<{ id: string }> {
    const image = await this.prepareImage(input, contentType);
    await mkdir(this.config.uploadDirectory, { mode: 0o700, recursive: true });
    const storageName = `${randomBytes(24).toString("hex")}.webp`;
    const filePath = resolve(this.config.uploadDirectory, storageName);
    await writeFile(filePath, image.buffer, { flag: "wx", mode: 0o600 });
    const id = randomUUID();
    try {
      this.database
        .prepare(
          `INSERT INTO images
            (id, household_id, uploaded_by_user_id, storage_name, mime_type,
             byte_size, width, height, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          user.householdId,
          user.id,
          storageName,
          image.mimeType,
          image.buffer.length,
          image.width,
          image.height,
          new Date().toISOString(),
        );
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
    return { id };
  }

  async readImage(
    user: AuthenticatedUser,
    imageId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const row = this.database
      .prepare("SELECT storage_name, mime_type FROM images WHERE id = ? AND household_id = ?")
      .get(imageId, user.householdId) as ImageRow | undefined;
    if (!row) {
      throw new AppError(404, "image_not_found", "Bild nicht gefunden.");
    }
    try {
      return {
        buffer: await readFile(resolve(this.config.uploadDirectory, row.storage_name)),
        mimeType: row.mime_type,
      };
    } catch {
      throw new AppError(404, "image_not_found", "Bild nicht gefunden.");
    }
  }

  assertImageAccess(user: AuthenticatedUser, imageId: string | null): void {
    if (imageId === null) {
      return;
    }
    const row = this.database
      .prepare("SELECT 1 FROM images WHERE id = ? AND household_id = ?")
      .get(imageId, user.householdId);
    if (!row) {
      throw new AppError(404, "image_not_found", "Bild nicht gefunden.");
    }
  }
}
