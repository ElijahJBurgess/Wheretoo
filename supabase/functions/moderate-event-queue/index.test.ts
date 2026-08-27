import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  contextualModerationResultSchema,
  type ModerationJob,
  moderationJobSchema,
} from "./contracts.ts";
import {
  createModerationWorkerHandler,
  type ModerationWorkerDependencies,
} from "./index.ts";
import {
  createContextualModerator,
  ModerationAdapterError,
} from "./moderator.ts";
import {
  getContextualModerationConfig,
  getModerationWorkerToken,
} from "../_shared/env.ts";

const workerToken = "worker-test-boundary-token-1234567890";

const job = {
  evaluationId: "37000000-0000-4000-8000-000000000001",
  eventId: "27000000-0000-4000-8000-000000000001",
  contentRevision: 1,
  inputSha256: "a".repeat(64),
  queuedModerationVersion: 4,
  attemptCount: 1,
  input: {
    event: {
      title: "Community gathering",
      description: "A complete public event description.",
      category: "community",
      venue_name: "Fixture Hall",
      starts_at: "2026-08-30T17:00:00.000Z",
      ends_at: "2026-08-30T19:00:00.000Z",
      timezone: "America/Los_Angeles",
      address_line1: "1 Market Street",
      address_line2: null,
      city: "San Francisco",
      region: "CA",
      postal_code: "94105",
      country_code: "US",
      mapbox_feature_id: "mapbox.fixture",
      latitude: 37.7936,
      longitude: -122.3958,
      admission_type: "free" as const,
    },
    disclosures: {
      minimum_age: "all_ages" as const,
      alcohol_present: false,
      cannabis_present: false,
      explicit_adult_content: false,
      gambling_present: false,
      weapons_present: false,
      high_risk_activity: false,
    },
    artwork: { path: null, verification_state: "not_present" as const },
    ticket_tiers: [],
    organizer_display_name: "Fixture Organizer",
  },
  priorReasonCodes: [],
} satisfies ModerationJob;

const result = {
  outcome: "clear_candidate" as const,
  riskLevel: "low" as const,
  reasonCodes: ["no_violation" as const],
  providerReference: "opaque-provider-ref",
  modelVersion: "model-v1",
};

function request(token: string | null = workerToken): Request {
  const headers = new Headers();
  if (token !== null) headers.set("authorization", `Bearer ${token}`);
  return new Request("https://project.functions.example/moderate-event-queue", {
    method: "POST",
    headers,
  });
}

function dependencies(
  overrides: Partial<ModerationWorkerDependencies> = {},
): ModerationWorkerDependencies {
  return {
    workerToken,
    claimJob: () => Promise.resolve(job),
    moderate: () => Promise.resolve(result),
    applyResult: () => Promise.resolve("applied"),
    failJob: () => Promise.resolve("retry_scheduled"),
    log: () => {},
    ...overrides,
  };
}

Deno.test("worker and contextual provider env stay server-only and validate exact boundaries", () => {
  const values: Record<string, string> = {
    MODERATION_WORKER_TOKEN: workerToken,
    CONTEXTUAL_MODERATION_ENDPOINT: "https://moderator.example/v1/evaluate",
    CONTEXTUAL_MODERATION_BEARER_TOKEN: "provider-private-token",
  };
  const read = (name: string) => values[name];

  assertEquals(getModerationWorkerToken(read), workerToken);
  assertEquals(getContextualModerationConfig(read), {
    endpoint: "https://moderator.example/v1/evaluate",
    bearerToken: "provider-private-token",
  });
  assertThrows(() => getModerationWorkerToken(() => "short"));
  assertThrows(() =>
    getContextualModerationConfig((name) =>
      name === "CONTEXTUAL_MODERATION_ENDPOINT"
        ? "http://moderator.example/evaluate"
        : undefined
    )
  );
  assertEquals(getContextualModerationConfig(() => undefined), null);
});

Deno.test("structured schemas reject malformed jobs and provider prose", () => {
  assertEquals(moderationJobSchema.parse(job), job);
  assertEquals(contextualModerationResultSchema.parse(result), result);
  assertThrows(() =>
    contextualModerationResultSchema.parse({
      ...result,
      outcome: "allow",
      reasoning: "raw hidden model reasoning",
    })
  );
  assertThrows(() =>
    contextualModerationResultSchema.parse({
      ...result,
      reasonCodes: ["not-approved"],
    })
  );
  assertThrows(() =>
    moderationJobSchema.parse({ ...job, buyerEmail: "x@example.invalid" })
  );
});

Deno.test("worker requires the exact bearer token before claiming work", async () => {
  let claims = 0;
  const handler = createModerationWorkerHandler(dependencies({
    claimJob: () => {
      claims += 1;
      return Promise.resolve(job);
    },
  }));

  for (const unauthorized of [request(null), request("wrong-worker-token")]) {
    const response = await handler(unauthorized);
    assertEquals(response.status, 401);
    assertEquals(await response.json(), { error: { code: "AUTH_REQUIRED" } });
  }
  assertEquals(claims, 0);
});

Deno.test("worker processes exactly one job and returns only bounded status", async () => {
  const handler = createModerationWorkerHandler(dependencies());
  const response = await handler(request());

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: "processed",
    evaluationId: job.evaluationId,
    disposition: "applied",
  });
});

Deno.test("worker returns no-content when the durable queue is empty", async () => {
  const handler = createModerationWorkerHandler(dependencies({
    claimJob: () => Promise.resolve(null),
  }));
  const response = await handler(request());
  assertEquals(response.status, 204);
  assertEquals(await response.text(), "");
});

Deno.test("provider outage persists only its safe code and never logs raw provider detail", async () => {
  const rawProviderDetail = "raw-provider-body-never-persist-or-log";
  const failures: string[] = [];
  const logs: unknown[][] = [];
  const handler = createModerationWorkerHandler(dependencies({
    moderate: () =>
      Promise.reject(
        new ModerationAdapterError("MODERATOR_UNAVAILABLE", rawProviderDetail),
      ),
    failJob: (_job, code) => {
      failures.push(code);
      return Promise.resolve("retry_scheduled");
    },
    log: (...values) => logs.push(values),
  }));

  const response = await handler(request());
  assertEquals(response.status, 503);
  assertEquals(await response.json(), {
    error: { code: "MODERATOR_UNAVAILABLE" },
    disposition: "retry_scheduled",
  });
  assertEquals(failures, ["MODERATOR_UNAVAILABLE"]);
  assertEquals(JSON.stringify(logs).includes(rawProviderDetail), false);
});

Deno.test("provider adapter sends minimized input and validates a structured success", async () => {
  let sentBody: unknown;
  let sentAuthorization: string | null = null;
  const moderator = createContextualModerator({
    endpoint: "https://moderator.example/v1/evaluate",
    bearerToken: "provider-private-token",
    fetch: (_url, init) => {
      sentBody = JSON.parse(String(init?.body));
      sentAuthorization = new Headers(init?.headers).get("authorization");
      return Promise.resolve(Response.json(result));
    },
  });

  assertEquals(await moderator(job), result);
  assertEquals(sentAuthorization, "Bearer provider-private-token");
  assertEquals(sentBody, {
    title: job.input.event.title,
    description: job.input.event.description,
    category: job.input.event.category,
    venueName: job.input.event.venue_name,
    region: job.input.event.region,
    countryCode: job.input.event.country_code,
    minimumAge: job.input.disclosures.minimum_age,
    disclosures: {
      alcoholPresent: false,
      cannabisPresent: false,
      explicitAdultContent: false,
      gamblingPresent: false,
      weaponsPresent: false,
      highRiskActivity: false,
    },
    organizerDisplayName: job.input.organizer_display_name,
    ticketTiers: [],
    artworkVerificationState: "not_present",
    priorReasonCodes: [],
  });
});

Deno.test("provider adapter maps timeout and malformed output to bounded safe codes", async () => {
  const timeoutModerator = createContextualModerator({
    endpoint: "https://moderator.example/v1/evaluate",
    bearerToken: null,
    timeoutMs: 1,
    fetch: (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("provider timeout detail", "AbortError")));
      }),
  });
  await assertRejects(
    () => timeoutModerator(job),
    ModerationAdapterError,
    "MODERATOR_TIMEOUT",
  );

  const malformedModerator = createContextualModerator({
    endpoint: "https://moderator.example/v1/evaluate",
    bearerToken: null,
    fetch: () => Promise.resolve(Response.json({ raw: "provider prose" })),
  });
  await assertRejects(
    () => malformedModerator(job),
    ModerationAdapterError,
    "MODERATOR_MALFORMED",
  );
});
