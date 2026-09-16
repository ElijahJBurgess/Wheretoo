import { FileProviderStore, type ProviderState } from "./state.ts";
import {
  createProviderBoundary,
  type ProviderBoundary,
  type ProviderBoundaryConfig,
} from "./providers.ts";

export type ProductionHandler = (
  request: Request,
) => Response | Promise<Response>;

export const FUNCTION_MODULES = {
  "event-status-access":
    "../../../../supabase/functions/event-status-access/index.ts",
  "free-rsvp": "../../../../supabase/functions/free-rsvp/index.ts",
  "free-rsvp-status":
    "../../../../supabase/functions/free-rsvp-status/index.ts",
  "moderate-event-queue":
    "../../../../supabase/functions/moderate-event-queue/index.ts",
  "order-confirmation":
    "../../../../supabase/functions/order-confirmation/index.ts",
  "organizer-refund-order":
    "../../../../supabase/functions/organizer-refund-order/index.ts",
  "public-discovery":
    "../../../../supabase/functions/public-discovery/index.ts",
  "refund-detail-access":
    "../../../../supabase/functions/refund-detail-access/index.ts",
  "report-event": "../../../../supabase/functions/report-event/index.ts",
  "stripe-cancel-checkout":
    "../../../../supabase/functions/stripe-cancel-checkout/index.ts",
  "stripe-connect-session":
    "../../../../supabase/functions/stripe-connect-session/index.ts",
  "stripe-connect-status":
    "../../../../supabase/functions/stripe-connect-status/index.ts",
  "stripe-create-checkout":
    "../../../../supabase/functions/stripe-create-checkout/index.ts",
  "stripe-express-login":
    "../../../../supabase/functions/stripe-express-login/index.ts",
  "stripe-webhook": "../../../../supabase/functions/stripe-webhook/index.ts",
  "ticket-admission":
    "../../../../supabase/functions/ticket-admission/index.ts",
  "ticket-collection":
    "../../../../supabase/functions/ticket-collection/index.ts",
  "ticket-email-access":
    "../../../../supabase/functions/ticket-email-access/index.ts",
  "ticket-email-status":
    "../../../../supabase/functions/ticket-email-status/index.ts",
  "ticket-email-webhook":
    "../../../../supabase/functions/ticket-email-webhook/index.ts",
  "ticket-email-worker":
    "../../../../supabase/functions/ticket-email-worker/index.ts",
  "ticket-recovery-request":
    "../../../../supabase/functions/ticket-recovery-request/index.ts",
} as const;

type FunctionName = keyof typeof FUNCTION_MODULES;

interface LocalSecrets {
  password: string;
  jwtSecret: string;
  credentialSecret: string;
  emailKey: string;
  workerSecret: string;
}

interface HarnessIdentity {
  task: string;
  root: string;
  instanceId: string;
  containers: { rest: { port: number }; auth: { port: number } };
}

export interface GatewayDependencies {
  appOrigin: string;
  workerSecret: string;
  handlers: Partial<Record<FunctionName, ProductionHandler>>;
  provider: ProviderBoundary;
  nativeFetch: typeof fetch;
}

export function validateHarnessIdentity(
  value: unknown,
  root: string,
): HarnessIdentity {
  if (!record(value)) throw new Error("Spec14 environment identity is invalid");
  if (value.task !== "spec14-final-assembly") {
    throw new Error("Spec14 task identity mismatch");
  }
  if (value.root !== root) throw new Error("Spec14 identity root mismatch");
  if (typeof value.instanceId !== "string" || value.instanceId.length < 16) {
    throw new Error("Spec14 instance identity is invalid");
  }
  if (
    !record(value.containers) || !record(value.containers.rest) ||
    !record(value.containers.auth) ||
    value.containers.rest.port !== 55646 || value.containers.auth.port !== 55648
  ) {
    throw new Error("Spec14 fixed bridge ports do not match identity");
  }
  return value as unknown as HarnessIdentity;
}

export async function loadProductionHandlers(): Promise<
  Record<FunctionName, ProductionHandler>
> {
  const entries = await Promise.all(
    Object.entries(FUNCTION_MODULES).map(async ([name, path]) => {
      const module = await import(new URL(path, import.meta.url).href) as {
        handler?: unknown;
      };
      if (typeof module.handler !== "function") {
        throw new Error(`Production handler unavailable: ${name}`);
      }
      return [name, module.handler as ProductionHandler] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<FunctionName, ProductionHandler>;
}

export function createGatewayHandler(
  dependencies: GatewayDependencies,
): ProductionHandler {
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({
        status: "ready",
        functions: Object.keys(dependencies.handlers).length,
      }, { headers: { "cache-control": "no-store" } });
    }
    if (url.pathname === "/__spec14/control") {
      if (
        request.method !== "POST" ||
        request.headers.get("x-spec14-control") !== dependencies.workerSecret
      ) {
        return new Response(null, {
          status: 404,
          headers: { "cache-control": "no-store" },
        });
      }
      return controlResponse(request, dependencies);
    }
    const functionMatch = url.pathname.match(/^\/functions\/v1\/([a-z0-9-]+)$/);
    if (functionMatch) {
      const handler = dependencies.handlers[functionMatch[1] as FunctionName];
      return handler
        ? await handler(trustedIngress(request))
        : Response.json({ error: { code: "FUNCTION_NOT_FOUND" } }, {
          status: 404,
        });
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      return proxy(
        request,
        `http://127.0.0.1:55646${
          url.pathname.slice("/rest/v1".length)
        }${url.search}`,
        dependencies.nativeFetch,
      );
    }
    if (url.pathname.startsWith("/auth/v1/")) {
      return proxy(
        request,
        `http://127.0.0.1:55648${
          url.pathname.slice("/auth/v1".length)
        }${url.search}`,
        dependencies.nativeFetch,
      );
    }
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  };
}

function trustedIngress(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete("forwarded");
  headers.delete("x-real-ip");
  headers.set("x-spec14-client-ip", "127.0.0.1");
  headers.set("cf-connecting-ip", "127.0.0.1");
  headers.set("x-forwarded-for", "127.0.0.1");
  return new Request(request, { headers });
}

async function controlResponse(
  request: Request,
  dependencies: GatewayDependencies,
): Promise<Response> {
  let input: Record<string, unknown>;
  try {
    const value = await request.json();
    if (!record(value)) throw new Error();
    input = value;
  } catch {
    return Response.json({ error: "invalid control request" }, { status: 400 });
  }
  try {
    if (input.action === "connect-ready") {
      if (
        typeof input.clientSecret !== "string" ||
        !input.clientSecret.includes("_secret_")
      ) throw new Error("clientSecret required");
      const state = await dependencies.provider.control.snapshot();
      const session = Object.values(state.stripe.accountSessions).find((item) =>
        item.client_secret === input.clientSecret
      );
      if (!session) {
        return Response.json({ error: "unknown account session" }, {
          status: 404,
        });
      }
      await dependencies.provider.control.setAccountMode("ready");
      return safeJson({ outcome: "ready", accountId: session.account });
    }
    if (input.action === "checkout-complete") {
      if (typeof input.sessionId !== "string") {
        throw new Error("sessionId required");
      }
      const completed = await dependencies.provider.control.completeCheckout(
        input.sessionId,
      );
      const raw = JSON.stringify(completed.event);
      const webhook = dependencies.handlers["stripe-webhook"];
      if (!webhook) throw new Error("Stripe webhook handler unavailable");
      const response = await webhook(
        new Request("http://127.0.0.1:55647/functions/v1/stripe-webhook", {
          method: "POST",
          headers: {
            "stripe-signature": completed.signature,
            "content-type": "application/json",
          },
          body: raw,
        }),
      );
      if (!response.ok) {
        return safeJson({
          outcome: "webhook-rejected",
          status: response.status,
        }, 502);
      }
      const state = await dependencies.provider.control.snapshot();
      const session = state.stripe.checkoutSessions[input.sessionId];
      return safeJson({
        outcome: "completed",
        sessionId: input.sessionId,
        successUrl: session?.success_url,
      });
    }
    if (input.action === "checkout-cancel") {
      if (typeof input.sessionId !== "string") {
        throw new Error("sessionId required");
      }
      const session = await dependencies.provider.control.expireCheckout(
        input.sessionId,
      );
      return safeJson({
        outcome: "expired",
        sessionId: input.sessionId,
        cancelUrl: session.cancel_url,
      });
    }
    if (input.action === "checkout-mode") {
      if (
        !isOneOf(
          input.mode,
          ["normal", "failed", "commit_then_unknown"] as const,
        )
      ) throw new Error("mode required");
      await dependencies.provider.control.setCheckoutCreateMode(input.mode);
      return safeJson({ outcome: "configured", mode: input.mode });
    }
    if (input.action === "refund-mode") {
      if (
        !isOneOf(
          input.mode,
          [
            "succeeded",
            "processing",
            "failed",
            "anomaly",
            "commit_then_unknown",
          ] as const,
        ) ||
        (input.refundId !== undefined &&
          (typeof input.refundId !== "string" ||
            !/^re_[A-Za-z0-9]+$/.test(input.refundId)))
      ) throw new Error("mode required");
      await dependencies.provider.control.setRefundMode(
        input.mode,
        input.refundId as string | undefined,
      );
      return safeJson({
        outcome: "configured",
        mode: input.mode,
        ...(input.refundId ? { refundId: input.refundId } : {}),
      });
    }
    if (input.action === "email-mode") {
      if (!isOneOf(input.mode, ["accepted", "failed", "unknown"] as const)) {
        throw new Error("mode required");
      }
      await dependencies.provider.control.setEmailMode(input.mode);
      return safeJson({ outcome: "configured", mode: input.mode });
    }
    if (input.action === "moderation-mode") {
      if (!isOneOf(input.mode, ["approve", "review", "failed"] as const)) {
        throw new Error("mode required");
      }
      await dependencies.provider.control.setModerationMode(input.mode);
      return safeJson({ outcome: "configured", mode: input.mode });
    }
    if (input.action === "run-worker") {
      if (
        !isOneOf(
          input.name,
          ["moderate-event-queue", "ticket-email-worker"] as const,
        )
      ) throw new Error("worker name required");
      const handler = dependencies.handlers[input.name];
      if (!handler) throw new Error("worker handler unavailable");
      const environmentName = input.name === "moderate-event-queue"
        ? "MODERATION_WORKER_TOKEN"
        : "TICKET_EMAIL_WORKER_SECRET";
      const bearer = Deno.env.get(environmentName);
      if (!bearer) throw new Error("worker bearer unavailable");
      const response = await handler(
        new Request(`http://127.0.0.1:55647/functions/v1/${input.name}`, {
          method: "POST",
          headers: { authorization: `Bearer ${bearer}` },
        }),
      );
      const text = (await response.text()).slice(0, 4_096);
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch { /* safe bounded text */ }
      return safeJson({
        outcome: "invoked",
        name: input.name,
        handlerStatus: response.status,
        body,
      }, response.status >= 500 ? 502 : 200);
    }
    if (input.action === "stripe-event") {
      if (
        typeof input.type !== "string" || typeof input.objectId !== "string"
      ) throw new Error("Stripe event identity required");
      const allowed = new Set([
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
        "checkout.session.async_payment_failed",
        "checkout.session.expired",
        "refund.created",
        "refund.updated",
        "refund.failed",
      ]);
      if (!allowed.has(input.type)) {
        throw new Error("Stripe event type unsupported");
      }
      const signed = await dependencies.provider.control.createStripeEvent(
        input.type,
        input.objectId,
      );
      const handler = dependencies.handlers["stripe-webhook"];
      if (!handler) throw new Error("Stripe webhook handler unavailable");
      const response = await handler(
        new Request("http://127.0.0.1:55647/functions/v1/stripe-webhook", {
          method: "POST",
          headers: {
            "stripe-signature": signed.signature,
            "content-type": "application/json",
          },
          body: JSON.stringify(signed.event),
        }),
      );
      return safeJson({
        outcome: response.ok ? "accepted" : "rejected",
        eventId: signed.event.id,
        handlerStatus: response.status,
      }, response.ok ? 200 : 502);
    }
    if (input.action === "inbox") {
      const state = await dependencies.provider.control.snapshot();
      return safeJson({ messages: state.email.messages });
    }
    if (input.action === "state") {
      return safeJson(
        sanitizedState(await dependencies.provider.control.snapshot()),
      );
    }
    return safeJson({ error: "unknown control action" }, 400);
  } catch (error) {
    return safeJson({
      error: error instanceof Error ? error.message : "control failed",
    }, 400);
  }
}

function sanitizedState(state: ProviderState): Record<string, unknown> {
  return {
    version: state.version,
    stripe: {
      accountMode: state.stripe.accountMode,
      checkoutCreateMode: state.stripe.checkoutCreateMode,
      refundMode: state.stripe.refundMode,
      accountIds: Object.keys(state.stripe.accounts),
      accountSessionIds: Object.keys(state.stripe.accountSessions),
      checkoutSessionIds: Object.keys(state.stripe.checkoutSessions),
      paymentIntentIds: Object.keys(state.stripe.paymentIntents),
      chargeIds: Object.keys(state.stripe.charges),
      applicationFeeIds: Object.keys(state.stripe.applicationFees),
      transferIds: Object.keys(state.stripe.transfers),
      refundIds: Object.keys(state.stripe.refunds),
      eventIds: Object.keys(state.stripe.events),
    },
    email: { mode: state.email.mode, messages: state.email.messages },
    moderation: state.moderation,
  };
}

async function proxy(
  request: Request,
  target: string,
  nativeFetch: typeof fetch,
): Promise<Response> {
  const response = await nativeFetch(target, {
    method: request.method,
    headers: request.headers,
    body: request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer(),
    redirect: "manual",
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function configureEnvironment(
  appOrigin: string,
  secrets: LocalSecrets,
): Promise<ProviderBoundaryConfig> {
  const serviceRoleKey = await jwt(secrets.jwtSecret, {
    role: "service_role",
    iss: "supabase",
    exp: 4_102_444_800,
  });
  const [
    discoveryRateSecret,
    emailRateSecret,
    emailWorkerSecret,
    moderationWorkerToken,
    reportFingerprintSecret,
  ] = await Promise.all([
    purposeSecret(secrets.workerSecret, "discovery-rate", "base64"),
    purposeSecret(secrets.workerSecret, "ticket-email-rate", "base64"),
    purposeSecret(secrets.workerSecret, "ticket-email-worker", "base64url"),
    purposeSecret(secrets.workerSecret, "moderation-worker", "base64url"),
    purposeSecret(secrets.workerSecret, "report-fingerprint", "base64url"),
  ]);
  const values: Record<string, string> = {
    SUPABASE_URL: "http://127.0.0.1:55647",
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    APP_BASE_URL: appOrigin,
    STRIPE_RESTRICTED_KEY: "rk_test_spec14synthetic",
    STRIPE_WEBHOOK_SECRET: "whsec_spec14snapshot",
    STRIPE_THIN_WEBHOOK_SECRET: "whsec_spec14thin",
    TICKET_CREDENTIAL_SECRET: secrets.credentialSecret,
    DISCOVERY_RATE_SECRET: discoveryRateSecret,
    DISCOVERY_TRUSTED_IP_HEADER: "x-spec14-client-ip",
    DISCOVERY_TRUSTED_IP_HEADER_VERIFIED: "true",
    TICKET_EMAIL_RATE_SECRET: emailRateSecret,
    TICKET_EMAIL_TRUSTED_IP_HEADER: "x-spec14-client-ip",
    TICKET_EMAIL_PUBLIC_ENABLED: "true",
    TICKET_EMAIL_PAYLOAD_KEY_ID: "spec14",
    TICKET_EMAIL_PAYLOAD_KEYS_JSON: JSON.stringify({
      spec14: secrets.emailKey,
    }),
    TICKET_EMAIL_WORKER_SECRET: emailWorkerSecret,
    TICKET_EMAIL_WORKER_ENABLED: "true",
    TICKET_EMAIL_FROM: "Whereto Local <tickets@spec14.invalid>",
    TICKET_EMAIL_SUPPORT_EMAIL: "support@spec14.invalid",
    RESEND_API_KEY: "re_spec14synthetic",
    RESEND_WEBHOOK_SECRET: `whsec_${secrets.emailKey}`,
    MODERATION_WORKER_TOKEN: moderationWorkerToken,
    REPORT_FINGERPRINT_SECRET: reportFingerprintSecret,
    CONTEXTUAL_MODERATION_ENDPOINT:
      "https://moderation.spec14.invalid/evaluate",
    CONTEXTUAL_MODERATION_BEARER_TOKEN: "spec14-synthetic-moderation-token",
  };
  for (const [name, value] of Object.entries(values)) Deno.env.set(name, value);
  return {
    gatewayOrigin: values.SUPABASE_URL,
    restOrigin: "http://127.0.0.1:55646",
    authOrigin: "http://127.0.0.1:55648",
    stripeWebhookSecret: values.STRIPE_WEBHOOK_SECRET,
    resendEndpoint: "https://api.resend.com/emails",
    moderationEndpoint: values.CONTEXTUAL_MODERATION_ENDPOINT,
  };
}

async function main(): Promise<void> {
  const root = decodeURIComponent(
    new URL("../../../../", import.meta.url).pathname,
  ).replace(/\/$/, "");
  const identity = validateHarnessIdentity(
    JSON.parse(
      await Deno.readTextFile(
        `${root}/.superpowers/spec14/environment-identity.json`,
      ),
    ),
    root,
  );
  const secrets = validateSecrets(
    JSON.parse(
      await Deno.readTextFile(`${root}/.superpowers/spec14/local-secrets.json`),
    ),
  );
  const appOrigin = Deno.args[0] ?? "http://127.0.0.1:3033";
  const parsedOrigin = new URL(appOrigin);
  if (
    parsedOrigin.protocol !== "http:" ||
    parsedOrigin.hostname !== "127.0.0.1" || parsedOrigin.origin !== appOrigin
  ) {
    throw new Error("Spec14 app origin must be an exact loopback HTTP origin");
  }
  const providerConfig = await configureEnvironment(appOrigin, secrets);
  const store = new FileProviderStore(
    `${root}/.superpowers/spec14/provider-state.json`,
  );
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const provider = createProviderBoundary(providerConfig, store, nativeFetch);
  globalThis.fetch = provider.fetch;
  const handlers = await loadProductionHandlers();
  const gateway = createGatewayHandler({
    appOrigin,
    workerSecret: secrets.workerSecret,
    handlers,
    provider,
    nativeFetch,
  });
  console.log(
    JSON.stringify({
      status: "ready",
      task: identity.task,
      instanceId: identity.instanceId,
      port: 55647,
      functions: Object.keys(handlers).length,
    }),
  );
  Deno.serve({ hostname: "127.0.0.1", port: 55647 }, gateway);
}

function validateSecrets(value: unknown): LocalSecrets {
  if (!record(value)) throw new Error("Spec14 local secrets are invalid");
  for (
    const name of [
      "password",
      "jwtSecret",
      "credentialSecret",
      "emailKey",
      "workerSecret",
    ] as const
  ) {
    if (typeof value[name] !== "string" || value[name].length < 32) {
      throw new Error("Spec14 local secrets are invalid");
    }
  }
  return value as unknown as LocalSecrets;
}

async function jwt(
  secret: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const encode = (value: unknown) =>
    base64Url(new TextEncoder().encode(JSON.stringify(value)));
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return `${body}.${
    base64Url(
      new Uint8Array(
        await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
      ),
    )
  }`;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll(
    "/",
    "_",
  ).replaceAll("=", "");
}
async function purposeSecret(
  master: string,
  label: string,
  format: "base64" | "base64url",
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(master),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`whereto:spec14:${label}`),
    ),
  );
  return format === "base64"
    ? btoa(String.fromCharCode(...bytes))
    : base64Url(bytes);
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function isOneOf<const T extends readonly string[]>(
  value: unknown,
  values: T,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}
function safeJson(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

if (import.meta.main) await main();
