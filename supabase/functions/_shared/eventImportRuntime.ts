import { getServiceClient } from "./database.ts";
import { getAppBaseUrl } from "./env.ts";
import { createImportHandler } from "./eventImportHttp.ts";
export function importRuntime(mode: "upload" | "process") {
  return (request: Request) =>
    createImportHandler(mode, {
      origin: getAppBaseUrl(),
      auth: async (token) => {
        const { data, error } = await getServiceClient().auth.getUser(token);
        return error ? null : data.user?.id ?? null;
      },
      rpc: async (name, args) => {
        const { data, error } = await getServiceClient().rpc(name, args);
        if (error) throw Error(error.message);
        return data;
      },
      token: () => Deno.env.get("MAPBOX_GEOCODING_ACCESS_TOKEN") ?? "",
      fetch: (url, init) => fetch(url, init),
    })(request);
}
