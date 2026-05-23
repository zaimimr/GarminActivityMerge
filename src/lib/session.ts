import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { supabaseAdmin } from "./supabase";

const COOKIE = "ae_session";
const ALG = "HS256";

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("Missing SESSION_SECRET");
  return new TextEncoder().encode(s);
}

export async function signSession(userId: string): Promise<string> {
  return await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function readSession(): Promise<{ userId: string } | null> {
  const jar = await cookies();
  const tok = jar.get(COOKIE)?.value;
  if (!tok) return null;
  try {
    const { payload } = await jwtVerify(tok, secret());
    return { userId: payload.uid as string };
  } catch {
    return null;
  }
}

export async function setSessionCookie(userId: string): Promise<void> {
  const jar = await cookies();
  const tok = await signSession(userId);
  jar.set(COOKIE, tok, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getOrCreateUser(email?: string | null): Promise<string> {
  const sb = supabaseAdmin();
  if (email) {
    const { data } = await sb.from("users").select("id").eq("email", email).maybeSingle();
    if (data?.id) return data.id;
    const { data: ins, error } = await sb
      .from("users")
      .insert({ email })
      .select("id")
      .single();
    if (error) throw error;
    return ins.id;
  }
  const { data: ins, error } = await sb
    .from("users")
    .insert({})
    .select("id")
    .single();
  if (error) throw error;
  return ins.id;
}

export async function requireUser(): Promise<string> {
  const s = await readSession();
  if (!s) throw new Response("Unauthorized", { status: 401 });
  return s.userId;
}
