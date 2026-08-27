import { getAppBaseUrl } from "./env.ts";
import { jsonResponse } from "./http.ts";

const ALLOWED_HEADERS = "authorization, content-type, x-client-info, apikey";
const ALLOWED_METHODS = "POST, OPTIONS";

export function getCorsHeaders(
  request: Request,
  appOrigin = getAppBaseUrl(),
): Headers {
  const headers = new Headers({ Vary: "Origin" });
  const requestOrigin = request.headers.get("origin");

  if (requestOrigin === appOrigin) {
    headers.set("access-control-allow-origin", appOrigin);
    headers.set("access-control-allow-headers", ALLOWED_HEADERS);
    headers.set("access-control-allow-methods", ALLOWED_METHODS);
    headers.set("access-control-max-age", "600");
  }

  return headers;
}

export function hasExactCorsOrigin(
  request: Request,
  appOrigin = getAppBaseUrl(),
): boolean {
  return request.headers.get("origin") === appOrigin;
}

export function handleCorsPreflight(
  request: Request,
  appOrigin = getAppBaseUrl(),
): Response | null {
  if (request.method !== "OPTIONS") return null;

  const headers = getCorsHeaders(request, appOrigin);
  if (!hasExactCorsOrigin(request, appOrigin)) {
    return jsonResponse(
      { error: { code: "CORS_ORIGIN_DENIED" } },
      403,
      headers,
    );
  }

  return new Response(null, { status: 204, headers });
}
