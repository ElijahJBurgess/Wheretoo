import { getServiceClient } from "../_shared/database.ts";
import { createWaitlistWorkerHandler } from "../_shared/waitlistWorkerHttp.ts";
export const handler = createWaitlistWorkerHandler("observer", {
  readEnv: (name) => Deno.env.get(name),
  now: Date.now,
  fetch: (...args) => fetch(...args),
  rpc: async (name, args = {}) => {
    const { data, error } = await getServiceClient().rpc(name, args);
    if (error) throw Error("Unavailable");
    return data;
  },
});
if (import.meta.main) Deno.serve(handler);
