type EnvReader = (name: string) => string | undefined;

const defaultEnvReader: EnvReader = (name) => Deno.env.get(name);

function requireEnv(name: string, read: EnvReader = defaultEnvReader): string {
  const value = read(name);
  if (value === undefined || value.length === 0 || value !== value.trim()) {
    throw new Error(`Missing or invalid server environment value: ${name}`);
  }
  return value;
}

export function getModerationWorkerToken(
  read: EnvReader = defaultEnvReader,
): string {
  const value = requireEnv("MODERATION_WORKER_TOKEN", read);
  if (value.length < 32 || value.length > 256) {
    throw new Error("Moderation worker token is invalid");
  }
  return value;
}

export function getReportFingerprintSecret(
  read: EnvReader = defaultEnvReader,
): string {
  const value = requireEnv("REPORT_FINGERPRINT_SECRET", read);
  if (value.length < 32 || value.length > 256) {
    throw new Error("Report fingerprint secret is invalid");
  }
  return value;
}

export function getContextualModerationConfig(
  read: EnvReader = defaultEnvReader,
): { endpoint: string; bearerToken: string | null } | null {
  const endpoint = read("CONTEXTUAL_MODERATION_ENDPOINT");
  const bearerToken = read("CONTEXTUAL_MODERATION_BEARER_TOKEN");
  if (endpoint === undefined || endpoint.length === 0) {
    if (bearerToken !== undefined && bearerToken.length > 0) {
      throw new Error(
        "Contextual moderator endpoint is required with its token",
      );
    }
    return null;
  }
  if (endpoint !== endpoint.trim()) {
    throw new Error("Contextual moderator endpoint is invalid");
  }
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Contextual moderator endpoint must be HTTPS");
  }
  if (
    bearerToken !== undefined && (
      bearerToken.length === 0 || bearerToken !== bearerToken.trim() ||
      bearerToken.length > 512
    )
  ) {
    throw new Error("Contextual moderator token is invalid");
  }
  return { endpoint: parsed.toString(), bearerToken: bearerToken ?? null };
}

export function validateStripeRestrictedKey(value: string | undefined): string {
  if (value === undefined || !/^rk_test_[A-Za-z0-9]+$/.test(value)) {
    throw new Error("Stripe server credentials must be a restricted test key");
  }
  return value;
}

export function getStripeRestrictedKey(
  read: EnvReader = defaultEnvReader,
): string {
  return validateStripeRestrictedKey(read("STRIPE_RESTRICTED_KEY"));
}

export function getStripeWebhookSecret(
  read: EnvReader = defaultEnvReader,
): string {
  const value = requireEnv("STRIPE_WEBHOOK_SECRET", read);
  if (!/^whsec_[A-Za-z0-9]+$/.test(value)) {
    throw new Error("Stripe webhook credentials are invalid");
  }
  return value;
}

export function getStripeWebhookSecrets(
  read: EnvReader = defaultEnvReader,
): string[] {
  const snapshot = getStripeWebhookSecret(read);
  const thin = read("STRIPE_THIN_WEBHOOK_SECRET");
  if (thin === undefined) return [snapshot];
  if (!/^whsec_[A-Za-z0-9]+$/.test(thin)) {
    throw new Error("Stripe thin-event webhook credentials are invalid");
  }
  return thin === snapshot ? [snapshot] : [snapshot, thin];
}

export function getSupabaseServiceConfig(read: EnvReader = defaultEnvReader): {
  url: string;
  serviceRoleKey: string;
} {
  const url = requireEnv("SUPABASE_URL", read);
  const parsed = new URL(url);
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("Supabase server URL is invalid");
  }

  return {
    url,
    serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY", read),
  };
}

export function getAppBaseUrl(read: EnvReader = defaultEnvReader): string {
  const value = requireEnv("APP_BASE_URL", read);
  const parsed = new URL(value);
  if (
    !["https:", "http:"].includes(parsed.protocol) || parsed.origin !== value
  ) {
    throw new Error("Application base URL must be an exact origin");
  }
  return value;
}
