import { assertEquals, assertThrows } from "@std/assert";
import { parseImportCsv } from "./eventImportCsv.ts";
import { validateImportRow } from "./eventImportValidation.ts";
import { importWallTime } from "./eventImportTime.ts";
export const header =
  "title,description,category,start_date,start_time,end_date,end_time,venue_name,address,city,postal_code";
const row =
  'Community Day,"Meet neighbors, enjoy food, and music.",community,2027-06-01,12:00,2027-06-01,14:00,City Hall,1 Market St,San Francisco,94105';
const bytes = (s: string) => new TextEncoder().encode(s);
Deno.test("CSV preserves quoted commas, escaped quotes and physical multiline starts", () => {
  const r = parseImportCsv(
    bytes(
      "\ufeff" + header + "\r\n" + row + "\r\n" +
        row.replace("Community Day", '"A ""quoted""\nname"'),
    ),
  );
  assertEquals(r.rows.length, 2);
  assertEquals(r.rows[1].cells.title, 'A "quoted"\nname');
  assertEquals(r.rows[1].startLine, 3);
});
Deno.test("CSV fails whole file on invalid structure or authority headers", () => {
  for (
    const text of [
      header + ",title\n" + row + ",other",
      header + ",organizer_id\n" + row + ",x",
      header + "\n" + row + '\n"unterminated',
      header + "\n" + row + ",extra",
      header.replace("title", " title") + "\n" + row,
      header,
    ]
  ) assertThrows(() => parseImportCsv(bytes(text)));
  assertThrows(() => parseImportCsv(new Uint8Array([0xff])));
  assertThrows(() => parseImportCsv(bytes(header + "\n" + row + "\0")));
});
Deno.test("CSV bounds bytes and records and ignores wholly blank records", () => {
  assertEquals(
    parseImportCsv(bytes(header + "\n" + Array(500).fill(row).join("\n"))).rows
      .length,
    500,
  );
  assertThrows(() =>
    parseImportCsv(bytes(header + "\n" + Array(501).fill(row).join("\n")))
  );
  assertThrows(() => parseImportCsv(new Uint8Array(2097153)));
  assertEquals(
    parseImportCsv(bytes(header + "\n,,,,,,,,,,\n" + row)).rows[0].recordNumber,
    3,
  );
});
Deno.test("import rejects both DST anomalies and impossible calendar dates", () => {
  assertEquals(importWallTime("2026-11-01", "01:30"), null);
  assertEquals(importWallTime("2027-03-14", "02:30"), null);
  assertEquals(importWallTime("2026-02-29", "12:00"), null);
  assertEquals(
    importWallTime("2027-06-01", "12:00"),
    "2027-06-01T19:00:00.000Z",
  );
  assertEquals(
    importWallTime("2027-01-01", "12:00"),
    "2027-01-01T20:00:00.000Z",
  );
});
Deno.test("semantic validation preserves unlimited and rejects malformed capacities and categories", () => {
  const c = parseImportCsv(bytes(header + "\n" + row)).rows[0].cells;
  const now = Date.parse("2026-09-24T00:00:00Z");
  assertEquals(validateImportRow(c, now).errors, []);
  assertEquals(validateImportRow(c, now).input.capacity, null);
  for (const capacity of ["0", "-1", "1.2", "1e3", "2147483648"]) {
    assertEquals(
      validateImportRow({ ...c, capacity }, now).errors.some((e) =>
        e.field === "capacity"
      ),
      true,
    );
  }
  assertEquals(
    validateImportRow({ ...c, capacity: "2147483647" }, now).input.capacity,
    2147483647,
  );
  assertEquals(
    validateImportRow({ ...c, category: "unknown" }, now).errors.length,
    1,
  );
  assertEquals(
    validateImportRow(c, Date.parse("2028-01-01")).errors.length > 0,
    true,
  );
});

Deno.test("CSV reports actual physical starts after blank lines", () => {
  const r = parseImportCsv(bytes(header + "\n\n" + row + "\n\n" + row));
  assertEquals(r.rows.map((x) => x.startLine), [3, 5]);
});
Deno.test("exact 2 MiB CSV is accepted and one more byte rejected", () => {
  const source = header + "\n" + row + "\n";
  const padded = source + "\n".repeat(2097152 - bytes(source).length);
  assertEquals(parseImportCsv(bytes(padded)).rows.length, 1);
  assertThrows(() => parseImportCsv(bytes(padded + "\n")));
});
Deno.test("only one leading UTF-8 BOM is accepted", () => {
  assertThrows(() =>
    parseImportCsv(bytes("\ufeff\ufeff" + header + "\n" + row))
  );
});
