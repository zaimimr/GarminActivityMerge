import { createHmac } from "crypto";
import OAuth from "oauth-1.0a";
import { AppError } from "@/lib/errors";
import { CookieJar, jarFetch, networkError, USER_AGENT_BROWSER, USER_AGENT_MOBILE } from "./http";
import type { GarminTokens, OAuth1Token } from "./types";

const SSO_ORIGIN = "https://sso.garmin.com";
const SSO = `${SSO_ORIGIN}/sso`;
const SSO_EMBED = `${SSO}/embed`;
const API_ORIGIN = "https://connectapi.garmin.com";
const OAUTH_CONSUMER_URL = "https://thegarth.s3.amazonaws.com/oauth_consumer.json";

const EMBED_PARAMS = {
  id: "gauth-widget",
  embedWidget: "true",
  gauthHost: SSO,
};

const SIGNIN_PARAMS = {
  ...EMBED_PARAMS,
  gauthHost: SSO_EMBED,
  service: SSO_EMBED,
  source: SSO_EMBED,
  redirectAfterAccountLoginUrl: SSO_EMBED,
  redirectAfterAccountCreationUrl: SSO_EMBED,
};

const CSRF_RE = /name="_csrf"\s+value="([^"]+)"/;
const TICKET_RE = /embed\?ticket=([^"]+)"/;
const TITLE_RE = /<title>(.+?)<\/title>/is;

/** Everything needed to resume a login that stopped at the MFA prompt. */
export type MfaChallenge = {
  cookies: Record<string, string>;
  csrf: string;
  referer: string;
};

export type LoginResult =
  | { status: "ok"; tokens: GarminTokens }
  | { status: "mfa_required"; challenge: MfaChallenge };

function url(base: string, params: Record<string, string>): string {
  return `${base}?${new URLSearchParams(params).toString()}`;
}

/**
 * Step 1-3 of Garmin's SSO: prime cookies, read the CSRF token off the signin
 * page, then post credentials. Ends with either a login ticket or an MFA prompt.
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  const jar = new CookieJar();

  await jarFetch(jar, url(SSO_EMBED, EMBED_PARAMS), {
    headers: { Accept: "text/html,application/xhtml+xml" },
  });

  const signinUrl = url(`${SSO}/signin`, SIGNIN_PARAMS);
  const signinPage = await jarFetch(jar, signinUrl, {
    headers: { Accept: "text/html,application/xhtml+xml", Referer: SSO_EMBED },
  });
  const signinHtml = await readText(signinPage.body, signinUrl);
  const csrf = extractCsrf(signinHtml, "sign-in page");

  const form = new URLSearchParams({
    username: email,
    password,
    embed: "true",
    _csrf: csrf,
  });
  const posted = await jarFetch(jar, signinUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html,application/xhtml+xml",
      Referer: signinUrl,
      Origin: SSO_ORIGIN,
    },
    body: form.toString(),
  });
  const html = await readText(posted.body, signinUrl);

  if (needsMfa(html)) {
    return {
      status: "mfa_required",
      challenge: {
        cookies: jar.toJSON(),
        csrf: extractCsrf(html, "MFA page"),
        referer: posted.url,
      },
    };
  }

  const ticket = TICKET_RE.exec(html)?.[1];
  if (!ticket) throw loginRejected(html);

  return { status: "ok", tokens: await exchangeTicket(ticket) };
}

/** Step 4: submit the one-time code Garmin emailed / texted. */
export async function submitMfaCode(challenge: MfaChallenge, code: string): Promise<GarminTokens> {
  const jar = new CookieJar(challenge.cookies);
  const verifyUrl = url(`${SSO}/verifyMFA/loginEnterMfaCode`, SIGNIN_PARAMS);

  const form = new URLSearchParams({
    "mfa-code": code,
    embed: "true",
    _csrf: challenge.csrf,
    fromPage: "setupEnterMfaCode",
  });
  const res = await jarFetch(jar, verifyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html,application/xhtml+xml",
      Referer: challenge.referer,
      Origin: SSO_ORIGIN,
    },
    body: form.toString(),
  });
  const html = await readText(res.body, verifyUrl);

  const ticket = TICKET_RE.exec(html)?.[1];
  if (!ticket) {
    if (needsMfa(html)) {
      throw new AppError({
        code: "MFA_INVALID",
        title: "That code didn't work.",
        message: "Garmin re-served the MFA prompt after the code was submitted.",
        hint: "Codes expire after a few minutes. Request a fresh one by signing in again.",
        status: 401,
      });
    }
    throw loginRejected(html);
  }

  return exchangeTicket(ticket);
}

/** Steps 5-6: ticket -> OAuth1 token -> OAuth2 bearer token. */
async function exchangeTicket(ticket: string): Promise<GarminTokens> {
  const oauth1 = await getOAuth1Token(ticket);
  const oauth2 = await exchangeForOAuth2(oauth1);
  return { oauth1, ...oauth2 };
}

async function getOAuth1Token(ticket: string): Promise<OAuth1Token> {
  const target = url(`${API_ORIGIN}/oauth-service/oauth/preauthorized`, {
    ticket,
    "login-url": SSO_EMBED,
    "accepts-mfa-tokens": "true",
  });
  const oauth = await oauthClient();
  const auth = oauth.toHeader(oauth.authorize({ url: target, method: "GET" }));

  let res: Response;
  try {
    res = await fetch(target, {
      method: "GET",
      headers: { ...auth, "User-Agent": USER_AGENT_MOBILE },
    });
  } catch (e) {
    throw networkError(target, e);
  }
  if (!res.ok) {
    throw new AppError({
      code: "LOGIN_FLOW_CHANGED",
      title: "Garmin refused the login ticket.",
      message: `preauthorized returned ${res.status}: ${truncate(await res.text().catch(() => ""), 400)}`,
      hint: "Sign in again. If it keeps happening, Garmin has changed its login flow.",
      status: 502,
    });
  }

  const parsed = new URLSearchParams(await res.text());
  const key = parsed.get("oauth_token");
  const secret = parsed.get("oauth_token_secret");
  if (!key || !secret) {
    throw new AppError({
      code: "LOGIN_FLOW_CHANGED",
      title: "Garmin returned an unexpected token response.",
      message: "preauthorized response had no oauth_token/oauth_token_secret",
      status: 502,
    });
  }
  return { key, secret };
}

async function exchangeForOAuth2(
  token: OAuth1Token
): Promise<{ accessToken: string; expiresAt: number }> {
  const target = `${API_ORIGIN}/oauth-service/oauth/exchange/user/2.0`;
  const oauth = await oauthClient();
  const auth = oauth.toHeader(oauth.authorize({ url: target, method: "POST" }, token));

  let res: Response;
  try {
    res = await fetch(target, {
      method: "POST",
      headers: {
        ...auth,
        "User-Agent": USER_AGENT_MOBILE,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "",
    });
  } catch (e) {
    throw networkError(target, e);
  }
  if (!res.ok) {
    throw new AppError({
      code: "LOGIN_FLOW_CHANGED",
      title: "Garmin refused to issue an access token.",
      message: `exchange returned ${res.status}: ${truncate(await res.text().catch(() => ""), 400)}`,
      status: 502,
    });
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new AppError({
      code: "LOGIN_FLOW_CHANGED",
      title: "Garmin returned an unexpected token response.",
      message: "exchange response had no access_token",
      status: 502,
    });
  }
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

/** The OAuth2 bearer expires in ~1h; the OAuth1 token can mint a fresh one. */
export async function refreshAccessToken(
  oauth1: OAuth1Token
): Promise<{ accessToken: string; expiresAt: number }> {
  return exchangeForOAuth2(oauth1);
}

let consumerCache: { key: string; secret: string } | null = null;

async function oauthClient(): Promise<OAuth> {
  const consumer = await getConsumer();
  return new OAuth({
    consumer,
    signature_method: "HMAC-SHA1",
    hash_function(base, key) {
      return createHmac("sha1", key).update(base).digest("base64");
    },
  });
}

/**
 * Garmin's mobile app OAuth1 consumer credentials. They're baked into the
 * Android app; the community mirrors them so clients don't have to. Overridable
 * by env if that mirror ever goes away.
 */
async function getConsumer(): Promise<{ key: string; secret: string }> {
  const envKey = process.env.GARMIN_CONSUMER_KEY;
  const envSecret = process.env.GARMIN_CONSUMER_SECRET;
  if (envKey && envSecret) return { key: envKey, secret: envSecret };
  if (consumerCache) return consumerCache;

  let res: Response;
  try {
    res = await fetch(OAUTH_CONSUMER_URL);
  } catch (e) {
    throw networkError(OAUTH_CONSUMER_URL, e);
  }
  if (!res.ok) {
    throw new AppError({
      code: "LOGIN_FLOW_CHANGED",
      title: "Could not load Garmin's OAuth credentials.",
      message: `${OAUTH_CONSUMER_URL} returned ${res.status}`,
      hint: "Set GARMIN_CONSUMER_KEY and GARMIN_CONSUMER_SECRET to bypass this lookup.",
      status: 502,
    });
  }
  const json = (await res.json()) as { consumer_key?: string; consumer_secret?: string };
  if (!json.consumer_key || !json.consumer_secret) {
    throw new AppError({
      code: "LOGIN_FLOW_CHANGED",
      title: "Garmin's OAuth credentials look malformed.",
      message: "oauth_consumer.json missing consumer_key/consumer_secret",
      status: 502,
    });
  }
  consumerCache = { key: json.consumer_key, secret: json.consumer_secret };
  return consumerCache;
}

function needsMfa(html: string): boolean {
  const title = TITLE_RE.exec(html)?.[1] ?? "";
  return title.toUpperCase().includes("MFA") || html.includes("verifyMFA/loginEnterMfaCode");
}

function extractCsrf(html: string, where: string): string {
  const csrf = CSRF_RE.exec(html)?.[1];
  if (!csrf) {
    throw new AppError({
      code: "LOGIN_FLOW_CHANGED",
      title: "Garmin's sign-in page looks different than expected.",
      message: `No _csrf token found on the ${where}.`,
      hint: "Garmin changed their login flow; the sign-in code needs updating.",
      status: 502,
    });
  }
  return csrf;
}

function loginRejected(html: string): AppError {
  const lower = html.toLowerCase();
  if (lower.includes("locked") || lower.includes("too many")) {
    return new AppError({
      code: "BAD_CREDENTIALS",
      title: "Garmin has temporarily locked sign-in.",
      message: "Garmin returned an account-locked / rate-limited response.",
      hint: "Wait 15 minutes, or sign in on garmin.com to clear the lock.",
      status: 429,
    });
  }
  if (lower.includes("error-message") || lower.includes("invalid") || lower.includes("incorrect")) {
    return new AppError({
      code: "BAD_CREDENTIALS",
      title: "Garmin rejected those credentials.",
      message: "Sign-in page returned without a login ticket.",
      hint: "Check the email and password you use on connect.garmin.com.",
      status: 401,
    });
  }
  return new AppError({
    code: "LOGIN_FLOW_CHANGED",
    title: "Sign-in did not complete.",
    message: "Garmin returned a page with no login ticket and no recognisable error.",
    hint: "Either the credentials were wrong or Garmin changed their login flow.",
    status: 502,
  });
}

async function readText(res: Response, target: string): Promise<string> {
  try {
    return await res.text();
  } catch (e) {
    throw networkError(target, e);
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}

export const __test__ = { needsMfa, extractCsrf, TICKET_RE, USER_AGENT_BROWSER };
