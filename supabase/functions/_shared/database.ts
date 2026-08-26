import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceConfig } from "./env.ts";

let serviceClient: SupabaseClient | undefined;

export function getServiceClient(): SupabaseClient {
  if (serviceClient !== undefined) return serviceClient;

  const { url, serviceRoleKey } = getSupabaseServiceConfig();
  serviceClient = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  return serviceClient;
}
