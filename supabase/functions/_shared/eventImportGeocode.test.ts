import { assertEquals } from "@std/assert";
import { geocodeImportAddress } from "./eventImportGeocode.ts";
const input = {
  address: "1 Market St",
  city: "San Francisco",
  postal_code: "94105",
};
export const strongFeature = () => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [-122.3958, 37.7936] },
  properties: {
    mapbox_id: "fixture-address",
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
      country: "inferred",
    },
    context: {
      address: { name: "1 Market St" },
      place: { name: "San Francisco" },
      postcode: { name: "94105" },
      region: { region_code: "CA" },
      country: { country_code: "US" },
    },
  },
});
Deno.test("geocode requires a unique strong supported address and requests permanent storage", async () => {
  let requestUrl = "";
  const run = (features: unknown[]) =>
    geocodeImportAddress(input, {
      token: "synthetic",
      fetch: async (u) => {
        requestUrl = String(u);
        return Response.json({ features });
      },
    });
  assertEquals((await run([strongFeature()])).kind, "verified");
  assertEquals(new URL(requestUrl).searchParams.get("permanent"), "true");
  assertEquals(
    new URL(requestUrl).searchParams.get("address_line1"),
    "1 Market St",
  );
  assertEquals(
    (await run([strongFeature(), {
      ...strongFeature(),
      properties: { ...strongFeature().properties, mapbox_id: "different" },
    }])).kind,
    "needs_review",
  );
  const outside = strongFeature();
  outside.geometry.coordinates = [-118, 34];
  outside.properties.coordinates.longitude = -118;
  outside.properties.coordinates.latitude = 34;
  assertEquals((await run([outside])).kind, "invalid");
  const weak = strongFeature();
  weak.properties.match_code.confidence = "medium";
  assertEquals((await run([weak])).kind, "needs_review");
  assertEquals((await run([])).kind, "needs_review");
});
Deno.test("provider failures are retryable or global configuration pauses, not invalid addresses", async () => {
  for (const status of [429, 500, 503]) {
    assertEquals(
      (await geocodeImportAddress(input, {
        token: "synthetic",
        fetch: () => Promise.resolve(new Response("", { status })),
      })).kind,
      "retryable",
    );
  }
  assertEquals(
    (await geocodeImportAddress(input, {
      token: "synthetic",
      fetch: () => Promise.resolve(new Response("", { status: 403 })),
    })).kind,
    "configuration_error",
  );
  assertEquals(
    (await geocodeImportAddress(input, {
      token: "synthetic",
      fetch: () => Promise.reject(Error("timeout")),
    })).kind,
    "retryable",
  );
});
Deno.test("unverified secondary address cannot silently become a parent address", async () => {
  const r = await geocodeImportAddress({
    address: "1 Market St Suite 999",
    city: "San Francisco",
    postal_code: "94105",
  }, {
    token: "synthetic",
    fetch: () =>
      Promise.resolve(Response.json({ features: [strongFeature()] })),
  });
  assertEquals(r.kind, "needs_review");
});

Deno.test("provider secondary-address evidence cannot be discarded", async () => {
  const f = strongFeature();
  const response = {
    ...f,
    properties: {
      ...f.properties,
      match_code: {
        ...f.properties.match_code,
        secondary_address: "unmatched",
      },
    },
  };
  const r = await geocodeImportAddress(
    { ...input, address: "1 Market St, 5B" },
    {
      token: "synthetic",
      fetch: async () => Response.json({ features: [response] }),
    },
  );
  assertEquals(r.kind, "needs_review");
});
