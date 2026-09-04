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
