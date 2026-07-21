import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const publicDirectory = resolve("public");
const source = resolve(publicDirectory, "icon.png");
const pngTargets = [
  { name: "favicon-16x16.png", size: 16 },
  { name: "favicon-32x32.png", size: 32 },
  { name: "apple-touch-icon.png", size: 180 },
  { name: "android-chrome-192x192.png", size: 192 },
  { name: "android-chrome-512x512.png", size: 512 },
  { name: "android-chrome-maskable-512x512.png", size: 512 },
] as const;

for (const target of pngTargets) {
  await sharp(source)
    .resize(target.size, target.size, { fit: "cover", kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toFile(resolve(publicDirectory, target.name));
}

const faviconSizes = [16, 32, 48] as const;
const faviconImages = await Promise.all(
  faviconSizes.map((size) =>
    sharp(source)
      .resize(size, size, { fit: "cover", kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9 })
      .toBuffer(),
  ),
);
await writeFile(resolve(publicDirectory, "favicon.ico"), createIco(faviconSizes, faviconImages));

const metadata = await sharp(await readFile(source)).metadata();
console.info(
  `${pngTargets.length + 1} App-Icon-Dateien aus ${metadata.width}x${metadata.height} Pixeln erzeugt.`,
);

function createIco(sizes: readonly number[], images: readonly Buffer[]): Buffer {
  const headerSize = 6;
  const directoryEntrySize = 16;
  const header = Buffer.alloc(headerSize + directoryEntrySize * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let imageOffset = header.length;
  for (const [index, image] of images.entries()) {
    const size = sizes[index];
    if (!size) {
      throw new Error("Favicon-Größe fehlt.");
    }
    const offset = headerSize + index * directoryEntrySize;
    header.writeUInt8(size === 256 ? 0 : size, offset);
    header.writeUInt8(size === 256 ? 0 : size, offset + 1);
    header.writeUInt8(0, offset + 2);
    header.writeUInt8(0, offset + 3);
    header.writeUInt16LE(1, offset + 4);
    header.writeUInt16LE(32, offset + 6);
    header.writeUInt32LE(image.length, offset + 8);
    header.writeUInt32LE(imageOffset, offset + 12);
    imageOffset += image.length;
  }
  return Buffer.concat([header, ...images]);
}
