// Injectable provider; the runtime network allowlist permits loopback only.
import { createImportHandler } from "../../../../supabase/functions/_shared/eventImportHttp.ts";
const f = JSON.parse(
  await Deno.readTextFile(".superpowers/event-import-proof/browser.json"),
);
if (f.api !== "http://127.0.0.1:60321" || f.edge !== "http://127.0.0.1:60330") {
  throw Error("Local only");
}
const attempts = new Map<string, number>();
const deps = {
  origin: f.origin,
  token: () => "synthetic-no-provider-token",
  auth: async (token: string) => {
    const r = await fetch(f.api + "/auth/v1/user", {
      headers: { apikey: f.anon, authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return (await r.json()).id as string;
  },
  rpc: async (name: string, args: Record<string, unknown>) => {
    const r = await fetch(f.api + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: {
        apikey: f.anon,
        authorization: `Bearer ${f.service}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
    });
    const text = await r.text();
    const b = text ? JSON.parse(text) : null;
    if (!r.ok) throw Error(b?.message ?? "Local RPC failed");
    return b;
  },
  fetch: async (url: string) => {
    const u = new URL(url), address = u.searchParams.get("address_line1")!;
    attempts.set(address, (attempts.get(address) ?? 0) + 1);
    if (
      address.includes("Retry") && attempts.get(address) === 1
    ) return new Response("", { status: 503 });
    const feature = {
      geometry: { type: "Point", coordinates: [-122.3958, 37.7936] },
      properties: {
        mapbox_id: "local." + address,
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
          address: { name: address },
          place: { name: "San Francisco" },
          postcode: { name: "94105" },
          region: { region_code: "CA" },
          country: { country_code: "US" },
        },
      },
    };
    return Response.json({
      features: address.includes("Ambiguous")
        ? [feature, {
          ...feature,
          properties: { ...feature.properties, mapbox_id: "local.second" },
        }]
        : [feature],
    });
  },
};
const upload = createImportHandler("upload", deps),
  process = createImportHandler("process", deps);
Deno.serve(
  { hostname: "127.0.0.1", port: 60330 },
  (req) =>
    new URL(req.url).pathname === "/health"
      ? new Response("local")
      : new URL(req.url).pathname.endsWith("/event-import-upload")
      ? upload(req)
      : process(req),
);
