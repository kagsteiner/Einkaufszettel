import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { generateStudioImage } from "../scripts/studio-openai.ts";

test("studio uses generate or edit with references and explicit model/quality; never retries paid requests", async () => {
  const requests: Array<{ url: string; body: string }> = [];
  const client = new OpenAI({
    apiKey: "test-key",
    maxRetries: 0,
    fetch: async (url, init) => {
      if (String(url).includes("/images/"))
        requests.push({
          url: String(url),
          body:
            init?.body instanceof FormData ? String(init.body.get("model")) : String(init?.body),
        });
      return new Response(JSON.stringify({ data: [{ b64_json: "aW1hZ2U=" }] }), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const options = {
    prompt: "Butter",
    model: "gpt-image-1.5",
    quality: "medium" as const,
    references: [] as Buffer[],
  };
  assert.equal(await generateStudioImage(options, client), "aW1hZ2U=");
  assert.match(requests[0]?.url ?? "", /images\/generations$/);
  assert.equal(JSON.parse(requests[0]?.body ?? "{}").size, "1024x1024");
  await generateStudioImage({ ...options, references: [Buffer.from("reference")] }, client);
  assert.match(requests[1]?.url ?? "", /images\/edits$/);
  let attempts = 0;
  const failing = new OpenAI({
    apiKey: "test-key",
    maxRetries: 0,
    fetch: async () => {
      attempts++;
      return new Response(
        JSON.stringify({ error: { message: "private provider text test-key" } }),
        { status: 429, headers: { "content-type": "application/json" } },
      );
    },
  });
  await assert.rejects(
    generateStudioImage(options, failing),
    (error: Error) => !error.message.includes("test-key") && /Kontingent/.test(error.message),
  );
  assert.equal(attempts, 1);
});
