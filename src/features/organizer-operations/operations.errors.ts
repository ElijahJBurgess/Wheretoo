// Only safe categories cross the UI boundary; provider/database messages never do.
export class OperationsReadError extends Error {
  constructor(message: string, readonly accessDenied = false) { super(message) }
}
export function isOperationsAccessDenied(error: unknown): boolean {
  return error instanceof OperationsReadError && error.accessDenied
}
