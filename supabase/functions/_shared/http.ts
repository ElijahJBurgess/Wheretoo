import type { SafeErrorCode } from "./contracts.ts";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: SafeErrorCode,
  ) {
    super(code);
    this.name = "HttpError";
  }
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("cache-control", "no-store");

  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

export function methodNotAllowed(): never {
  throw new HttpError(405, "METHOD_NOT_ALLOWED");
}
