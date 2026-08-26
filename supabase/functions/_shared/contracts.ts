export type SafeErrorCode =
  | "AUTH_REQUIRED"
  | "CORS_ORIGIN_DENIED"
  | "INTERNAL_ERROR"
  | "INVALID_REQUEST"
  | "METHOD_NOT_ALLOWED"
  | "ORGANIZER_NOT_FOUND"
  | "STRIPE_REQUEST_FAILED"
  | "UNSAFE_STRIPE_MODE";

export interface OrganizerContext {
  userId: string;
  organizerId: string;
}

export type PersistedCapabilityStatus =
  | "inactive"
  | "pending"
  | "active"
  | "restricted";

export type PersistedRequirementsStatus =
  | "not_started"
  | "pending"
  | "action_required"
  | "restricted"
  | "clear";

export interface ConnectStatusProjection {
  transfersStatus: PersistedCapabilityStatus;
  payoutsStatus: PersistedCapabilityStatus;
  requirementsStatus: PersistedRequirementsStatus;
  requirementsCurrentlyDueCount: number;
  requirementsPastDueCount: number;
  lastStatusCode: string | null;
}
