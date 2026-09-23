import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  buildCoverPrompt,
  generateCover,
  MODEL,
  ProviderError,
} from "./provider.ts";
const context = {
  title: "Midnight jazz",
  description: "Live acoustic music",
  category: "music",
  city: "Oakland",
  venue: "Hall",
  timeOfDay: "evening",
};
Deno.test("three distinct bounded cover prompts use saved event context without flyer instructions", () => {
  const prompts = [1, 2, 3].map((slot) =>
    buildCoverPrompt(
      context,
      { mood: "Editorial", direction: "Deep blue" },
      slot,
    )
  );
  assertEquals(new Set(prompts).size, 3);
  for (const p of prompts) {
    assert(p.includes("Midnight jazz"));
    assert(p.includes("4:5"));
    assert(p.includes("No text"));
    assert(p.includes("Deep blue"));
  }
});
Deno.test("provider sends fixed one-image native 4:5 request and sanitizes failures", async () => {
  let body: Record<string, unknown> = {};
  await assertRejects(
    () =>
      generateCover("prompt", "local-test-key", async (_url, options) => {
        body = JSON.parse(String(options?.body));
        return Response.json({
          error: { code: "moderation_blocked", message: "sensitive prompt" },
        }, { status: 400 });
      }),
    ProviderError,
    "CONTENT_BLOCKED",
  );
  assertEquals(body.model, MODEL);
  assertEquals(body.n, 1);
  assertEquals(body.size, "1024x1280");
  assertEquals(body.quality, "medium");
  assertEquals(body.output_format, "png");
  assertEquals(body.response_format, undefined);
});
Deno.test("reject malformed provider image and oversized response", async () => {
  await assertRejects(
    () =>
      generateCover(
        "prompt",
        "local",
        async () =>
          Response.json({ data: [{ b64_json: btoa("not an image") }] }),
      ),
    ProviderError,
    "INVALID_PROVIDER_IMAGE",
  );
  await assertRejects(
    () =>
      generateCover(
        "prompt",
        "local",
        async () =>
          new Response("x", { headers: { "content-length": "9000000" } }),
      ),
    ProviderError,
    "INVALID_PROVIDER_IMAGE",
  );
});
Deno.test("provider abort timeout becomes an explicit retryable failure", async () => {
  await assertRejects(
    () =>
      generateCover(
        "prompt",
        "local",
        async (_url, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
            );
          }),
        5,
      ),
    ProviderError,
    "PROVIDER_TIMEOUT",
  );
});

import { existingCandidate } from "./candidateStorage.ts";
Deno.test("Storage outage never looks like a missing candidate", async () => {
  await assertRejects(
    () =>
      existingCandidate(async () => ({
        data: null,
        error: { status: 503, statusCode: "503" },
      })),
    ProviderError,
    "STORAGE_FAILED",
  );
  assertEquals(
    await existingCandidate(async () => ({
      data: null,
      error: { status: 400, statusCode: "404" },
    })),
    null,
  );
});

import { deflateSync } from "node:zlib";
function pngFixture(width = 1024, height = 1280): Uint8Array {
  function chunk(name: string, content: Uint8Array): Uint8Array {
    const result = new Uint8Array(content.length + 12),
      view = new DataView(result.buffer);
    view.setUint32(0, content.length);
    result.set(new TextEncoder().encode(name), 4);
    result.set(content, 8);
    let crc = 0xffffffff;
    for (const byte of result.subarray(4, result.length - 4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
    }
    view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
    return result;
  }
  const header = new Uint8Array(13), v = new DataView(header.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const chunks = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(new Uint8Array((width * 3 + 1) * height))),
    chunk("IEND", new Uint8Array()),
  ];
  const result = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    result.set(c, at);
    at += c.length;
  }
  return result;
}
Deno.test("successful OpenAI base64 response decodes validated 4:5 bytes", async () => {
  const fixture = pngFixture();
  const encoded = btoa(String.fromCharCode(...fixture));
  const result = await generateCover(
    "prompt",
    "local",
    async () =>
      Response.json({
        data: [{ b64_json: encoded }],
        usage: { input_tokens: 100, output_tokens: 1000 },
      }),
  );
  assertEquals(result, fixture);
  assertEquals(
    await existingCandidate(async () => ({
      data: new Blob([new Uint8Array(fixture)]),
      error: null,
    })),
    fixture,
  );
});
Deno.test("wrong aspect ratio is rejected even with a valid PNG container", async () => {
  const fixture = pngFixture(1024, 1024);
  await assertRejects(
    () =>
      generateCover("prompt", "local", async () =>
        Response.json({
          data: [{ b64_json: btoa(String.fromCharCode(...fixture)) }],
        })),
    ProviderError,
    "INVALID_PROVIDER_IMAGE",
  );
});
Deno.test("upstream quota and rate-limit failures have safe distinct codes", async () => {
  await assertRejects(
    () =>
      generateCover("prompt", "local", async () =>
        Response.json({
          error: { code: "insufficient_quota", message: "billing secret" },
        }, { status: 429 })),
    ProviderError,
    "PROVIDER_UNAVAILABLE",
  );
  await assertRejects(
    () =>
      generateCover(
        "prompt",
        "local",
        async () =>
          Response.json({ error: { code: "rate_limit_exceeded" } }, {
            status: 429,
          }),
      ),
    ProviderError,
    "PROVIDER_RATE_LIMIT",
  );
});
