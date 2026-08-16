import { NextResponse } from "next/server";
import { GarminClient } from "./garmin/client";
import { readGarminSession, setGarminSession } from "./session";
import { AppError, errorPayload } from "./errors";
import { logger } from "./logger";

export async function requireClient(): Promise<GarminClient> {
  const session = await readGarminSession();
  if (!session) {
    throw new AppError({
      code: "AUTH_REQUIRED",
      title: "Sign in to Garmin first.",
      message: "No Garmin session cookie.",
      status: 401,
    });
  }
  return new GarminClient(session);
}

/** Re-seal the cookie if the bearer token was refreshed mid-request. */
export async function persistSession(client: GarminClient): Promise<void> {
  if (client.tokensChanged) await setGarminSession(client.current);
}

export function failure(scope: string, e: unknown, extra: Record<string, unknown> = {}): NextResponse {
  const payload = errorPayload(e);
  logger(scope).error(payload.title, {
    code: payload.code,
    message: payload.error,
    ...extra,
  });
  const { status, ...body } = payload;
  return NextResponse.json({ ...body, ...extra }, { status });
}
