export async function retry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number; factor?: number; label?: string } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const baseMs = opts.baseMs ?? 1000;
  const factor = opts.factor ?? 2;
  const label = opts.label ?? "op";

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) break;
      const delay = baseMs * Math.pow(factor, i) + Math.random() * 250;
      console.warn(`[retry] ${label} failed (attempt ${i + 1}/${attempts}): ${errMsg(err)}. retrying in ${Math.round(delay)}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
