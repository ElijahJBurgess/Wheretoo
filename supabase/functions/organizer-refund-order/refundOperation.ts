export type RefundOutcome =
  | "processing"
  | "unknown"
  | "review"
  | "failed"
  | "completed"
  | "already_refunded"
  | "ineligible";
export type RefundObservation = { state: string; refundId?: string };
export interface RefundOperationContext {
  state: string;
  hasOperation: boolean;
  canRecover: boolean;
  snapshot: unknown;
}
export interface RefundOperationDependencies {
  read(): Promise<RefundOperationContext>;
  claim(): Promise<{ dispatch: boolean; state: string }>;
  refund(): Promise<void>;
  observe(snapshot: unknown): Promise<RefundObservation>;
  note(state: string, refundId?: string): Promise<void>;
}
function outcome(state: string): RefundOutcome {
  switch (state) {
    case "completed":
    case "unknown":
    case "review":
    case "failed":
      return state;
    case "submitting":
    case "processing":
      return "processing";
    default:
      return "ineligible";
  }
}

// A committed claim is the only permission to call the existing financial writer.
// Recovery has no create capability, including after an uncertain dispatch.
export async function executeOwnedRefund(
  input: { action: "submit" | "reconcile" },
  deps: RefundOperationDependencies,
): Promise<RefundOutcome> {
  const current = await deps.read();
  if (current.state === "completed") return "already_refunded";
  let observation: RefundObservation;
  if (input.action === "submit") {
    if (current.state !== "eligible") return outcome(current.state);
    const claim = await deps.claim();
    if (!claim.dispatch) return outcome(claim.state);
    try {
      await deps.refund();
      observation = { state: "processing" };
    } catch {
      observation = { state: "unknown" };
    }
  } else {
    if (
      !current.canRecover ||
      !["submitting", "processing", "unknown", "review"].includes(current.state)
    ) {
      return outcome(current.state);
    }
    try {
      observation = await deps.observe(current.snapshot);
    } catch {
      observation = { state: "unknown" };
    }
  }
  let recorded = true;
  try {
    await deps.note(observation.state, observation.refundId);
  } catch {
    recorded = false;
  }
  try {
    const latest = await deps.read();
    if (latest.state === "completed") return "completed";
    if (recorded) return outcome(latest.state);
  } catch {
    /* A lost response must never authorize another financial request. */
  }
  return "unknown";
}
