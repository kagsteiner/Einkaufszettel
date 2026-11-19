import { readFile } from "node:fs/promises";
import OpenAI from "openai";
import { generateStudioImage } from "./studio-openai.ts";

let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY fehlt in der Startumgebung.");
  const payload = JSON.parse(input);
  const image = await generateStudioImage(
    {
      prompt: payload.prompt,
      model: payload.model,
      quality: payload.quality,
      references: await Promise.all(
        (payload.reference_paths as string[]).map((path) => readFile(path)),
      ),
    },
    new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 0,
      timeout: 300_000,
      logLevel: "off",
    }),
  );
  console.info(JSON.stringify({ image }));
} catch (error) {
  console.info(
    JSON.stringify({
      error: error instanceof Error ? error.message : "OpenAI-Auftrag fehlgeschlagen.",
    }),
  );
  process.exitCode = 1;
}
