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
  toSafeConnectStatus,
  validateApprovedConnectAccount,
} from "../stripe-connect-session/connect.ts";

export interface StripeConnectStatusDependencies extends
  Pick<
    AccountRepository,
    "findAccount" | "beginRefresh" | "persistStatus"
  > {
  appOrigin: string;
  requireOrganizer: RequireOrganizer;
  retrieveAccount(
    accountId: string,
    params: Stripe.V2.Core.AccountRetrieveParams,
  ): Promise<Stripe.V2.Core.Account>;
}

function defaultDependencies(): StripeConnectStatusDependencies {
  const repository = createAccountRepository();
  return {
    ...repository,
    appOrigin: getAppBaseUrl(),
    requireOrganizer,
    retrieveAccount: (accountId, params) =>
      getStripe().v2.core.accounts.retrieve(accountId, params),
  };
}

export function createStripeConnectStatusHandler(
  dependencies: StripeConnectStatusDependencies,
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
      if (accountId === null) {
        return jsonResponse({ status: "not_started" }, 200, headers);
      }

      const refreshSequence = await dependencies.beginRefresh(accountId);
      const account = await stripeRequest(() =>
        dependencies.retrieveAccount(accountId, { include: ACCOUNT_INCLUDE })
      );
      const projection = validateApprovedConnectAccount(account);
      const persistence = await dependencies.persistStatus(
        accountId,
        refreshSequence,
        projection,
      );
      if (persistence.outcome === "stale") {
        throw new HttpError(502, "STRIPE_REQUEST_FAILED");
      }

      return jsonResponse(
        toSafeConnectStatus(projection, persistence.syncedAt),
        200,
        headers,
      );
    } catch (error) {
      return safeErrorResponse(error, headers);
    }
  };
}

export function handler(request: Request): Promise<Response> {
  return createStripeConnectStatusHandler(defaultDependencies())(request);
}

if (import.meta.main) Deno.serve(handler);
