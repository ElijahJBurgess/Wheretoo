import type Stripe from "stripe";
import { requireOrganizer } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { getAppBaseUrl } from "../_shared/env.ts";
import { HttpError, jsonResponse } from "../_shared/http.ts";
import { getStripe } from "../_shared/stripeClient.ts";
import { safeErrorResponse } from "../_shared/stripeErrors.ts";
import {
  ACCOUNT_INCLUDE,
  type AccountRepository,
  createAccountRepository,
  readEmptyRequest,
  type RequireOrganizer,
  stripeRequest,
  validateApprovedConnectAccount,
} from "../stripe-connect-session/connect.ts";

export interface StripeExpressLoginDependencies
  extends Pick<AccountRepository, "findAccount"> {
  appOrigin: string;
  requireOrganizer: RequireOrganizer;
  retrieveAccount(
    accountId: string,
    params: Stripe.V2.Core.AccountRetrieveParams,
  ): Promise<Stripe.V2.Core.Account>;
  createLoginLink(accountId: string): Promise<Stripe.LoginLink>;
}

function defaultDependencies(): StripeExpressLoginDependencies {
  const repository = createAccountRepository();
  return {
    ...repository,
    appOrigin: getAppBaseUrl(),
    requireOrganizer,
    retrieveAccount: (accountId, params) =>
      getStripe().v2.core.accounts.retrieve(accountId, params),
    createLoginLink: (accountId) =>
      getStripe().accounts.createLoginLink(accountId),
  };
}

export function createStripeExpressLoginHandler(
  dependencies: StripeExpressLoginDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const preflight = handleCorsPreflight(request, dependencies.appOrigin);
    if (preflight !== null) return preflight;
    const headers = getCorsHeaders(request, dependencies.appOrigin);

    try {
      if (!headers.has("access-control-allow-origin")) {
        throw new HttpError(403, "CORS_ORIGIN_DENIED");
      }
      await readEmptyRequest(request);
      const organizer = await dependencies.requireOrganizer(request);
      const accountId = await dependencies.findAccount(organizer.organizerId);
      if (accountId === null) throw new HttpError(409, "INVALID_REQUEST");

      const account = await stripeRequest(() =>
        dependencies.retrieveAccount(accountId, { include: ACCOUNT_INCLUDE })
      );
      validateApprovedConnectAccount(account);

      const loginLink = await stripeRequest(() =>
        dependencies.createLoginLink(accountId)
      );
      let url: URL;
      try {
        url = new URL(loginLink.url);
      } catch {
        throw new HttpError(502, "STRIPE_REQUEST_FAILED");
      }
      if (url.protocol !== "https:") {
        throw new HttpError(502, "STRIPE_REQUEST_FAILED");
      }

      return jsonResponse({ url: loginLink.url }, 200, headers);
    } catch (error) {
      return safeErrorResponse(error, headers);
    }
  };
}

export function handler(request: Request): Promise<Response> {
  return createStripeExpressLoginHandler(defaultDependencies())(request);
}

if (import.meta.main) Deno.serve(handler);
