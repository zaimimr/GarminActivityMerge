export type ErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_EXPIRED"
  | "BAD_CREDENTIALS"
  | "MFA_REQUIRED"
  | "MFA_INVALID"
  | "LOGIN_FLOW_CHANGED"
  | "ACTIVITY_NOT_FOUND"
  | "ACTIVITY_NOT_FIT"
  | "MERGE_FAILED"
  | "DEDUP_REJECTED"
  | "UPLOAD_FAILED"
  | "DELETE_FAILED"
  | "RATE_LIMITED"
  | "NETWORK"
  | "VALIDATION"
  | "INTERNAL";

export type CategorizedError = {
  code: ErrorCode;
  title: string;
  hint?: string;
  status: number;
};

export class AppError extends Error {
  code: ErrorCode;
  title: string;
  hint?: string;
  status: number;

  constructor(opts: {
    code: ErrorCode;
    title: string;
    message?: string;
    hint?: string;
    status?: number;
    cause?: unknown;
  }) {
    super(opts.message ?? opts.title, { cause: opts.cause });
    this.name = "AppError";
    this.code = opts.code;
    this.title = opts.title;
    this.hint = opts.hint;
    this.status = opts.status ?? 500;
  }
}

export function categorize(raw: unknown): CategorizedError {
  if (raw instanceof AppError) {
    return { code: raw.code, title: raw.title, hint: raw.hint, status: raw.status };
  }

  const msg = raw instanceof Error ? raw.message : String(raw);
  const m = msg.toLowerCase();

  if (m.includes("fetch failed") || m.includes("econnreset") || m.includes("etimedout") || m.includes("enotfound")) {
    return {
      code: "NETWORK",
      title: "Network error talking to Garmin.",
      hint: "Usually transient. Try again in a minute.",
      status: 502,
    };
  }
  if (m.includes("duplicate") || m.includes("409")) {
    return {
      code: "DEDUP_REJECTED",
      title: "Garmin rejected the upload as a duplicate.",
      hint: "Garmin thinks this activity already exists. Import your downloaded originals to restore them.",
      status: 409,
    };
  }
  if (m.includes("not a fit file")) {
    return {
      code: "ACTIVITY_NOT_FIT",
      title: "That activity has no FIT recording.",
      hint: "Manually entered activities have nothing to merge.",
      status: 422,
    };
  }
  if (m.includes("401") || m.includes("unauthorized") || m.includes("expired")) {
    return {
      code: "AUTH_EXPIRED",
      title: "Your Garmin session expired.",
      hint: "Sign in again to continue.",
      status: 401,
    };
  }

  return {
    code: "INTERNAL",
    title: "Something went wrong.",
    hint: "The details below are the raw error. Nothing on Garmin was changed unless the step log says otherwise.",
    status: 500,
  };
}

/** Shape every API route returns on failure, so the UI can render it consistently. */
export function errorPayload(raw: unknown): {
  error: string;
  code: ErrorCode;
  title: string;
  hint?: string;
  status: number;
} {
  const cat = categorize(raw);
  return {
    error: raw instanceof Error ? raw.message : String(raw),
    code: cat.code,
    title: cat.title,
    hint: cat.hint,
    status: cat.status,
  };
}
