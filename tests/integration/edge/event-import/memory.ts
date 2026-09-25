import { parseImportCsv } from "../../../../supabase/functions/_shared/eventImportCsv.ts";
import { createImportRowValidator } from "../../../../supabase/functions/_shared/eventImportValidation.ts";
const before = Deno.memoryUsage(), start = performance.now();
const head =
  "title,description,category,start_date,start_time,end_date,end_time,venue_name,address,city,postal_code,notes";
const rows = Array.from(
  { length: 500 },
  (_, n) =>
    `Event ${n},${
      "Description ".repeat(250)
    },community,2027-06-01,12:00,2027-06-01,14:00,Civic Hall,1 Market St,San Francisco,94105,${
      "x".repeat(500)
    }`,
);
const source = head + "\n" + rows.join("\n") + "\n";
const bytes = new TextEncoder().encode(
  source + "\n".repeat(2097152 - new TextEncoder().encode(source).length),
);
const validate = createImportRowValidator(Date.parse("2026-09-24"));
const parsed = parseImportCsv(bytes).rows.map((r) => validate(r.cells));
if (parsed.length !== 500 || parsed.some((r) => r.errors.length)) {
  throw Error("Fixture invalid");
}
console.log(
  JSON.stringify({
    rows: parsed.length,
    bytes: bytes.length,
    elapsedMs: performance.now() - start,
    before,
    after: Deno.memoryUsage(),
    provider: "none",
  }),
);
