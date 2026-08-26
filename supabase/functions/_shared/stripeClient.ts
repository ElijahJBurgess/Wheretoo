import Stripe from "stripe";
import { getStripeRestrictedKey } from "./env.ts";
import { HttpError } from "./http.ts";

export const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;

let stripeClient: Stripe | undefined;

export function getStripe(): Stripe {
  if (stripeClient !== undefined) return stripeClient;

  stripeClient = new Stripe(getStripeRestrictedKey(), {
    apiVersion: STRIPE_API_VERSION,
  });
  return stripeClient;
}

export function rejectLiveStripeObject<T extends object>(object: T): T {
  const livemode = "livemode" in object ? object.livemode : undefined;
  if (livemode !== false) throw new HttpError(502, "UNSAFE_STRIPE_MODE");
  return object;
}
