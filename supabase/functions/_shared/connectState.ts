import type Stripe from "stripe";
import type {
  ConnectStatusProjection,
  PersistedCapabilityStatus,
  PersistedRequirementsStatus,
} from "./contracts.ts";
import { HttpError } from "./http.ts";
import { rejectLiveStripeObject } from "./stripeClient.ts";

type Account = Stripe.V2.Core.Account;
type RecipientConfiguration = NonNullable<
  NonNullable<Account["configuration"]>["recipient"]
>;
type StripeBalanceCapabilities = NonNullable<
  NonNullable<RecipientConfiguration["capabilities"]>["stripe_balance"]
>;
type TransferCapability = NonNullable<
  StripeBalanceCapabilities["stripe_transfers"]
>;
type CapabilityStatus = TransferCapability["status"];
type CapabilityStatusDetail = TransferCapability["status_details"][number];
type CapabilityStatusCode = CapabilityStatusDetail["code"];
type CapabilityStatusResolution = CapabilityStatusDetail["resolution"];
type RequirementEntry = Stripe.V2.Core.Account.Requirements.Entry;
type RequirementDeadlineStatus = RequirementEntry["minimum_deadline"]["status"];

interface ValidatedCapability {
  status: CapabilityStatus;
  statusDetails: Array<{
    code: CapabilityStatusCode;
    resolution: CapabilityStatusResolution;
  }>;
}

interface ValidatedRequirementEntry {
  awaitingActionFrom: RequirementEntry["awaiting_action_from"];
  deadlineStatus: RequirementDeadlineStatus;
}

interface ValidatedRecipientAccount {
  appliedConfigurations: Account["applied_configurations"];
  closed: boolean | undefined;
  recipientApplied: boolean;
  transfers: ValidatedCapability;
  payouts: ValidatedCapability;
  requirements: ValidatedRequirementEntry[];
}

function invalidStripeAccount(): never {
  throw new HttpError(502, "INVALID_STRIPE_ACCOUNT");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) invalidStripeAccount();
  return value;
}

function isAppliedConfiguration(
  value: unknown,
): value is Account["applied_configurations"][number] {
  return value === "customer" || value === "merchant" || value === "recipient";
}

function isCapabilityStatus(value: unknown): value is CapabilityStatus {
  return value === "active" || value === "pending" || value === "restricted" ||
    value === "unsupported";
}

function isRequirementDeadlineStatus(
  value: unknown,
): value is RequirementDeadlineStatus {
  return value === "currently_due" || value === "eventually_due" ||
    value === "past_due";
}

function isCapabilityStatusCode(value: unknown): value is CapabilityStatusCode {
  return value === "determining_status" || value === "requirements_past_due" ||
    value === "requirements_pending_verification" ||
    value === "restricted_other" ||
    value === "unsupported_business" || value === "unsupported_country" ||
    value === "unsupported_entity_type";
}

function isCapabilityStatusResolution(
  value: unknown,
): value is CapabilityStatusResolution {
  return value === "contact_stripe" || value === "no_resolution" ||
    value === "provide_info";
}

function validateStatusDetails(
  value: unknown,
): Array<{
  code: CapabilityStatusCode;
  resolution: CapabilityStatusResolution;
}> {
  if (!Array.isArray(value)) invalidStripeAccount();

  return value.map((detail) => {
    const record = requireRecord(detail);
    if (
      !isCapabilityStatusCode(record.code) ||
      !isCapabilityStatusResolution(record.resolution)
    ) {
      invalidStripeAccount();
    }
    return { code: record.code, resolution: record.resolution };
  });
}

function validateCapability(value: unknown): ValidatedCapability {
  const capability = requireRecord(value);
  if (!isCapabilityStatus(capability.status)) invalidStripeAccount();

  return {
    status: capability.status,
    statusDetails: validateStatusDetails(capability.status_details),
  };
}

function validateRequirement(value: unknown): ValidatedRequirementEntry {
  const requirement = requireRecord(value);
  const minimumDeadline = requireRecord(requirement.minimum_deadline);
  if (
    requirement.awaiting_action_from !== "stripe" &&
    requirement.awaiting_action_from !== "user"
  ) {
    invalidStripeAccount();
  }
  if (!isRequirementDeadlineStatus(minimumDeadline.status)) {
    invalidStripeAccount();
  }

  if (
    typeof requirement.description !== "string" ||
    !Array.isArray(requirement.errors) ||
    !requirement.errors.every((error) => {
      if (!isRecord(error)) return false;
      return typeof error.code === "string" &&
        typeof error.description === "string";
    }) ||
    !isRecord(requirement.impact) ||
    !Array.isArray(requirement.requested_reasons) ||
    !requirement.requested_reasons.every((reason) => {
      return isRecord(reason) && typeof reason.code === "string";
    })
  ) {
    invalidStripeAccount();
  }

  return {
    awaitingActionFrom: requirement.awaiting_action_from,
    deadlineStatus: minimumDeadline.status,
  };
}

function validateRecipientAccount(value: unknown): ValidatedRecipientAccount {
  const account = requireRecord(value);
  rejectLiveStripeObject(account);

  if (
    typeof account.id !== "string" ||
    !/^acct_[A-Za-z0-9]+$/.test(account.id) ||
    account.object !== "v2.core.account" ||
    typeof account.created !== "string" ||
    account.created.length === 0 ||
    (account.closed !== undefined && typeof account.closed !== "boolean") ||
    !Array.isArray(account.applied_configurations) ||
    !account.applied_configurations.every(isAppliedConfiguration)
  ) {
    invalidStripeAccount();
  }

  const configuration = requireRecord(account.configuration);
  const recipient = requireRecord(configuration.recipient);
  if (typeof recipient.applied !== "boolean") invalidStripeAccount();

  const capabilities = requireRecord(recipient.capabilities);
  const stripeBalance = requireRecord(capabilities.stripe_balance);
  const requirements = requireRecord(account.requirements);
  if (!Array.isArray(requirements.entries)) invalidStripeAccount();

  return {
    appliedConfigurations: account.applied_configurations,
    closed: account.closed,
    recipientApplied: recipient.applied,
    transfers: validateCapability(stripeBalance.stripe_transfers),
    payouts: validateCapability(stripeBalance.payouts),
    requirements: requirements.entries.map(validateRequirement),
  };
}

function capabilityStatus(
  capability: ValidatedCapability,
): PersistedCapabilityStatus {
  if (capability.status === "unsupported") return "restricted";
  return capability.status;
}

function requirementsStatus(
  transfersStatus: PersistedCapabilityStatus,
  payoutsStatus: PersistedCapabilityStatus,
  entries: ValidatedRequirementEntry[],
): PersistedRequirementsStatus {
  if (transfersStatus === "restricted" || payoutsStatus === "restricted") {
    return "restricted";
  }

  const userActionDue = entries.some(
    (entry) =>
      entry.awaitingActionFrom === "user" &&
      (entry.deadlineStatus === "currently_due" ||
        entry.deadlineStatus === "past_due"),
  );
  if (userActionDue) return "action_required";

  const stripeActionDue = entries.some(
    (entry) =>
      entry.awaitingActionFrom === "stripe" &&
      (entry.deadlineStatus === "currently_due" ||
        entry.deadlineStatus === "past_due"),
  );
  if (stripeActionDue) return "pending";

  if (transfersStatus === "active" && payoutsStatus === "active") {
    return "clear";
  }
  return "pending";
}

function restrictedProjection(
  account: ValidatedRecipientAccount,
): ConnectStatusProjection {
  return {
    transfersStatus: "restricted",
    payoutsStatus: "restricted",
    requirementsStatus: "restricted",
    requirementsCurrentlyDueCount: account.requirements.filter(
      (entry) => entry.deadlineStatus === "currently_due",
    ).length,
    requirementsPastDueCount: account.requirements.filter(
      (entry) => entry.deadlineStatus === "past_due",
    ).length,
    lastStatusCode: account.transfers.statusDetails[0]?.code ??
      account.payouts.statusDetails[0]?.code ?? null,
  };
}

export function deriveConnectStatus(
  accountValue: unknown,
): ConnectStatusProjection {
  const account = validateRecipientAccount(accountValue);
  if (
    account.closed === true ||
    account.recipientApplied !== true ||
    !account.appliedConfigurations.includes("recipient")
  ) {
    return restrictedProjection(account);
  }

  const transfersStatus = capabilityStatus(account.transfers);
  const payoutsStatus = capabilityStatus(account.payouts);

  return {
    transfersStatus,
    payoutsStatus,
    requirementsStatus: requirementsStatus(
      transfersStatus,
      payoutsStatus,
      account.requirements,
    ),
    requirementsCurrentlyDueCount: account.requirements.filter(
      (entry) => entry.deadlineStatus === "currently_due",
    ).length,
    requirementsPastDueCount: account.requirements.filter(
      (entry) => entry.deadlineStatus === "past_due",
    ).length,
    lastStatusCode: account.transfers.statusDetails[0]?.code ??
      account.payouts.statusDetails[0]?.code ?? null,
  };
}
