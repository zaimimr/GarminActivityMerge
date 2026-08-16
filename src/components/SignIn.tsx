"use client";

import { useState } from "react";
import { Button, Field, inputClass, ErrorPanel } from "./ui";
import { postJson, asApiError, type ApiError } from "@/lib/client-types";

export function SignIn({ onSignedIn }: { onSignedIn: (displayName: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"credentials" | "mfa">("credentials");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<{ mfaRequired: boolean; displayName?: string }>("/api/auth/login", {
        email,
        password,
      });
      if (r.mfaRequired) {
        setStage("mfa");
      } else {
        setPassword("");
        onSignedIn(r.displayName ?? email);
      }
    } catch (e) {
      setError(asApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<{ displayName: string }>("/api/auth/mfa", { code });
      setPassword("");
      onSignedIn(r.displayName);
    } catch (e) {
      const apiError = asApiError(e);
      setError(apiError);
      if (apiError.code === "MFA_REQUIRED") setStage("credentials");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rise mx-auto w-full max-w-sm">
      <div className="rounded-2xl border border-line bg-surface-1 p-7">
        {stage === "credentials" ? (
          <form onSubmit={submitCredentials} className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-ink">Sign in to Garmin Connect</h2>
              <p className="mt-1.5 text-sm text-ink-2">
                Your credentials go straight to Garmin and are never stored. The session lives in
                an encrypted cookie that dies when you close the browser.
              </p>
            </div>

            <Field label="Garmin Connect email">
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder="you@example.com"
              />
            </Field>

            <Field label="Password">
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                placeholder="••••••••"
              />
            </Field>

            {error && <ErrorPanel error={error} onDismiss={() => setError(null)} />}

            <Button type="submit" busy={busy} className="w-full">
              {busy ? "Signing in" : "Sign in"}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitCode} className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-ink">Enter your verification code</h2>
              <p className="mt-1.5 text-sm text-ink-2">
                Garmin sent a one-time code to the email or phone on your account.
              </p>
            </div>

            <Field label="Verification code" hint="Codes expire after a few minutes.">
              <input
                type="text"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={`${inputClass} font-mono text-lg tracking-[0.3em]`}
                placeholder="000000"
              />
            </Field>

            {error && <ErrorPanel error={error} onDismiss={() => setError(null)} />}

            <div className="flex gap-3">
              <Button
                variant="ghost"
                onClick={() => {
                  setStage("credentials");
                  setCode("");
                  setError(null);
                }}
              >
                Back
              </Button>
              <Button type="submit" busy={busy} className="flex-1">
                {busy ? "Verifying" : "Verify"}
              </Button>
            </div>
          </form>
        )}
      </div>

      <p className="mt-4 px-1 text-xs leading-relaxed text-ink-3">
        This app talks to Garmin Connect through the same private API the mobile app uses. It is
        not affiliated with or endorsed by Garmin.
      </p>
    </div>
  );
}
