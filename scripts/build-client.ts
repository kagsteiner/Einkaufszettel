import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { build } from "esbuild";

const projectRoot = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(projectRoot, "dist/public");
const sourceDirectory = resolve(projectRoot, "src/client");
const version = process.env.APP_VERSION?.trim() || `dev-${Date.now().toString(36)}`;

await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });

const result = await build({
  absWorkingDir: projectRoot,
  bundle: true,
  entryNames: "assets/[name]-[hash]",
  entryPoints: ["src/client/main.ts"],
  legalComments: "none",
  metafile: true,
  minify: process.env.NODE_ENV === "production",
  outdir: "dist/public",
  platform: "browser",
  sourcemap: process.env.NODE_ENV !== "production",
  target: ["safari17", "chrome120"],
});

const javaScriptOutput = Object.entries(result.metafile.outputs).find(
  ([, metadata]) => metadata.entryPoint === "src/client/main.ts",
);

if (!javaScriptOutput) {
  throw new Error("Der Client-Build hat keine JavaScript-Einstiegsdatei erzeugt.");
}

const [javaScriptPath, javaScriptMetadata] = javaScriptOutput;
const toPublicPath = (filePath: string): string => {
  const absolutePath = resolve(projectRoot, filePath);
  const path = relative(outputDirectory, absolutePath).split(sep).join("/");
  return `/${path}`;
};

const template = await readFile(resolve(sourceDirectory, "index.html"), "utf8");
const html = template
  .replaceAll("__APP_VERSION__", version)
  .replace("__APP_SCRIPT__", toPublicPath(javaScriptPath))
  .replace(
    "__APP_STYLES__",
    javaScriptMetadata.cssBundle
      ? `<link rel="stylesheet" href="${toPublicPath(javaScriptMetadata.cssBundle)}">`
      : "",
  );

await Promise.all([
  writeFile(resolve(outputDirectory, "index.html"), html),
  writeFile(resolve(outputDirectory, "version.json"), `${JSON.stringify({ version })}\n`),
  writeFile(
    resolve(outputDirectory, "manifest.webmanifest"),
    `${JSON.stringify(
      {
        name: "Einkaufszettel",
        short_name: "Einkauf",
        description: "Der gemeinsame Einkaufszettel für den Haushalt.",
        start_url: "/",
        display: "standalone",
        background_color: "#f4efe4",
        theme_color: "#26382e",
      },
      null,
      2,
    )}\n`,
  ),
]);
