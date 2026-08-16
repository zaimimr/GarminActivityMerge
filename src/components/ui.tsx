"use client";

import type { ReactNode } from "react";

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled,
  busy,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  busy?: boolean;
  className?: string;
}) {
  const styles = {
    primary: "bg-accent text-white hover:bg-[#4d95ea] disabled:hover:bg-accent",
    secondary: "bg-surface-3 text-ink hover:bg-[#282d36] border border-line",
    ghost: "text-ink-2 hover:text-ink hover:bg-surface-2",
    danger: "bg-critical text-white hover:bg-[#dc5252]",
  }[variant];

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-surface-1 ${className}`}>{children}</div>
  );
}

export function Callout({
  tone,
  title,
  children,
}: {
  tone: "info" | "warning" | "danger" | "success";
  title: string;
  children?: ReactNode;
}) {
  const styles = {
    info: { ring: "border-line", dot: "bg-accent", text: "text-ink" },
    warning: { ring: "border-[#4a3c15]", dot: "bg-warning", text: "text-ink" },
    danger: { ring: "border-[#4d2020]", dot: "bg-critical", text: "text-ink" },
    success: { ring: "border-[#17401a]", dot: "bg-good", text: "text-ink" },
  }[tone];

  return (
    <div className={`rounded-xl border bg-surface-1 p-4 ${styles.ring}`}>
      <div className="flex gap-3">
        <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${styles.dot}`} />
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${styles.text}`}>{title}</p>
          {children && <div className="mt-1 text-sm text-ink-2">{children}</div>}
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "mt-1.5 w-full rounded-lg border border-line bg-surface-2 px-3.5 py-2.5 text-ink placeholder:text-ink-3 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

export function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-ink-3">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${accent ? "text-accent-ink" : "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}

export function ErrorPanel({
  error,
  onDismiss,
}: {
  error: {
    title?: string;
    hint?: string;
    code?: string;
    message: string;
    steps?: { step: string; status: "ok" | "failed" | "skipped"; detail?: string }[];
  };
  onDismiss?: () => void;
}) {
  return (
    <div className="rounded-xl border border-[#4d2020] bg-surface-1 p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-critical" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{error.title ?? "Something went wrong."}</p>
          {error.hint && <p className="mt-1 text-sm text-ink-2">{error.hint}</p>}
          {error.steps && error.steps.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-l border-line pl-3">
              {error.steps.map((step, i) => (
                <li key={i} className="flex gap-2 text-xs">
                  <span
                    aria-hidden
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      step.status === "ok" ? "bg-good" : step.status === "failed" ? "bg-critical" : "bg-ink-3"
                    }`}
                  />
                  <span className="text-ink-2">
                    <span className="font-medium text-ink capitalize">{step.step}</span>
                    {step.detail ? ` — ${step.detail}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-ink-3 hover:text-ink-2">
              Technical detail{error.code ? ` (${error.code})` : ""}
            </summary>
            <p className="mt-1.5 font-mono text-xs break-words text-ink-3">{error.message}</p>
          </details>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            className="shrink-0 rounded-md px-2 py-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
