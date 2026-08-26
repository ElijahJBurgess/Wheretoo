import Stripe from "stripe";
import { getStripeRestrictedKey } from "./env.ts";
import { HttpError } from "./http.ts";

export const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;
export const STRIPE_REQUEST_TIMEOUT_MS = 80_000;
export const STRIPE_MAX_NETWORK_RETRIES = 2;
export const STRIPE_REQUEST_ATTEMPT_ENVELOPE_SECONDS =
  (STRIPE_REQUEST_TIMEOUT_MS / 1_000) * (STRIPE_MAX_NETWORK_RETRIES + 1);

let stripeClient: Stripe | undefined;

export function getStripe(): Stripe {
  if (stripeClient !== undefined) return stripeClient;

  stripeClient = new Stripe(getStripeRestrictedKey(), {
    apiVersion: STRIPE_API_VERSION,
    timeout: STRIPE_REQUEST_TIMEOUT_MS,
    maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
  });
  return stripeClient;
}

export function rejectLiveStripeObject<T extends object>(object: T): T {
  const livemode = "livemode" in object ? object.livemode : undefined;
  if (livemode !== false) throw new HttpError(502, "UNSAFE_STRIPE_MODE");
  return object;
}
