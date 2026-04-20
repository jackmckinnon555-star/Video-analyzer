import type { Entity, KeyQuote } from "@shared/types/video";
import { formatTimestamp } from "../lib/format";

export function InsightsSidebar({
  entities,
  keywords,
  keyQuotes,
  onJump,
}: {
  entities: Entity[] | null;
  keywords: string[] | null;
  keyQuotes: KeyQuote[] | null;
  onJump?: (seconds: number) => void;
}) {
  const hasAny =
    (entities?.length ?? 0) +
      (keywords?.length ?? 0) +
      (keyQuotes?.length ?? 0) >
    0;
  if (!hasAny) return null;

  return (
    <aside className="flex flex-col gap-6 rounded-md border border-neutral-200 bg-white p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
      {keywords && keywords.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Keywords
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {keywords.map((k) => (
              <span
                key={k}
                className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
              >
                {k}
              </span>
            ))}
          </div>
        </section>
      )}

      {entities && entities.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Entities
          </h3>
          <ul className="flex flex-col gap-1">
            {entities.map((e, i) => (
              <li key={`${e.name}-${i}`} className="flex items-baseline justify-between gap-2">
                <span className="truncate">
                  <span className="font-medium">{e.name}</span>
                  <span className="ml-1.5 text-xs text-neutral-500">{e.type}</span>
                </span>
                <span className="shrink-0 font-mono text-xs text-neutral-400">
                  ×{e.mentions}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {keyQuotes && keyQuotes.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Key quotes
          </h3>
          <ul className="flex flex-col gap-3">
            {keyQuotes.map((q, i) => (
              <li key={i}>
                <button
                  onClick={() => onJump?.(q.timestamp_seconds)}
                  className="group block w-full text-left"
                >
                  <span className="block text-xs text-neutral-500 group-hover:text-neutral-900 dark:group-hover:text-neutral-100">
                    {formatTimestamp(q.timestamp_seconds)}
                    {q.speaker && <span className="ml-1.5">· {q.speaker}</span>}
                  </span>
                  <span className="mt-0.5 block italic text-neutral-700 dark:text-neutral-300">
                    “{q.text}”
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
