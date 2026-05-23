type LogLevel = "debug" | "info" | "warn" | "error";

type Fields = Record<string, unknown>;

const SERVICE = "activity-merger";

function emit(level: LogLevel, scope: string, msg: string, fields: Fields = {}): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    service: SERVICE,
    scope,
    msg,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  if ((level === "error" || level === "warn") && process.env.SLACK_WEBHOOK_URL) {
    import("./slack")
      .then(({ postSlackAlert }) =>
        postSlackAlert({
          title: `${level === "error" ? "Error" : "Warning"} in ${scope}`,
          scope,
          msg,
          level,
          fields,
        })
      )
      .catch(() => {});
  }
}

export function logger(scope: string) {
  return {
    debug: (msg: string, fields?: Fields) => emit("debug", scope, msg, fields),
    info: (msg: string, fields?: Fields) => emit("info", scope, msg, fields),
    warn: (msg: string, fields?: Fields) => emit("warn", scope, msg, fields),
    error: (msg: string, fields?: Fields) => emit("error", scope, msg, fields),
  };
}

export type Logger = ReturnType<typeof logger>;
