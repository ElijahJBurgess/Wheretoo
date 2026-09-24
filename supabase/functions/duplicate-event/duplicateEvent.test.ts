import { assertEquals, assertRejects } from "@std/assert";
import { duplicateEvent, DuplicateError, type DuplicatePorts } from "./duplicateEvent.ts";
const source = "dd000000-0000-4000-8000-000000000010";
const owner = "dd000000-0000-4000-8000-000000000001";
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"), c => c.charCodeAt(0));
function fixture(image = true) {
  const calls: string[] = [];
  let staged: Record<string, unknown> = {};
  const ports: DuplicatePorts = {
    context: () => Promise.resolve({ fingerprint: "a".repeat(64), image: image ? { id: source, path: `${source}/cover.png` } : null }),
    read: () => Promise.resolve(new Blob([png], { type: "image/png" })),
    stage: (_path, _bytes, _mime, metadata) => { calls.push("stage"); staged = metadata; return Promise.resolve(); },
    finalize: (args) => { calls.push("commit"); return Promise.resolve(args.p_new_event_id); },
    remove: () => { calls.push("remove"); return Promise.resolve(); },
  };
  return { ports, calls, metadata: () => staged };
}
Deno.test("coverless duplication commits once and never touches Storage", async () => {
  const f = fixture(false);
  await duplicateEvent(f.ports, source, owner);
  assertEquals(f.calls, ["commit"]);
});
Deno.test("unknown commit transport failure never removes the potentially committed cover", async () => {
  const f = fixture();
  f.ports.finalize = () => { throw new Error("response lost"); };
  await assertRejects(() => duplicateEvent(f.ports, source, owner), DuplicateError, "DUPLICATE_OUTCOME_UNKNOWN");
  assertEquals(f.calls, ["stage"]);
});
Deno.test("definitive source conflict cleans only new staged object", async () => {
  const f = fixture();
  f.ports.finalize = () => { throw new DuplicateError("DUPLICATE_SOURCE_CHANGED", 409); };
  await assertRejects(() => duplicateEvent(f.ports, source, owner), DuplicateError, "DUPLICATE_SOURCE_CHANGED");
  assertEquals(f.calls, ["stage", "remove"]);
});
Deno.test("copied pixels receive fresh technical metadata without candidate/generation metadata", async () => {
  const f = fixture();
  await duplicateEvent(f.ports, source, owner);
  assertEquals(f.calls, ["stage", "commit"]);
  assertEquals(Object.keys(f.metadata()).sort(), ["cover_revision", "cover_staged", "digest", "duplicate_fingerprint", "duplicate_image", "duplicate_source", "organizer_id"].sort());
});
Deno.test("invalid bytes or MIME never create a draft", async () => {
  for (const blob of [new Blob(["bad"], { type: "image/png" }), new Blob([png], { type: "text/html" }), new Blob([new Uint8Array(5242881)], {type:"image/png"})]) {
    const f = fixture(); f.ports.read = () => Promise.resolve(blob);
    await assertRejects(() => duplicateEvent(f.ports, source, owner), DuplicateError, "DUPLICATE_FLYER_UNAVAILABLE");
    assertEquals(f.calls, []);
  }
});
Deno.test("unexpected success ID is unknown and cannot trigger cleanup", async () => {
  const f = fixture(); f.ports.finalize = () => Promise.resolve(source);
  await assertRejects(() => duplicateEvent(f.ports, source, owner), DuplicateError, "DUPLICATE_OUTCOME_UNKNOWN");
  assertEquals(f.calls, ["stage"]);
});
Deno.test("source conflict during staging retains source-changed recovery", async () => {
  const f = fixture();
  f.ports.stage = () => { throw new DuplicateError('DUPLICATE_SOURCE_CHANGED'); };
  await assertRejects(() => duplicateEvent(f.ports, source, owner), DuplicateError, 'DUPLICATE_SOURCE_CHANGED');
  assertEquals(f.calls, ['remove']);
});
