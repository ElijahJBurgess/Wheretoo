import type { OrganizerContext } from "./contracts.ts";
import { getServiceClient } from "./database.ts";
import { HttpError } from "./http.ts";

interface AuthUserResult {
  user: { id: string } | null;
  error: unknown | null;
}

interface OrganizerResult {
  organizer: { id: string } | null;
  error: unknown | null;
}

export interface OrganizerAuthDependencies {
  getUser(accessToken: string): Promise<AuthUserResult>;
  findOrganizerByUserId(userId: string): Promise<OrganizerResult>;
}

function defaultDependencies(): OrganizerAuthDependencies {
  const client = getServiceClient();
  return {
    async getUser(accessToken) {
      const { data, error } = await client.auth.getUser(accessToken);
      return { user: data.user === null ? null : { id: data.user.id }, error };
    },
    async findOrganizerByUserId(userId) {
      const { data, error } = await client
        .from("organizers")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();
      return { organizer: data === null ? null : { id: data.id }, error };
    },
  };
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (match === undefined || match === null) {
    throw new HttpError(401, "AUTH_REQUIRED");
  }
  return match[1];
}

export async function requireOrganizer(
  request: Request,
  dependencies: OrganizerAuthDependencies = defaultDependencies(),
): Promise<OrganizerContext> {
  const token = bearerToken(request);
  const authResult = await dependencies.getUser(token);
  if (authResult.error !== null || authResult.user === null) {
    throw new HttpError(401, "AUTH_REQUIRED");
  }

  const organizerResult = await dependencies.findOrganizerByUserId(
    authResult.user.id,
  );
  if (organizerResult.error !== null) {
    throw new HttpError(500, "INTERNAL_ERROR");
  }
  if (organizerResult.organizer === null) {
    throw new HttpError(404, "ORGANIZER_NOT_FOUND");
  }

  return {
    userId: authResult.user.id,
    organizerId: organizerResult.organizer.id,
  };
}
