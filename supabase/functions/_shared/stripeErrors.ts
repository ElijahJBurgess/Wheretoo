import { HttpError, jsonResponse } from "./http.ts";

export function safeErrorResponse(
  error: unknown,
  headers?: HeadersInit,
): Response {
  if (error instanceof HttpError) {
    return jsonResponse({ error: { code: error.code } }, error.status, headers);
  }

  return jsonResponse({ error: { code: "INTERNAL_ERROR" } }, 500, headers);
}
