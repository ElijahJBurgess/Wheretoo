import type {
  ConnectStatusProjection,
  PersistedCapabilityStatus,
  PersistedRequirementsStatus,
} from "./contracts.ts";
import { rejectLiveStripeObject } from "./stripeClient.ts";

type StripeCapabilityStatus =
  | "active"
  | "pending"
  | "restricted"
  | "unsupported";
type RequirementDeadlineStatus =
  | "currently_due"
  | "eventually_due"
  | "past_due";

interface Capability {
  status: StripeCapabilityStatus;
  status_details: Array<{ code: string; resolution: string }>;
}

interface RequirementEntry {
  awaiting_action_from: "stripe" | "user";
  minimum_deadline: { status: RequirementDeadlineStatus };
}

export interface RecipientAccountState {
  id: string;
  livemode?: boolean;
  configuration?: {
    recipient?: {
      capabilities?: {
        stripe_balance?: {
          stripe_transfers?: Capability;
          payouts?: Capability;
        };
      };
    };
  };
  requirements?: { entries?: RequirementEntry[] };
}

function capabilityStatus(
  capability: Capability | undefined,
): PersistedCapabilityStatus {
  if (capability === undefined) return "inactive";
  if (capability.status === "unsupported") return "restricted";
  return capability.status;
}

function requirementsStatus(
  transfersStatus: PersistedCapabilityStatus,
  payoutsStatus: PersistedCapabilityStatus,
  entries: RequirementEntry[],
): PersistedRequirementsStatus {
  if (transfersStatus === "restricted" || payoutsStatus === "restricted") {
    return "restricted";
  }

  const userActionDue = entries.some(
    (entry) =>
      entry.awaiting_action_from === "user" &&
      (entry.minimum_deadline.status === "currently_due" ||
        entry.minimum_deadline.status === "past_due"),
  );
  if (userActionDue) return "action_required";

  const stripeActionDue = entries.some(
    (entry) =>
      entry.awaiting_action_from === "stripe" &&
      (entry.minimum_deadline.status === "currently_due" ||
        entry.minimum_deadline.status === "past_due"),
  );
  if (stripeActionDue) return "pending";

  if (transfersStatus === "active" && payoutsStatus === "active") {
    return "clear";
  }
  if (
    transfersStatus === "inactive" && payoutsStatus === "inactive" &&
    entries.length === 0
  ) {
    return "not_started";
  }
  return "pending";
}

export function deriveConnectStatus(
  account: RecipientAccountState,
): ConnectStatusProjection {
  rejectLiveStripeObject(account);

  const balance = account.configuration?.recipient?.capabilities
    ?.stripe_balance;
  const transfersStatus = capabilityStatus(balance?.stripe_transfers);
  const payoutsStatus = capabilityStatus(balance?.payouts);
  const entries = account.requirements?.entries ?? [];
  const firstStatusDetail = [
    ...(balance?.stripe_transfers?.status_details ?? []),
    ...(balance?.payouts?.status_details ?? []),
  ][0];

  return {
    transfersStatus,
    payoutsStatus,
    requirementsStatus: requirementsStatus(
      transfersStatus,
      payoutsStatus,
      entries,
    ),
    requirementsCurrentlyDueCount: entries.filter(
      (entry) => entry.minimum_deadline.status === "currently_due",
    ).length,
    requirementsPastDueCount: entries.filter(
      (entry) => entry.minimum_deadline.status === "past_due",
    ).length,
    lastStatusCode: firstStatusDetail?.code ?? null,
  };
}
