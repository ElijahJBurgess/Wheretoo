import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  CoverError,
  coverRevision,
  mutateEventCover,
} from "./coverMutation.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
Deno.test("revision requires an explicit nonnegative safe integer", () => {
  assertEquals(coverRevision("0"), 0);
  assertEquals(coverRevision("14"), 14);
  for (const value of [null, "", "-1", "1.5", "1e2", "9007199254740992"]) {
    assertThrows(() => coverRevision(value), CoverError);
  }
});
Deno.test("invalid operation is rejected before any mutation", async () => {
  let calls = 0;
  const client = {
    rpc: () => {
      calls++;
      throw new Error("unexpected");
    },
  } as unknown as SupabaseClient;
  for (
    const value of [
      "null",
      "[]",
      '{"remove":true,"extra":true}',
      '{"generationId":"bad","slot":1}',
    ]
  ) {
    await assertRejects(
      () =>
        mutateEventCover(
          client,
          new Request("http://localhost", {
            method: "PUT",
            headers: { "x-cover-revision": "0" },
            body: value,
          }),
          "event",
          "owner",
        ),
      CoverError,
    );
  }
  assertEquals(calls, 0);
});
Deno.test("chunked JSON is bounded without relying on Content-Length", async () => {
  const request = new Request("http://localhost", {
    method: "PUT",
    headers: { "x-cover-revision": "0" },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1025));
        controller.close();
      },
    }),
  });
  await assertRejects(
    () => mutateEventCover({} as SupabaseClient, request, "event", "owner"),
    CoverError,
    "BODY_TOO_LARGE",
  );
});
