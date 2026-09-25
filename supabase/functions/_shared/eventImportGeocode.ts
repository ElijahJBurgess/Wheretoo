import { z } from "zod";
export type ImportLocation = {
  mapbox_feature_id: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  region: "CA";
  postal_code: string;
  country_code: "US";
  latitude: number;
  longitude: number;
};
export type GeocodeOutcome = {
  kind: "verified";
  location: ImportLocation;
  evidence: { policy: 1; confidence: string; accuracy: string };
} | {
  kind: "needs_review" | "invalid" | "retryable" | "configuration_error";
  code: string;
  retryAfterSeconds?: number;
};
const feature = z.object({
  geometry: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([z.number().finite(), z.number().finite()]),
  }),
  properties: z.object({
    mapbox_id: z.string().min(1).max(500),
    feature_type: z.string(),
    coordinates: z.object({
      longitude: z.number().finite(),
      latitude: z.number().finite(),
      accuracy: z.string().optional(),
    }),
    match_code: z.record(z.string(), z.string()).optional(),
    context: z.object({
      address: z.object({ name: z.string().min(1).max(500) }).optional(),
      place: z.object({ name: z.string().min(1).max(120) }).optional(),
      postcode: z.object({ name: z.string().min(1).max(20) }).optional(),
      region: z.object({ region_code: z.string() }).optional(),
      country: z.object({ country_code: z.string() }).optional(),
    }),
  }),
});
export async function geocodeImportAddress(
  input: { address: string; city: string; postal_code: string },
  deps: {
    token: string;
    fetch: (url: string, init?: RequestInit) => Promise<Response>;
  },
): Promise<GeocodeOutcome> {
  // V1 does not independently verify secondary units; never discard one silently.
  if (
    /(?:\b(?:apt|apartment|unit|suite|ste|floor|fl)\b|#)/i.test(input.address)
  ) {
    return { kind: "needs_review", code: "SECONDARY_ADDRESS_NOT_VERIFIED" };
  }
  if (!deps.token) {
    return { kind: "configuration_error", code: "PROVIDER_NOT_CONFIGURED" };
  }
  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  for (
    const [k, v] of Object.entries({
      address_line1: input.address,
      place: input.city,
      postcode: input.postal_code,
      region: "CA",
      country: "US",
      autocomplete: "false",
      types: "address",
      limit: "5",
      permanent: "true",
      access_token: deps.token,
    })
  ) url.searchParams.set(k, v);
  try {
    const r = await deps.fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    if (r.status === 401 || r.status === 403) {
      return { kind: "configuration_error", code: "PROVIDER_AUTH" };
    }
    if (r.status === 429 || r.status >= 500) {
      return {
        kind: "retryable",
        code: "PROVIDER_UNAVAILABLE",
        retryAfterSeconds: Math.min(
          3600,
          Math.max(0, Number(r.headers.get("retry-after")) || 0),
        ),
      };
    }
    if (!r.ok) {
      return { kind: "needs_review", code: "PROVIDER_REJECTED_ADDRESS" };
    }
    const reader = r.body?.getReader();
    if (!reader) throw Error();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const c = await reader.read();
        if (c.done) break;
        size += c.value.length;
        if (size > 131072) {
          await reader.cancel();
          throw Error();
        }
        chunks.push(c.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    const json: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    const parsed = z.object({ features: z.array(feature).max(10) }).safeParse(
      json,
    );
    if (!parsed.success) {
      return { kind: "retryable", code: "PROVIDER_INVALID_RESPONSE" };
    }
    const features = [
      ...new Map(parsed.data.features.map((f) => [f.properties.mapbox_id, f]))
        .values(),
    ];
    if (features.length !== 1) {
      return { kind: "needs_review", code: "ADDRESS_AMBIGUOUS_OR_NOT_FOUND" };
    }
    const f = features[0], p = f.properties, c = p.context, m = p.match_code;
    if (
      c.country?.country_code !== "US" || c.region?.region_code !== "CA" ||
      p.coordinates.latitude < 36.8 || p.coordinates.latitude > 38.9 ||
      p.coordinates.longitude < -123.6 || p.coordinates.longitude > -121
    ) return { kind: "invalid", code: "OUTSIDE_SERVICE_AREA" };
    if (
      p.feature_type !== "address" ||
      (m?.secondary_address !== undefined &&
        m.secondary_address !== "not_applicable") ||
      !c.address || !c.place || !c.postcode ||
      !m || !["exact", "high"].includes(m.confidence) ||
      !["rooftop", "parcel", "point"].includes(p.coordinates.accuracy ?? "") ||
      ["address_number", "street", "postcode", "place", "region"].some((k) =>
        m[k] !== "matched"
      ) || !["matched", "inferred"].includes(m.country) ||
      f.geometry.coordinates[0] !== p.coordinates.longitude ||
      f.geometry.coordinates[1] !== p.coordinates.latitude ||
      c.postcode.name.slice(0, 5) !== input.postal_code.slice(0, 5)
    ) return { kind: "needs_review", code: "ADDRESS_NOT_VERIFIED" };
    return {
      kind: "verified",
      location: {
        mapbox_feature_id: p.mapbox_id,
        address_line1: c.address.name,
        address_line2: null,
        city: c.place.name,
        region: "CA",
        postal_code: c.postcode.name,
        country_code: "US",
        latitude: p.coordinates.latitude,
        longitude: p.coordinates.longitude,
      },
      evidence: {
        policy: 1,
        confidence: m.confidence,
        accuracy: p.coordinates.accuracy!,
      },
    };
  } catch {
    return { kind: "retryable", code: "PROVIDER_UNAVAILABLE" };
  }
}
