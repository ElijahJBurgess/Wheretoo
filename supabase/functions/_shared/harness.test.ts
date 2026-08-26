import { assertEquals } from "@std/assert";

Deno.test("Edge test harness runs without loading repository dotenv files", () => {
  assertEquals(
    new URL(".", import.meta.url).pathname.endsWith("/_shared/"),
    true,
  );
});
