import type OpenAI from "openai";
import { APIError, toFile } from "openai";

export type StudioImageOptions = {
  prompt: string;
  model: string;
  quality: "low" | "medium" | "high";
  references: Buffer[];
};

export async function generateStudioImage(
  options: StudioImageOptions,
  client: OpenAI,
): Promise<string> {
  const parameters = {
    model: options.model,
    prompt: options.prompt,
    quality: options.quality,
    size: "1024x1024" as const,
    output_format: "png" as const,
    n: 1,
  };
  try {
    const result = options.references.length
      ? await client.images.edit({
          ...parameters,
          image: await Promise.all(
            options.references.map((buffer, index) =>
              toFile(buffer, `reference-${index}.jpg`, { type: "image/jpeg" }),
            ),
          ),
        })
      : await client.images.generate(parameters);
    const image = result.data?.[0]?.b64_json;
    if (!image) throw new Error("empty_image");
    return image;
  } catch (error) {
    // Never expose provider bodies, prompts, authorization headers, or keys in logs/UI.
    if (error instanceof APIError && error.status === 401)
      throw new Error("OpenAI-Schlüssel wurde abgelehnt.");
    if (error instanceof APIError && error.status === 429)
      throw new Error(
        "OpenAI-Kontingent oder Anfragelimit erreicht. Später bewusst erneut starten.",
      );
    throw new Error(
      "OpenAI-Bilderzeugung fehlgeschlagen. Ausgang kann unklar sein; vor erneutem Start Nutzung prüfen.",
    );
  }
}
