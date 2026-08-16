import { cookies } from "next/headers";
import { createHash } from "crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import type { GarminSession } from "./garmin/types";
import type { MfaChallenge } from "./garmin/auth";

const SESSION_COOKIE = "gm_session";
const MFA_COOKIE = "gm_mfa";
/** Cookies cap at 4096 bytes including name and attributes; leave headroom. */
const CHUNK_SIZE = 3200;
const MAX_CHUNKS = 8;

const SESSION_TTL = "12h";
const MFA_TTL = "10m";

function key(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("Missing SESSION_SECRET");
  return new Uint8Array(createHash("sha256").update(s).digest());
}

async function seal(payload: Record<string, unknown>, ttl: string): Promise<string> {
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .encrypt(key());
}

async function unseal<T>(token: string): Promise<T | null> {
  try {
    const { payload } = await jwtDecrypt(token, key());
    return payload as T;
  } catch {
    return null;
  }
}

/**
 * Nothing is stored server-side, so the whole Garmin session rides in an
 * encrypted httpOnly cookie. No Max-Age is set on purpose: it's a browser
 * session cookie, so closing the browser signs you out.
 */
async function writeChunked(name: string, value: string): Promise<void> {
  const jar = await cookies();
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    chunks.push(value.slice(i, i + CHUNK_SIZE));
  }
  if (chunks.length > MAX_CHUNKS) {
    throw new Error(`Sealed cookie ${name} too large (${value.length} bytes)`);
  }
  chunks.forEach((chunk, i) => {
    jar.set(`${name}.${i}`, chunk, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
  });
  for (let i = chunks.length; i < MAX_CHUNKS; i++) {
    if (jar.get(`${name}.${i}`)) jar.delete(`${name}.${i}`);
  }
}

async function readChunked(name: string): Promise<string | null> {
  const jar = await cookies();
  const parts: string[] = [];
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const part = jar.get(`${name}.${i}`)?.value;
    if (part === undefined) break;
    parts.push(part);
  }
  return parts.length > 0 ? parts.join("") : null;
}

async function clearChunked(name: string): Promise<void> {
  const jar = await cookies();
  for (let i = 0; i < MAX_CHUNKS; i++) {
    if (jar.get(`${name}.${i}`)) jar.delete(`${name}.${i}`);
  }
}

export async function setGarminSession(session: GarminSession): Promise<void> {
  await writeChunked(SESSION_COOKIE, await seal({ g: session }, SESSION_TTL));
}

export async function readGarminSession(): Promise<GarminSession | null> {
  const raw = await readChunked(SESSION_COOKIE);
  if (!raw) return null;
  const payload = await unseal<{ g?: GarminSession }>(raw);
  return payload?.g ?? null;
}

export async function clearGarminSession(): Promise<void> {
  await clearChunked(SESSION_COOKIE);
  await clearChunked(MFA_COOKIE);
}

export async function setMfaChallenge(challenge: MfaChallenge): Promise<void> {
  await writeChunked(MFA_COOKIE, await seal({ m: challenge }, MFA_TTL));
}

export async function readMfaChallenge(): Promise<MfaChallenge | null> {
  const raw = await readChunked(MFA_COOKIE);
  if (!raw) return null;
  const payload = await unseal<{ m?: MfaChallenge }>(raw);
  return payload?.m ?? null;
}

export async function clearMfaChallenge(): Promise<void> {
  await clearChunked(MFA_COOKIE);
}
