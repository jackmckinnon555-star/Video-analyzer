export const log = {
  info: (msg: string, extra?: Record<string, unknown>) =>
    console.log(JSON.stringify({ level: "info", msg, ...extra, ts: new Date().toISOString() })),
  warn: (msg: string, extra?: Record<string, unknown>) =>
    console.warn(JSON.stringify({ level: "warn", msg, ...extra, ts: new Date().toISOString() })),
  error: (msg: string, extra?: Record<string, unknown>) =>
    console.error(JSON.stringify({ level: "error", msg, ...extra, ts: new Date().toISOString() })),
};
