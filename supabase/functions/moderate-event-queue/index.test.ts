import { createClient } from "@supabase/supabase-js";
import {
  assertEquals,
  assertMatch,
  assertRejects,
  assertThrows,
} from "@std/assert";
import {
  contextualModerationResultSchema,
  type ModerationJob,
  moderationJobSchema,
} from "./contracts.ts";
import {
  createDatabaseDependencies,
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
  providerReference: `sha256:${"a".repeat(64)}`,
  modelVersion: `sha256:${"b".repeat(64)}`,
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
    claimJob: () => Promise.resolve({ kind: "ready", job }),
    rejectInput: () => Promise.resolve("superseded"),
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

Deno.test("structured schemas reject malformed jobs and unsafe provider metadata", () => {
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
  for (
    const invalidResult of [
      { ...result, outcome: "review_required", reasonCodes: ["no_violation"] },
      { ...result, providerReference: "contact@example.invalid" },
      { ...result, providerReference: "prose with spaces" },
      { ...result, providerReference: "provider/sk_live_abcdef0123456789" },
      { ...result, providerReference: "provider/opaque\nreference" },
      { ...result, modelVersion: "provider/input excerpt" },
      { ...result, modelVersion: "provider/abcdef0123456789abcdef0123456789" },
    ]
  ) {
    assertThrows(() => contextualModerationResultSchema.parse(invalidResult));
  }
});

Deno.test("worker requires the exact bearer token before claiming work", async () => {
  let claims = 0;
  const handler = createModerationWorkerHandler(dependencies({
    claimJob: () => {
      claims += 1;
      return Promise.resolve({ kind: "ready", job });
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

Deno.test("provider adapter sends minimized input and hashes all raw provider metadata", async () => {
  let sentBody: unknown;
  let sentAuthorization: string | null = null;
  const rawProviderReference =
    "sk_live_abcdef0123456789:private-contact@example.invalid";
  const rawModelVersion = "raw provider model prose from input excerpt";
  const moderator = createContextualModerator({
    endpoint: "https://moderator.example/v1/evaluate",
    bearerToken: "provider-private-token",
    fetch: (_url, init) => {
      sentBody = JSON.parse(String(init?.body));
      sentAuthorization = new Headers(init?.headers).get("authorization");
      return Promise.resolve(Response.json({
        ...result,
        providerReference: rawProviderReference,
        modelVersion: rawModelVersion,
      }));
    },
  });

  const moderated = await moderator(job);
  assertMatch(moderated.providerReference ?? "", /^sha256:[a-f0-9]{64}$/);
  assertMatch(moderated.modelVersion ?? "", /^sha256:[a-f0-9]{64}$/);
  assertEquals(moderated.providerReference === moderated.modelVersion, false);
  const persistedResult = JSON.stringify(moderated);
  for (
    const rawSubstring of [
      rawProviderReference,
      "sk_live_",
      "private-contact@example.invalid",
      rawModelVersion,
      "input excerpt",
    ]
  ) {
    assertEquals(persistedResult.includes(rawSubstring), false);
  }
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

  const nullMetadataModerator = createContextualModerator({
    endpoint: "https://moderator.example/v1/evaluate",
    bearerToken: null,
    fetch: () =>
      Promise.resolve(Response.json({
        ...result,
        providerReference: null,
        modelVersion: null,
      })),
  });
  assertEquals(await nullMetadataModerator(job), {
    ...result,
    providerReference: null,
    modelVersion: null,
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

// These fixtures cross the real Supabase RPC adapter and handler. Only HTTP and
// the external moderator are substituted; parsing and RPC selection remain real.
const databaseJob = {
  evaluation_id: "37000000-0000-4000-8000-000000000001",
  event_id: "27000000-0000-4000-8000-000000000001",
  content_revision: 1,
  input_sha256: "a".repeat(64),
  queued_moderation_version: 4,
  attempt_count: 1,
  prior_reason_codes: [],
  moderation_input: job.input,
};
const incompleteDatabaseJob = {
  ...databaseJob,
  moderation_input: {
    ...job.input,
    event: { ...job.input.event, description: "PRIVATE_CANONICAL_TEXT" },
    disclosures: {
      minimum_age: null,
      alcohol_present: null,
      cannabis_present: null,
      explicit_adult_content: null,
      gambling_present: null,
      weapons_present: null,
      high_risk_activity: null,
    },
  },
};

function databaseHandler(
  row: unknown,
  rejectResponse: () => Response = () => Response.json("superseded"),
  providerFailure = false,
) {
  const calls: Array<{ rpc: string; args: unknown }> = [];
  const logs: unknown[][] = [];
  let providerCalls = 0;
  const client = createClient(
    "https://database.example.invalid",
    "test-service-key",
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (url, init) => {
          const rpc = String(url).split("/").at(-1)!;
          calls.push({ rpc, args: JSON.parse(String(init?.body)) });
          if (rpc === "server_claim_moderation_evaluation") {
            return Promise.resolve(Response.json([row]));
          }
          if (rpc === "server_reject_moderation_evaluation_input") {
            return Promise.resolve(rejectResponse());
          }
          if (rpc === "server_apply_moderation_evaluation") {
            return Promise.resolve(Response.json("applied"));
          }
          if (rpc === "server_fail_moderation_evaluation") {
            return Promise.resolve(Response.json("retry_scheduled"));
          }
          throw new Error("unexpected RPC");
        },
      },
    },
  );
  const handler = createModerationWorkerHandler(createDatabaseDependencies(
    client,
    workerToken,
    () => {
      providerCalls += 1;
      return providerFailure
        ? Promise.reject(new ModerationAdapterError("MODERATOR_TIMEOUT"))
        : Promise.resolve(result);
    },
    (...values) => logs.push(values),
  ));
  return { handler, calls, logs, providerCalls: () => providerCalls };
}

Deno.test("database claim with null disclosures rejects the exact lease without provider/apply/fail", async () => {
  const boundary = databaseHandler(incompleteDatabaseJob);
  const response = await boundary.handler(request());
  assertEquals(response.status, 500);
  assertEquals(await response.json(), {
    error: { code: "MODERATION_JOB_INVALID" },
    disposition: "superseded",
  });
  assertEquals(boundary.calls, [
    {
      rpc: "server_claim_moderation_evaluation",
      args: { p_worker_reference: "edge-worker" },
    },
    {
      rpc: "server_reject_moderation_evaluation_input",
      args: {
        p_evaluation_id: "37000000-0000-4000-8000-000000000001",
        p_event_id: "27000000-0000-4000-8000-000000000001",
        p_content_revision: 1,
        p_input_sha256: "a".repeat(64),
        p_queued_moderation_version: 4,
        p_attempt_count: 1,
      },
    },
  ]);
  assertEquals(boundary.providerCalls(), 0);
  assertEquals(
    JSON.stringify(boundary.logs).includes("PRIVATE_CANONICAL_TEXT"),
    false,
  );
  assertEquals(JSON.stringify(boundary.logs).includes("Zod"), false);
});

Deno.test("invalid database claim envelopes retain generic safe500 and cannot authorize rejection", async () => {
  for (
    const change of [
      { evaluation_id: "invalid" },
      { event_id: null },
      { content_revision: 0 },
      { input_sha256: "invalid" },
      { queued_moderation_version: -1 },
      { attempt_count: 0 },
      { attempt_count: 4 },
      { prior_reason_codes: ["private prose"] },
    ]
  ) {
    const boundary = databaseHandler({ ...incompleteDatabaseJob, ...change });
    const response = await boundary.handler(request());
    assertEquals(response.status, 500);
    assertEquals(await response.json(), { error: { code: "INTERNAL_ERROR" } });
    assertEquals(boundary.calls.length, 1);
    assertEquals(boundary.providerCalls(), 0);
    assertEquals(boundary.logs, [["moderation_worker_internal_error"]]);
  }
});

Deno.test("invalid-input rejection conflicts and persistence failures stay visible without provider failures", async () => {
  for (
    const [payload, status, disposition] of [
      ["conflict", 200, "conflict"],
      ["not_found", 200, "not_found"],
      ["schema_disagreement", 200, "schema_disagreement"],
      [
        {
          code: "P0001",
          message: "PRIVATE_DATABASE_FAILURE",
          details: "private",
          hint: null,
        },
        409,
        "rejection_failed",
      ],
      ["PRIVATE_UNRECOGNIZED_DISPOSITION", 200, "rejection_failed"],
      [["superseded"], 200, "rejection_failed"],
    ] as const
  ) {
    const boundary = databaseHandler(
      incompleteDatabaseJob,
      () => Response.json(payload, { status }),
    );
    const response = await boundary.handler(request());
    assertEquals(response.status, 500);
    assertEquals(await response.json(), {
      error: { code: "MODERATION_JOB_INVALID" },
      disposition,
    });
    assertEquals(boundary.calls.map((call) => call.rpc), [
      "server_claim_moderation_evaluation",
      "server_reject_moderation_evaluation_input",
    ]);
    assertEquals(boundary.providerCalls(), 0);
    assertEquals(JSON.stringify(boundary.logs).includes("PRIVATE"), false);
  }
});

Deno.test("valid database claim preserves existing apply and provider-retry RPC boundaries", async () => {
  for (const providerFailure of [false, true]) {
    const boundary = databaseHandler(databaseJob, undefined, providerFailure);
    const response = await boundary.handler(request());
    assertEquals(response.status, providerFailure ? 503 : 200);
    assertEquals(boundary.providerCalls(), 1);
    assertEquals(boundary.calls.map((call) => call.rpc), [
      "server_claim_moderation_evaluation",
      providerFailure
        ? "server_fail_moderation_evaluation"
        : "server_apply_moderation_evaluation",
    ]);
    assertEquals(
      boundary.calls[1].args,
      providerFailure
        ? {
          p_evaluation_id: job.evaluationId,
          p_content_revision: 1,
          p_input_sha256: "a".repeat(64),
          p_queued_moderation_version: 4,
          p_failure_code: "MODERATOR_TIMEOUT",
        }
        : {
          p_evaluation_id: job.evaluationId,
          p_content_revision: 1,
          p_input_sha256: "a".repeat(64),
          p_queued_moderation_version: 4,
          p_outcome: "clear_candidate",
          p_risk_level: "low",
          p_reason_codes: ["no_violation"],
          p_provider_reference: `sha256:${"a".repeat(64)}`,
          p_model_version: `sha256:${"b".repeat(64)}`,
        },
    );
  }
});

Deno.test("database adapter preserves nullable draft facts and three retained tiers", async () => {
  const boundary = databaseHandler({
    ...databaseJob,
    moderation_input: {
      ...job.input,
      event: {
        ...job.input.event,
        title: null,
        description: null,
        starts_at: null,
        ends_at: null,
        latitude: null,
        longitude: null,
      },
      ticket_tiers: [{ name: "Active", description: null }, {
        name: "Archived one",
        description: null,
      }, { name: "Archived two", description: null }],
    },
  });
  assertEquals((await boundary.handler(request())).status, 200);
  assertEquals(boundary.providerCalls(), 1);
});
