// No network permission. Exercise the production parser, row validator and provider adapter.
import { parseImportCsv } from "../../../../supabase/functions/_shared/eventImportCsv.ts";
import { createImportRowValidator } from "../../../../supabase/functions/_shared/eventImportValidation.ts";
import { geocodeImportAddress } from "../../../../supabase/functions/_shared/eventImportGeocode.ts";
const base = ".superpowers/sdd/2026-09-24-csv-event-import-v1/";
const source = JSON.parse(
  await Deno.readTextFile(base + "scale-input.json"),
) as { input: Record<string, string | number | null> }[];
const headers = [
  "title",
  "description",
  "category",
  "start_date",
  "start_time",
  "end_date",
  "end_time",
  "venue_name",
  "address",
  "city",
  "postal_code",
  "capacity",
  "source_url",
  "source_name",
  "notes",
];
const escape = (value: unknown) =>
  '"' + String(value ?? "").replaceAll('"', '""') + '"';
const csv = headers.join(",") + "\n" +
  source.map((r) => headers.map((h) => escape(r.input[h])).join(",")).join(
    "\n",
  );
const validate = createImportRowValidator(Date.now()),
  rows = parseImportCsv(new TextEncoder().encode(csv)).rows.map((r) => ({
    recordNumber: r.recordNumber,
    startLine: r.startLine,
    ...validate(r.cells),
  }));
let fetches = 0;
async function geocode(n: number, retry = false) {
  return await geocodeImportAddress({
    address: String(source[n].input.address),
    city: String(source[n].input.city),
    postal_code: String(source[n].input.postal_code),
  }, {
    token: "synthetic",
    fetch: async (url) => {
      fetches++;
      const request = new URL(url);
      if (
        request.hostname !== "api.mapbox.com" ||
        request.searchParams.get("permanent") !== "true"
      ) throw Error("Unexpected provider contract");
      if (n >= 475 && !retry) {
        return new Response("", {
          status: 503,
          headers: { "Retry-After": "3600" },
        });
      }
      const feature = {
        geometry: { type: "Point", coordinates: [-122.3958, 37.7936] },
        properties: {
          mapbox_id: "import.fixture.0",
          feature_type: "address",
          coordinates: {
            longitude: -122.3958,
            latitude: 37.7936,
            accuracy: "rooftop",
          },
          match_code: {
            confidence: "exact",
            address_number: "matched",
            street: "matched",
            postcode: "matched",
            place: "matched",
            region: "matched",
            country: "matched",
          },
          context: {
            address: { name: "1 Market St" },
            place: { name: "San Francisco" },
            postcode: { name: "94105" },
            region: { region_code: "CA" },
            country: { country_code: "US" },
          },
        },
      };
      return Response.json({
        features: n >= 450 && n < 475
          ? [feature, {
            ...feature,
            properties: { ...feature.properties, mapbox_id: "ambiguous.other" },
          }]
          : [feature],
      });
    },
  });
}
const initial: unknown[] = [];
for (let n = 0; n < 500; n++) {
  initial.push(rows[n].errors.length ? null : await geocode(n));
}
const retried = [];
for (let n = 475; n < 500; n++) retried.push(await geocode(n, true));
if (rows.filter((r) => r.errors.length).length !== 50 || fetches !== 475) {
  throw Error("Scale matrix differs");
}
await Deno.writeTextFile(
  base + "scale-transport.json",
  JSON.stringify({
    rows,
    initial,
    retried,
    fetches,
    csvBytes: new TextEncoder().encode(csv).length,
  }),
);
console.log(
  "500 rows parsed/validated; 475 injected production-adapter calls; zero network capability",
);
