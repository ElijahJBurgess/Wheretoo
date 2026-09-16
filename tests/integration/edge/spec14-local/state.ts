export type EmailMode = "accepted" | "failed" | "unknown";
export type CheckoutCreateMode = "normal" | "failed" | "commit_then_unknown";
export type RefundMode =
  | "succeeded"
  | "processing"
  | "failed"
  | "anomaly"
  | "commit_then_unknown";
export type AccountMode =
  | "pending"
  | "ready"
  | "action_required"
  | "restricted";

export interface ProviderMessage {
  attemptKey: string;
  providerId: string;
  mode: EmailMode;
  payload: unknown;
  createdAt: string;
}

export interface ProviderState {
  version: 1;
  sequences: Record<string, number>;
  idempotency: Record<string, string>;
  stripe: {
    accountMode: AccountMode;
    checkoutCreateMode: CheckoutCreateMode;
    refundMode: RefundMode;
    accounts: Record<string, Record<string, unknown>>;
    accountSessions: Record<string, Record<string, unknown>>;
    checkoutSessions: Record<string, Record<string, unknown>>;
    paymentIntents: Record<string, Record<string, unknown>>;
    charges: Record<string, Record<string, unknown>>;
    applicationFees: Record<string, Record<string, unknown>>;
    transfers: Record<string, Record<string, unknown>>;
    refunds: Record<string, Record<string, unknown>>;
    disputes: Record<string, Record<string, unknown>>;
    events: Record<string, Record<string, unknown>>;
  };
  email: { mode: EmailMode; messages: ProviderMessage[] };
  moderation: { mode: "approve" | "review" | "failed"; requests: unknown[] };
}

export function emptyProviderState(): ProviderState {
  return {
    version: 1,
    sequences: {},
    idempotency: {},
    stripe: {
      accountMode: "pending",
      checkoutCreateMode: "normal",
      refundMode: "succeeded",
      accounts: {},
      accountSessions: {},
      checkoutSessions: {},
      paymentIntents: {},
      charges: {},
      applicationFees: {},
      transfers: {},
      refunds: {},
      disputes: {},
      events: {},
    },
    email: { mode: "accepted", messages: [] },
    moderation: { mode: "review", requests: [] },
  };
}

export interface ProviderStore {
  read(): Promise<ProviderState>;
  update<T>(change: (state: ProviderState) => T | Promise<T>): Promise<T>;
}

export class MemoryProviderStore implements ProviderStore {
  #state: ProviderState;
  #queue: Promise<void> = Promise.resolve();
  constructor(initial = emptyProviderState()) {
    this.#state = structuredClone(initial);
  }
  read(): Promise<ProviderState> {
    return Promise.resolve(structuredClone(this.#state));
  }
  update<T>(change: (state: ProviderState) => T | Promise<T>): Promise<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const result = new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    this.#queue = this.#queue.then(async () => {
      try {
        const next = structuredClone(this.#state);
        const value = await change(next);
        this.#state = next;
        resolve(value);
      } catch (error) {
        reject(error);
      }
    });
    return result;
  }
}

export class FileProviderStore implements ProviderStore {
  #queue: Promise<void> = Promise.resolve();
  constructor(readonly path: string) {}
  async read(): Promise<ProviderState> {
    try {
      return validateState(JSON.parse(await Deno.readTextFile(this.path)));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return emptyProviderState();
      throw error;
    }
  }
  update<T>(change: (state: ProviderState) => T | Promise<T>): Promise<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const result = new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    this.#queue = this.#queue.then(async () => {
      try {
        const state = await this.read();
        const value = await change(state);
        const temporary = `${this.path}.tmp-${crypto.randomUUID()}`;
        try {
          await Deno.writeTextFile(
            temporary,
            JSON.stringify(state, null, 2) + "\n",
            { createNew: true, mode: 0o600 },
          );
          await Deno.chmod(temporary, 0o600);
          await Deno.rename(temporary, this.path);
        } catch (error) {
          try {
            await Deno.remove(temporary);
          } catch {
            // Preserve the persistence failure; a unique private temp is inert.
          }
          throw error;
        }
        resolve(value);
      } catch (error) {
        reject(error);
      }
    });
    return result;
  }
}

function validateState(value: unknown): ProviderState {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    (value as { version?: unknown }).version !== 1
  ) {
    throw new Error("Provider state is invalid");
  }
  const state = value as ProviderState;
  if (
    !state.stripe || !state.email || !state.moderation || !state.sequences ||
    !state.idempotency
  ) {
    throw new Error("Provider state is invalid");
  }
  state.stripe.checkoutCreateMode ??= "normal";
  state.stripe.refundMode ??= "succeeded";
  return state;
}

export function nextId(state: ProviderState, prefix: string): string {
  const next = (state.sequences[prefix] ?? 0) + 1;
  state.sequences[prefix] = next;
  return `${prefix}_spec14${next.toString().padStart(8, "0")}`;
}
