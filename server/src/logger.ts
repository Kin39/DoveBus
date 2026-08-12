type Level = "info" | "warn" | "error";

const STREAM: Record<Level, NodeJS.WriteStream> = {
  info: process.stdout,
  warn: process.stderr,
  error: process.stderr,
};

function emit(level: Level, message: string, fields?: Record<string, unknown>): void {
  const time = new Date().toISOString();
  const detail = fields ? ` ${JSON.stringify(fields)}` : "";
  STREAM[level].write(`${time} ${level.toUpperCase()} ${message}${detail}\n`);
}

/**
 * Single place the import/refresh jobs write to, so a systemd unit gets one
 * predictable line format instead of scattered console calls.
 */
export const logger = {
  info: (message: string, fields?: Record<string, unknown>) => emit("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit("error", message, fields),
};

export function formatBytes(bytes: number): string {
  const mega = bytes / 1_000_000;
  return mega >= 1000 ? `${(mega / 1000).toFixed(2)} GB` : `${mega.toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(0)}s`;
}
