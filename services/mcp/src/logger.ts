export type LogLevel = "debug" | "info" | "warn" | "error";

const priority: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function configuredLevel(): LogLevel {
  const value = process.env.LOG_LEVEL;
  return value === "debug" || value === "warn" || value === "error" ? value : "info";
}

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  if (priority[level] < priority[configuredLevel()]) return;
  const record = {
    timestamp: new Date().toISOString(),
    level,
    service: "project-ambient-mcp",
    event,
    ...fields,
  };
  process.stderr.write(`${JSON.stringify(record)}\n`);
}
