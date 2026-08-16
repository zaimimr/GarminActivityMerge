import { AppError } from "@/lib/errors";

/**
 * Minimal cookie jar. Garmin's SSO flow hands out a handful of cookies
 * (GARMIN-SSO, GARMIN-SSO-GUID, SESSIONID, ...) across four requests and only
 * issues a login ticket if all of them come back. Node's fetch has no jar, so
 * this keeps a name -> value map and replays it as a single Cookie header.
 */
export class CookieJar {
  private jar: Map<string, string>;

  constructor(init: Record<string, string> = {}) {
    this.jar = new Map(Object.entries(init));
  }

  absorb(headers: Headers): void {
    const setCookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
    for (const raw of setCookies) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq < 1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === "" || value === '""') this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  header(): string {
    return Array.from(this.jar.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries(this.jar.entries());
  }

  get size(): number {
    return this.jar.size;
  }
}

export const USER_AGENT_BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
export const USER_AGENT_MOBILE = "com.garmin.android.apps.connectmobile";

export type JarResponse = {
  status: number;
  url: string;
  headers: Headers;
  body: Response;
};

/**
 * fetch() with manual redirect handling so that Set-Cookie headers on 302 hops
 * aren't dropped, plus network errors that say which host actually failed
 * instead of a bare "TypeError: fetch failed".
 */
export async function jarFetch(
  jar: CookieJar,
  url: string,
  init: RequestInit & { maxRedirects?: number } = {}
): Promise<JarResponse> {
  const maxRedirects = init.maxRedirects ?? 6;
  let currentUrl = url;
  let currentInit: RequestInit = { ...init, redirect: "manual" };

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const headers = new Headers(currentInit.headers ?? {});
    const cookie = jar.header();
    if (cookie) headers.set("Cookie", cookie);
    if (!headers.has("User-Agent")) headers.set("User-Agent", USER_AGENT_BROWSER);

    let res: Response;
    try {
      res = await fetch(currentUrl, { ...currentInit, headers, redirect: "manual" });
    } catch (e) {
      throw networkError(currentUrl, e);
    }
    jar.absorb(res.headers);

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      currentUrl = new URL(location, currentUrl).toString();
      // Per RFC 7231 a 303 (and in practice 301/302 after POST) becomes a GET.
      const method = (currentInit.method ?? "GET").toUpperCase();
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
        currentInit = { ...currentInit, method: "GET", body: undefined };
      }
      continue;
    }

    return { status: res.status, url: currentUrl, headers: res.headers, body: res };
  }

  throw new AppError({
    code: "NETWORK",
    title: "Garmin sent us in circles.",
    message: `Too many redirects starting at ${url}`,
    hint: "Garmin's login flow may have changed. Try again in a few minutes.",
  });
}

export function networkError(url: string, cause: unknown): AppError {
  const host = safeHost(url);
  const detail = cause instanceof Error ? (causeChain(cause) ?? cause.message) : String(cause);
  return new AppError({
    code: "NETWORK",
    title: `Could not reach ${host}.`,
    message: `Network request to ${url} failed: ${detail}`,
    hint: "Garmin may be down, or this server has no outbound access to garmin.com. Try again shortly.",
    status: 502,
    cause,
  });
}

function causeChain(e: Error): string | null {
  const parts: string[] = [e.message];
  let cause: unknown = (e as Error & { cause?: unknown }).cause;
  let depth = 0;
  while (cause instanceof Error && depth < 4) {
    parts.push(cause.message);
    cause = (cause as Error & { cause?: unknown }).cause;
    depth++;
  }
  return parts.length > 1 ? parts.join(" -> ") : null;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
