import type Stripe from "stripe";
import type {
  ConnectStatusProjection,
  OrganizerContext,
} from "../_shared/contracts.ts";
import { deriveConnectStatus } from "../_shared/connectState.ts";
import { getServiceClient } from "../_shared/database.ts";
import { HttpError, methodNotAllowed } from "../_shared/http.ts";
import { rejectLiveStripeObject } from "../_shared/stripeClient.ts";

export const ACCOUNT_INCLUDE = [
  "configuration.recipient",
  "defaults",
  "requirements",
] satisfies Stripe.V2.Core.AccountRetrieveParams["include"];

export interface SafeConnectStatus {
  status: "pending" | "action_required" | "restricted" | "ready";
  requirements_currently_due_count: number;
  requirements_past_due_count: number;
  last_status_code: string | null;
  last_synced_at: string;
}

export interface ConnectPersistenceResult {
  outcome: "updated" | "stale";
  syncedAt: string;
}

export interface AccountRepository {
  findAccount(organizerId: string): Promise<string | null>;
  insertAccount(record: {
    organizerId: string;
    stripeAccountId: string;
  }): Promise<string>;
  beginRefresh(accountId: string): Promise<number>;
  persistStatus(
    accountId: string,
    refreshSequence: number,
    projection: ConnectStatusProjection,
  ): Promise<ConnectPersistenceResult>;
}

export type RequireOrganizer = (
  request: Request,
) => Promise<OrganizerContext>;

function internalError(): never {
  throw new HttpError(500, "INTERNAL_ERROR");
}

export function createAccountRepository(
  client = getServiceClient(),
): AccountRepository {
  async function findAccount(organizerId: string): Promise<string | null> {
    const { data, error } = await client
      .from("organizer_stripe_accounts")
      .select("stripe_account_id")
      .eq("organizer_id", organizerId)
      .eq("livemode", false)
      .maybeSingle();

    if (error !== null) internalError();
    return data?.stripe_account_id ?? null;
  }

  return {
    findAccount,
    async insertAccount({ organizerId, stripeAccountId }) {
      const { data, error } = await client
        .from("organizer_stripe_accounts")
        .insert({
          organizer_id: organizerId,
          livemode: false,
          stripe_account_id: stripeAccountId,
        })
        .select("stripe_account_id")
        .single();

      if (error === null) return data.stripe_account_id;
      if (error.code !== "23505") internalError();

      const winner = await findAccount(organizerId);
      if (winner === null || winner !== stripeAccountId) internalError();
      return winner;
    },
    async beginRefresh(accountId) {
      const { data, error } = await client.rpc(
        "server_begin_connect_refresh",
        { p_stripe_account_id: accountId },
      );
      if (
        error !== null || !Number.isSafeInteger(data) ||
        (data as number) <= 0
      ) {
        internalError();
      }
      return data as number;
    },
    async persistStatus(
      accountId,
      refreshSequence,
      projection,
    ) {
      const { data, error } = await client.rpc(
        "server_persist_connect_status_if_current",
        {
          p_stripe_account_id: accountId,
          p_refresh_sequence: refreshSequence,
          p_transfers_status: projection.transfersStatus,
          p_payouts_status: projection.payoutsStatus,
          p_requirements_status: projection.requirementsStatus,
          p_currently_due_count: projection.requirementsCurrentlyDueCount,
          p_past_due_count: projection.requirementsPastDueCount,
          p_last_status_code: projection.lastStatusCode,
        },
      );
      if (
        error !== null || !Array.isArray(data) || data.length !== 1 ||
        typeof data[0] !== "object" || data[0] === null ||
        (data[0].persistence_result !== "updated" &&
          data[0].persistence_result !== "stale") ||
        typeof data[0].last_synced_at !== "string" ||
        !Number.isFinite(Date.parse(data[0].last_synced_at))
      ) {
        internalError();
      }
      return {
        outcome: data[0].persistence_result,
        syncedAt: new Date(data[0].last_synced_at).toISOString(),
      };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateApprovedConnectAccount(
  account: Stripe.V2.Core.Account,
): ConnectStatusProjection {
  const projection = deriveConnectStatus(account);
  if (
    account.dashboard !== "express" ||
    account.applied_configurations.length !== 1 ||
    account.applied_configurations[0] !== "recipient" ||
    !isRecord(account.defaults) ||
    account.defaults.currency !== "usd" ||
    !isRecord(account.defaults.responsibilities) ||
    account.defaults.responsibilities.fees_collector !== "application" ||
    account.defaults.responsibilities.losses_collector !== "application" ||
    account.defaults.responsibilities.requirements_collector !== "stripe"
  ) {
    throw new HttpError(502, "INVALID_STRIPE_ACCOUNT");
  }
  return projection;
}

export function toSafeConnectStatus(
  projection: ConnectStatusProjection,
  syncedAt: string,
): SafeConnectStatus {
  let status: SafeConnectStatus["status"];
  if (
    projection.transfersStatus === "active" &&
    projection.payoutsStatus === "active" &&
    projection.requirementsStatus === "clear"
  ) {
    status = "ready";
  } else if (projection.requirementsStatus === "action_required") {
    status = "action_required";
  } else if (
    projection.transfersStatus === "restricted" ||
    projection.payoutsStatus === "restricted" ||
    projection.requirementsStatus === "restricted"
  ) {
    status = "restricted";
  } else {
    status = "pending";
  }

  return {
    status,
    requirements_currently_due_count: projection.requirementsCurrentlyDueCount,
    requirements_past_due_count: projection.requirementsPastDueCount,
    last_status_code: projection.lastStatusCode,
    last_synced_at: syncedAt,
  };
}

export async function readEmptyRequest(request: Request): Promise<void> {
  if (request.method !== "POST") methodNotAllowed();
  const raw = await request.text();
  if (raw.length === 0) return;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || Object.keys(parsed).length !== 0) {
      throw new Error("non-empty request");
    }
  } catch {
    throw new HttpError(400, "INVALID_REQUEST");
  }
}

export async function stripeRequest<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "STRIPE_REQUEST_FAILED");
  }
}

export function validateCreatedAccount(
  account: Stripe.V2.Core.Account,
): string {
  rejectLiveStripeObject(account);
  if (!/^acct_[A-Za-z0-9]+$/.test(account.id)) {
    throw new HttpError(502, "INVALID_STRIPE_ACCOUNT");
  }
  return account.id;
}
