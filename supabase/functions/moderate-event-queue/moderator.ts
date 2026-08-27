import {
  type ContextualModerationResult,
  contextualModerationResultSchema,
  type ModerationFailureCode,
  type ModerationJob,
} from "./contracts.ts";

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_PROVIDER_RESPONSE_BYTES = 32_768;

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface ContextualModeratorOptions {
  endpoint: string;
  bearerToken: string | null;
  fetch?: Fetch;
  timeoutMs?: number;
}

export class ModerationAdapterError extends Error {
  constructor(
    readonly code: ModerationFailureCode,
    message: string = code,
  ) {
    super(message);
  }
}

function minimizedProviderInput(job: ModerationJob): Record<string, unknown> {
  return {
    title: job.input.event.title,
    description: job.input.event.description,
    category: job.input.event.category,
    venueName: job.input.event.venue_name,
    region: job.input.event.region,
    countryCode: job.input.event.country_code,
    minimumAge: job.input.disclosures.minimum_age,
    disclosures: {
      alcoholPresent: job.input.disclosures.alcohol_present,
      cannabisPresent: job.input.disclosures.cannabis_present,
      explicitAdultContent: job.input.disclosures.explicit_adult_content,
      gamblingPresent: job.input.disclosures.gambling_present,
      weaponsPresent: job.input.disclosures.weapons_present,
      highRiskActivity: job.input.disclosures.high_risk_activity,
    },
    organizerDisplayName: job.input.organizer_display_name,
    ticketTiers: job.input.ticket_tiers.map((tier) => ({
      name: tier.name,
      description: tier.description,
    })),
    artworkVerificationState: job.input.artwork.verification_state,
    priorReasonCodes: job.priorReasonCodes,
  };
}

export function createContextualModerator(
  options: ContextualModeratorOptions,
): (job: ModerationJob) => Promise<ContextualModerationResult> {
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (job) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers({
        "content-type": "application/json",
        "accept": "application/json",
      });
      if (options.bearerToken !== null) {
        headers.set("authorization", `Bearer ${options.bearerToken}`);
      }
      const response = await fetcher(options.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(minimizedProviderInput(job)),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ModerationAdapterError("MODERATOR_REQUEST_FAILED");
      }
      const declaredLength = Number(
        response.headers.get("content-length") ?? "0",
      );
      if (
        !Number.isSafeInteger(declaredLength) ||
        declaredLength > MAX_PROVIDER_RESPONSE_BYTES
      ) {
        throw new ModerationAdapterError("MODERATOR_MALFORMED");
      }
      const raw = await response.text();
      if (
        raw.length === 0 ||
        new TextEncoder().encode(raw).length > MAX_PROVIDER_RESPONSE_BYTES
      ) {
        throw new ModerationAdapterError("MODERATOR_MALFORMED");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new ModerationAdapterError("MODERATOR_MALFORMED");
      }
      const validated = contextualModerationResultSchema.safeParse(parsed);
      if (!validated.success) {
        throw new ModerationAdapterError("MODERATOR_MALFORMED");
      }
      return validated.data;
    } catch (error) {
      if (error instanceof ModerationAdapterError) throw error;
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        throw new ModerationAdapterError("MODERATOR_TIMEOUT");
      }
      throw new ModerationAdapterError("MODERATOR_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
  };
}
