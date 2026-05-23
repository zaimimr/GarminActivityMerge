export type ErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_EXPIRED"
  | "PLATFORM_NOT_CONNECTED"
  | "ACTIVITY_NOT_FOUND"
  | "ACTIVITY_NOT_FIT"
  | "DEDUP_REJECTED"
  | "UPLOAD_FAILED"
  | "DELETE_FAILED"
  | "RATE_LIMITED"
  | "NETWORK"
  | "VALIDATION"
  | "STORAGE"
  | "INTERNAL";

export type CategorizedError = {
  code: ErrorCode;
  title: string;
  hint?: string;
};

export class AppError extends Error {
  code: ErrorCode;
  title: string;
  hint?: string;
  cause?: unknown;
  status: number;

  constructor(opts: {
    code: ErrorCode;
    title: string;
    message?: string;
    hint?: string;
    status?: number;
    cause?: unknown;
  }) {
    super(opts.message ?? opts.title);
    this.code = opts.code;
    this.title = opts.title;
    this.hint = opts.hint;
    this.cause = opts.cause;
    this.status = opts.status ?? 500;
  }
}

export function categorize(raw: unknown): CategorizedError {
  const msg = raw instanceof Error ? raw.message : String(raw);
  const m = msg.toLowerCase();

  if (raw instanceof AppError) return { code: raw.code, title: raw.title, hint: raw.hint };

  if (m.includes("duplicate activity") || m.includes("(409)")) {
    return {
      code: "DEDUP_REJECTED",
      title: "Platform rejected the upload as a duplicate.",
      hint: "Your originals are safe in storage. Click 'Restore originals' to undo, or try again.",
    };
  }
  if (m.includes("not a fit file")) {
    return {
      code: "ACTIVITY_NOT_FIT",
      title: "One of the activities isn't a FIT-recorded session.",
      hint: "Phone-recorded Strava activities and manual entries don't have a FIT to merge.",
    };
  }
  if (m.includes("404") && m.includes("export_original")) {
    return {
      code: "ACTIVITY_NOT_FOUND",
      title: "Strava could not export the original recording.",
      hint: "Activity may have been phone-recorded. We'll attempt a streams-based fallback.",
    };
  }
  if (m.includes("unauthorized") || m.includes("(401)") || m.includes("invalid_token") || m.includes("expired")) {
    return {
      code: "AUTH_EXPIRED",
      title: "Session with the platform expired.",
      hint: "Disconnect and reconnect from the home screen.",
    };
  }
  if (m.includes("not connected")) {
    return {
      code: "PLATFORM_NOT_CONNECTED",
      title: "Platform not connected.",
      hint: "Connect from the home screen first.",
    };
  }
  if (m.includes("rate limit") || m.includes("(429)")) {
    return {
      code: "RATE_LIMITED",
      title: "Hit the platform's rate limit.",
      hint: "Wait a few minutes and try again.",
    };
  }
  if (m.includes("storage") || m.includes("supabase")) {
    return {
      code: "STORAGE",
      title: "Storage error.",
      hint: "Likely a Supabase config or quota issue. Check the server logs.",
    };
  }
  if (m.includes("network") || m.includes("fetch failed") || m.includes("econnreset") || m.includes("etimedout")) {
    return {
      code: "NETWORK",
      title: "Network error talking to the platform.",
      hint: "Transient; try again. If persistent, check platform status pages.",
    };
  }
  if (m.includes("delete") && m.includes("failed")) {
    return {
      code: "DELETE_FAILED",
      title: "Could not delete the original activity.",
      hint: "The merged upload didn't happen. Originals untouched.",
    };
  }
  if (m.includes("upload")) {
    return {
      code: "UPLOAD_FAILED",
      title: "Upload of the merged activity failed.",
      hint: "Originals are safe in storage. Use the Restore button to put them back if needed.",
    };
  }
  return {
    code: "INTERNAL",
    title: "Something went wrong.",
    hint: "Check the server log line for the job ID below.",
  };
}
