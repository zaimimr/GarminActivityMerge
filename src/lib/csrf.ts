import { cookies } from "next/headers";
import { randomBytes } from "crypto";

const COOKIE = "ae_csrf";
const HEADER = "x-csrf-token";

export async function ensureCsrfCookie(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
  if (existing) return existing;
  const token = randomBytes(24).toString("hex");
  jar.set(COOKIE, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return token;
}

export async function verifyCsrf(headerToken: string | null): Promise<boolean> {
  if (!headerToken) return false;
  const jar = await cookies();
  const cookieToken = jar.get(COOKIE)?.value;
  if (!cookieToken) return false;
  if (cookieToken.length !== headerToken.length) return false;
  let mismatch = 0;
  for (let i = 0; i < cookieToken.length; i++) {
    mismatch |= cookieToken.charCodeAt(i) ^ headerToken.charCodeAt(i);
  }
  return mismatch === 0;
}

export function csrfRejection(): Response {
  return new Response(
    JSON.stringify({
      error: "CSRF token missing or invalid",
      code: "VALIDATION",
      title: "Request blocked.",
      hint: "Reload the page and try again.",
    }),
    { status: 403, headers: { "Content-Type": "application/json" } }
  );
}

export const CSRF_HEADER = HEADER;
