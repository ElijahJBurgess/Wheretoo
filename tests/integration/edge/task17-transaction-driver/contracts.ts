type FixtureAuthUser = { id: string; email: string };
type FixtureAuthPage = {
  users: Array<{ id: string; email?: string }>;
  nextPage: number | null;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const providerIdPattern =
  /^(?:acct|ch|fee|fr|evt|pi|price|prod|re|tr|trr|txn)_[A-Za-z0-9]+$|^cs_(?:test|live)_[A-Za-z0-9]+$/;
const prohibitedIdKeyPattern =
  /^(?:id|order_id|order_item_id|ticket_id|refund_id|session_id|payment_intent_id|charge_id|transfer_id|application_fee_id|balance_transaction_id|stripe_event_id|stripe_object_id|stripe_[a-z0-9_]*_id)$/i;

export const CONNECT_ACCOUNT_CONFLICT_TARGET = "organizer_id,livemode";

export function createFixtureAuthPassword(randomId: string): string {
  if (!uuidPattern.test(randomId)) throw new Error("DATABASE");
  return `${randomId.replaceAll("-", "")}Aa1!`;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ApprovedAccountContractBitmap = {
  dashboard_is_express: boolean;
  recipient_configuration_only: boolean;
  default_currency_is_usd: boolean;
  fees_collector_is_application: boolean;
  losses_collector_is_application: boolean;
  requirements_collector_is_stripe: boolean;
};

function approvedAccountContractBitmap(
  value: unknown,
): ApprovedAccountContractBitmap {
  const account = record(value) ? value : {};
  const defaults = record(account.defaults) ? account.defaults : {};
  const responsibilities = record(defaults.responsibilities)
    ? defaults.responsibilities
    : {};
  return {
    dashboard_is_express: account.dashboard === "express",
    recipient_configuration_only: Array.isArray(
      account.applied_configurations,
    ) &&
      account.applied_configurations.length === 1 &&
      account.applied_configurations[0] === "recipient",
    default_currency_is_usd: defaults.currency === "usd",
    fees_collector_is_application:
      responsibilities.fees_collector === "application",
    losses_collector_is_application:
      responsibilities.losses_collector === "application",
    requirements_collector_is_stripe:
      responsibilities.requirements_collector === "stripe",
  };
}

export async function retrieveAccountForDiagnostic<T>(
  retrieve: () => Promise<T>,
): Promise<
  { ok: true; account: T } | {
    ok: false;
    kind: "ACCOUNT_RETRIEVE_FAILED";
  }
> {
  try {
    return { ok: true, account: await retrieve() };
  } catch {
    return { ok: false, kind: "ACCOUNT_RETRIEVE_FAILED" };
  }
}

export function validateAccountForDiagnostic<TAccount, TProjection>(
  account: TAccount,
  validate: (value: TAccount) => TProjection,
):
  | { ok: true; projection: TProjection }
  | {
    ok: false;
    kind: "ACCOUNT_CONTRACT_MISMATCH";
    account_contract: ApprovedAccountContractBitmap;
  } {
  const accountContract = approvedAccountContractBitmap(account);
  try {
    const projection = validate(account);
    if (Object.values(accountContract).every((predicate) => predicate)) {
      return { ok: true, projection };
    }
  } catch {
    // The fixed predicate bitmap below is the only safe diagnostic surface.
  }
  return {
    ok: false,
    kind: "ACCOUNT_CONTRACT_MISMATCH",
    account_contract: accountContract,
  };
}

export async function applyDiagnosticAccountCleanup<
  T extends {
    closed?: boolean;
  },
>(
  closeRequested: boolean,
  retrieve: () => Promise<T>,
  close: (account: T) => Promise<T>,
  assertTestMode: (account: T) => void,
): Promise<{
  connectedAccountClosed: boolean;
  connectedAccountPreserved: boolean;
}> {
  if (!closeRequested) {
    return {
      connectedAccountClosed: false,
      connectedAccountPreserved: true,
    };
  }
  let account = await retrieve();
  assertTestMode(account);
  if (account.closed !== true) account = await close(account);
  assertTestMode(account);
  return {
    connectedAccountClosed: account.closed === true,
    connectedAccountPreserved: false,
  };
}

function expandableId(value: unknown): string | null {
  if (typeof value === "string") return value;
  return record(value) && typeof value.id === "string" ? value.id : null;
}

export async function findExactFixtureAuthUser(
  expectedEmail: string,
  loadPage: (page: number) => Promise<FixtureAuthPage>,
): Promise<{ id: string } | null> {
  let page = 1;
  const visited = new Set<number>();
  let match: { id: string } | null = null;
  while (!visited.has(page)) {
    visited.add(page);
    const result = await loadPage(page);
    if (!Array.isArray(result.users)) throw new Error("DATABASE");
    for (const user of result.users) {
      if (user.email !== expectedEmail) continue;
      if (!uuidPattern.test(user.id) || match !== null) {
        throw new Error("DATABASE");
      }
      match = { id: user.id };
    }
    if (result.nextPage === null) return match;
    if (
      !Number.isSafeInteger(result.nextPage) || result.nextPage < 1 ||
      visited.has(result.nextPage)
    ) throw new Error("DATABASE");
    page = result.nextPage;
  }
  throw new Error("DATABASE");
}

export async function deleteAndVerifyFixtureAuthUser(
  user: FixtureAuthUser,
  deleteUser: (id: string) => Promise<unknown>,
  loadById: (id: string) => Promise<FixtureAuthUser | null>,
  loadPage: (page: number) => Promise<FixtureAuthPage>,
): Promise<void> {
  if (!uuidPattern.test(user.id) || user.email.length === 0) {
    throw new Error("DATABASE_DELETE_AUTH");
  }
  await deleteUser(user.id);
  if (
    await loadById(user.id) !== null ||
    await findExactFixtureAuthUser(user.email, loadPage) !== null
  ) throw new Error("DATABASE_DELETE_AUTH");
}

export type AuditTombstoneState = {
  stable_fixture: boolean;
  fixture_reusable: boolean;
  event_count: number;
  organizer_count: number;
  auth_user_inert: boolean;
  event_sellable: boolean;
  public_projection_count: number;
  active_tier_count: number;
  connect_count: number;
  order_count: number;
  item_count: number;
  ticket_count: number;
  receipt_count: number;
  refund_count: number;
  dispute_count: number;
};

export function auditTombstoneIsSafe(
  value: AuditTombstoneState,
): boolean {
  return value.stable_fixture === true &&
    value.fixture_reusable === true &&
    value.event_count === 1 &&
    value.organizer_count === 1 &&
    value.auth_user_inert === true &&
    value.event_sellable === false &&
    value.public_projection_count === 0 &&
    value.active_tier_count === 0 &&
    value.connect_count === 0 &&
    value.order_count === 0 &&
    value.item_count === 0 &&
    value.ticket_count === 0 &&
    value.receipt_count === 0 &&
    value.refund_count === 0 &&
    value.dispute_count === 0;
}

export type AuditTombstoneCertification = {
  namespace_prefix_count: number;
  event_count: number;
  organizer_count: number;
  auth_user_inert: boolean;
  audit_interval_count: number;
  audit_action_count: number;
  open_eligible_interval_count: number;
  active_tier_count: number;
  tier_count: number;
  connect_count: number;
  order_count: number;
  item_count: number;
  ticket_count: number;
  refund_count: number;
  public_projection_count: number;
  staff_role_count: number;
  event_tombstoned: boolean;
};

export function auditTombstoneIsCertified(
  state: AuditTombstoneState,
  value: unknown,
): value is AuditTombstoneCertification {
  if (!auditTombstoneIsSafe(state) || !record(value)) return false;
  const certification = value as Partial<AuditTombstoneCertification>;
  return Object.keys(value).length === 17 &&
    certification.namespace_prefix_count === 1 &&
    certification.event_count === state.event_count &&
    certification.organizer_count === state.organizer_count &&
    certification.auth_user_inert === state.auth_user_inert &&
    Number.isSafeInteger(certification.audit_interval_count) &&
    (certification.audit_interval_count ?? 0) >= 3 &&
    Number.isSafeInteger(certification.audit_action_count) &&
    (certification.audit_action_count ?? 0) >= 3 &&
    certification.open_eligible_interval_count === 0 &&
    certification.active_tier_count === state.active_tier_count &&
    certification.tier_count === 0 &&
    certification.connect_count === state.connect_count &&
    certification.order_count === state.order_count &&
    certification.item_count === state.item_count &&
    certification.ticket_count === state.ticket_count &&
    certification.refund_count === state.refund_count &&
    certification.public_projection_count === state.public_projection_count &&
    certification.staff_role_count === 0 &&
    certification.event_tombstoned === true;
}

export function exactFixtureModerationTarget(
  expectedEventId: string,
  claims: unknown,
): {
  p_evaluation_id: string;
  p_content_revision: number;
  p_input_sha256: string;
  p_queued_moderation_version: number;
  p_outcome: "clear_candidate";
  p_risk_level: "low";
  p_reason_codes: ["no_violation"];
  p_provider_reference: null;
  p_model_version: null;
} {
  if (
    !uuidPattern.test(expectedEventId) || !Array.isArray(claims) ||
    claims.length !== 1
  ) {
    throw new Error("FIXTURE_MODERATION_FAILED");
  }
  const value = claims[0];
  if (
    !record(value) || value.event_id !== expectedEventId ||
    typeof value.evaluation_id !== "string" ||
    !uuidPattern.test(value.evaluation_id) ||
    !Number.isSafeInteger(value.content_revision) ||
    (value.content_revision as number) < 1 ||
    typeof value.input_sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.input_sha256) ||
    !Number.isSafeInteger(value.queued_moderation_version) ||
    (value.queued_moderation_version as number) < 0
  ) throw new Error("FIXTURE_MODERATION_FAILED");
  return {
    p_evaluation_id: value.evaluation_id,
    p_content_revision: value.content_revision as number,
    p_input_sha256: value.input_sha256,
    p_queued_moderation_version: value.queued_moderation_version as number,
    p_outcome: "clear_candidate",
    p_risk_level: "low",
    p_reason_codes: ["no_violation"],
    p_provider_reference: null,
    p_model_version: null,
  };
}

export async function retireCertifiedConnectedAccount(
  state: AuditTombstoneState,
  certification: unknown,
  close: () => Promise<{
    connectedAccountClosed: boolean;
    connectedAccountPreserved: boolean;
  }>,
): Promise<{
  connectedAccountClosed: boolean;
  connectedAccountPreserved: boolean;
}> {
  if (!auditTombstoneIsCertified(state, certification)) {
    throw new Error("FIXTURE_CERTIFICATION_FAILED");
  }
  const result = await close();
  if (
    result.connectedAccountClosed !== true ||
    result.connectedAccountPreserved !== false
  ) throw new Error("STRIPE");
  return result;
}

export async function runCleanupWithFailureFinalizers<T>(
  cleanup: () => Promise<T>,
  inertAuth: () => Promise<unknown>,
): Promise<T> {
  try {
    return await cleanup();
  } catch (error) {
    let finalizerFailed = false;
    try {
      await inertAuth();
    } catch {
      finalizerFailed = true;
    }
    if (finalizerFailed) {
      throw new Error("FIXTURE_CLEANUP_UNSAFE", { cause: error });
    }
    throw error;
  }
}

export type FixtureStageFailure =
  | "FIXTURE_PREPARATION_FAILED"
  | "FIXTURE_ORGANIZER_FAILED"
  | "FIXTURE_ACCOUNT_BINDING_FAILED"
  | "FIXTURE_EVENT_FAILED"
  | "FIXTURE_TIER_SETUP_FAILED"
  | "FIXTURE_MODERATION_FAILED"
  | "FIXTURE_AUTH_FAILED"
  | "FIXTURE_DISCLOSURE_SAVE_FAILED"
  | "FIXTURE_POLICY_ACCEPTANCE_FAILED"
  | "FIXTURE_PUBLISH_FAILED"
  | "FIXTURE_ELIGIBILITY_FAILED"
  | "FIXTURE_CHECKOUT_PREFLIGHT_FAILED";

const fixtureStageFailures = new Set<FixtureStageFailure>([
  "FIXTURE_PREPARATION_FAILED",
  "FIXTURE_ORGANIZER_FAILED",
  "FIXTURE_ACCOUNT_BINDING_FAILED",
  "FIXTURE_EVENT_FAILED",
  "FIXTURE_TIER_SETUP_FAILED",
  "FIXTURE_MODERATION_FAILED",
  "FIXTURE_AUTH_FAILED",
  "FIXTURE_DISCLOSURE_SAVE_FAILED",
  "FIXTURE_POLICY_ACCEPTANCE_FAILED",
  "FIXTURE_PUBLISH_FAILED",
  "FIXTURE_ELIGIBILITY_FAILED",
  "FIXTURE_CHECKOUT_PREFLIGHT_FAILED",
]);

export async function runFixtureStage<T>(
  fallback: FixtureStageFailure,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof Error &&
      fixtureStageFailures.has(error.message as FixtureStageFailure)
    ) throw error;
    throw new Error(fallback, { cause: error });
  }
}

export async function establishSellableFixture(
  expectedOrganizerId: string,
  expectedAccountId: string,
  dependencies: {
    saveRequirements: () => Promise<unknown>;
    acceptPolicies: () => Promise<unknown>;
    publish: () => Promise<unknown>;
    verifyEligibility: () => Promise<unknown>;
    preflight: () => Promise<
      Array<{ organizer_id: string; stripe_account_id: string }>
    >;
  },
): Promise<void> {
  await dependencies.saveRequirements();
  await dependencies.acceptPolicies();
  await dependencies.publish();
  await dependencies.verifyEligibility();
  const rows = await dependencies.preflight();
  if (
    rows.length !== 1 ||
    rows[0].organizer_id !== expectedOrganizerId ||
    rows[0].stripe_account_id !== expectedAccountId
  ) throw new Error("FIXTURE_CHECKOUT_PREFLIGHT_FAILED");
}

export async function restoreSellableFixture(
  expectedOrganizerId: string,
  expectedAccountId: string,
  dependencies: {
    reviseEvent: () => Promise<unknown>;
    saveRequirements: () => Promise<unknown>;
    acceptPolicies: () => Promise<unknown>;
    resolveModeration: () => Promise<unknown>;
    publish: () => Promise<unknown>;
    verifyEligibility: () => Promise<unknown>;
    preflight: () => Promise<
      Array<{ organizer_id: string; stripe_account_id: string }>
    >;
  },
): Promise<void> {
  await dependencies.resolveModeration();
  await dependencies.reviseEvent();
  await dependencies.saveRequirements();
  await dependencies.acceptPolicies();
  await dependencies.publish();
  await dependencies.verifyEligibility();
  const rows = await dependencies.preflight();
  if (
    rows.length !== 1 ||
    rows[0].organizer_id !== expectedOrganizerId ||
    rows[0].stripe_account_id !== expectedAccountId
  ) throw new Error("FIXTURE_CHECKOUT_PREFLIGHT_FAILED");
}

export async function retireSellableFixture(
  dependencies: {
    retireRevision: () => Promise<unknown>;
    verifyUnsellable: () => Promise<unknown>;
  },
): Promise<void> {
  await dependencies.retireRevision();
  await dependencies.verifyUnsellable();
}

export async function establishAuditTombstone(
  dependencies: {
    retireEvent: () => Promise<unknown>;
    removeRuntime: () => Promise<unknown>;
    inertAuth: () => Promise<unknown>;
    inspect: () => Promise<AuditTombstoneState>;
  },
): Promise<AuditTombstoneState> {
  await dependencies.retireEvent();
  await dependencies.removeRuntime();
  await dependencies.inertAuth();
  const state = await dependencies.inspect();
  if (!auditTombstoneIsSafe(state)) {
    throw new Error("FIXTURE_CLEANUP_UNSAFE");
  }
  return state;
}

export function requirePublicApiKey(headers: Headers): string {
  const apiKey = headers.get("apikey");
  const authorization = headers.get("authorization");
  if (
    apiKey === null || !apiKey.startsWith("sb_publishable_") ||
    authorization !== `Bearer ${apiKey}`
  ) throw new Error("INPUT");
  return apiKey;
}

export function destinationChargeRelationsMatch(value: {
  paymentIntentId: string;
  chargeId: string;
  transferId: string;
  connectedAccountId: string;
  charge: Record<string, unknown>;
  transfer: Record<string, unknown>;
  applicationFee: Record<string, unknown>;
}): boolean {
  return expandableId(value.charge.payment_intent) === value.paymentIntentId &&
    expandableId(value.charge.transfer) === value.transferId &&
    expandableId(value.transfer.source_transaction) === value.chargeId &&
    expandableId(value.applicationFee.charge) === value.chargeId &&
    expandableId(value.applicationFee.account) === value.connectedAccountId;
}

function hasProhibitedIdentifier(value: unknown): boolean {
  if (typeof value === "string") return providerIdPattern.test(value);
  if (Array.isArray(value)) return value.some(hasProhibitedIdentifier);
  if (!record(value)) return false;
  return Object.entries(value).some(([key, nested]) =>
    prohibitedIdKeyPattern.test(key) || hasProhibitedIdentifier(nested)
  );
}

export function assertSafeProofResponse<T>(value: T): T {
  if (hasProhibitedIdentifier(value)) throw new Error("UNSAFE_PROOF_RESPONSE");
  return value;
}
