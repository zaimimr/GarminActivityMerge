function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)ae_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function fetchWithCsrf(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return fetch(input, init);
  }
  const token = readCsrfCookie();
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set("x-csrf-token", token);
  return fetch(input, { ...init, headers });
}
