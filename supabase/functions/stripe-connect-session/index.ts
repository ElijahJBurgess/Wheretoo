import type Stripe from "stripe";
import { requireOrganizer } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/database.ts";
import { getAppBaseUrl } from "../_shared/env.ts";
import { HttpError, jsonResponse } from "../_shared/http.ts";
import { getStripe, rejectLiveStripeObject } from "../_shared/stripeClient.ts";
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
  validateCreatedAccount,
} from "./connect.ts";

const ACCOUNT_SESSION_COMPONENTS = {
  account_management: { enabled: true },
  account_onboarding: { enabled: true },
  notification_banner: { enabled: true },
} satisfies Stripe.AccountSessionCreateParams["components"];

const RECIPIENT_ACCOUNT_PARAMS = (
  organizerId: string,
  contactEmail: string,
): Stripe.V2.Core.AccountCreateParams => ({
  configuration: {
    recipient: {
      capabilities: {
        stripe_balance: { stripe_transfers: { requested: true } },
      },
    },
  },
  contact_email: contactEmail,
  dashboard: "express",
  defaults: {
    currency: "usd",
    responsibilities: {
      fees_collector: "application",
      losses_collector: "application",
    },
  },
  identity: { country: "US" },
  include: ACCOUNT_INCLUDE,
  metadata: { whereto_organizer_id: organizerId },
});

export interface StripeConnectSessionDependencies extends AccountRepository {
  appOrigin: string;
  requireOrganizer: RequireOrganizer;
  getContactEmail(userId: string): Promise<string>;
  createAccount(
    params: Stripe.V2.Core.AccountCreateParams,
    options: Stripe.RequestOptions,
  ): Promise<Stripe.V2.Core.Account>;
  retrieveAccount(
    accountId: string,
    params: Stripe.V2.Core.AccountRetrieveParams,
  ): Promise<Stripe.V2.Core.Account>;
  createAccountSession(
    params: Stripe.AccountSessionCreateParams,
  ): Promise<
    Pick<Stripe.AccountSession, "account" | "client_secret" | "livemode">
  >;
}

function defaultDependencies(): StripeConnectSessionDependencies {
  const repository = createAccountRepository();
  return {
    ...repository,
    appOrigin: getAppBaseUrl(),
    requireOrganizer,
    async getContactEmail(userId) {
      const { data, error } = await getServiceClient().auth.admin.getUserById(
        userId,
      );
      const email = data.user?.email;
      if (
        error !== null ||
        typeof email !== "string" ||
        email.length === 0 ||
        email !== email.trim()
      ) {
        throw new HttpError(500, "INTERNAL_ERROR");
      }
      return email;
    },
    createAccount: (params, options) =>
      getStripe().v2.core.accounts.create(params, options),
    retrieveAccount: (accountId, params) =>
      getStripe().v2.core.accounts.retrieve(accountId, params),
    createAccountSession: (params) =>
      getStripe().accountSessions.create(params),
  };
}

export function createStripeConnectSessionHandler(
  dependencies: StripeConnectSessionDependencies,
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
      let accountId = await dependencies.findAccount(organizer.organizerId);

      if (accountId === null) {
        const contactEmail = await dependencies.getContactEmail(
          organizer.userId,
        );
        const created = await stripeRequest(() =>
          dependencies.createAccount(
            RECIPIENT_ACCOUNT_PARAMS(
              organizer.organizerId,
              contactEmail,
            ),
            {
              idempotencyKey:
                `whereto-connect-account-v1:${organizer.organizerId}`,
            },
          )
        );
        accountId = validateCreatedAccount(created);
        accountId = await dependencies.insertAccount({
          organizerId: organizer.organizerId,
          stripeAccountId: accountId,
        });
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

      const session = await stripeRequest(() =>
        dependencies.createAccountSession({
          account: accountId,
          components: ACCOUNT_SESSION_COMPONENTS,
        })
      );
      rejectLiveStripeObject(session);
      if (
        session.account !== accountId ||
        typeof session.client_secret !== "string" ||
        session.client_secret.length === 0
      ) {
        throw new HttpError(502, "STRIPE_REQUEST_FAILED");
      }

      return jsonResponse(
        {
          client_secret: session.client_secret,
          connect_status: toSafeConnectStatus(projection, persistence.syncedAt),
        },
        200,
        headers,
      );
    } catch (error) {
      return safeErrorResponse(error, headers);
    }
  };
}

export function handler(request: Request): Promise<Response> {
  return createStripeConnectSessionHandler(defaultDependencies())(request);
}

if (import.meta.main) Deno.serve(handler);
