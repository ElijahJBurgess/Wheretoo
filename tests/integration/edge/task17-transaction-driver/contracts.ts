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
  ownershipAccepted: boolean,
  retrieve: () => Promise<T>,
  close: (account: T) => Promise<T>,
  assertTestMode: (account: T) => void,
): Promise<{
  connectedAccountClosed: boolean;
  connectedAccountPreserved: boolean;
}> {
  if (!ownershipAccepted) {
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
