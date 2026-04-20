import type { Chapter } from "@shared/types/video";
import { formatTimestamp } from "../lib/format";

export function ChapterList({
  chapters,
  onJump,
}: {
  chapters: Chapter[];
  onJump?: (seconds: number) => void;
}) {
  if (!chapters.length) {
    return <div className="text-sm text-neutral-500">No chapters yet.</div>;
  }
  return (
    <ol className="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
      {chapters.map((c, i) => (
        <li key={i} className="py-3">
          <button
            onClick={() => onJump?.(c.start_seconds)}
            className="group flex w-full items-start gap-3 text-left"
          >
            <span className="mt-0.5 w-16 shrink-0 font-mono text-xs text-neutral-500 group-hover:text-neutral-900 dark:group-hover:text-neutral-100">
              {formatTimestamp(c.start_seconds)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{c.title}</span>
              <span className="mt-0.5 block text-sm text-neutral-600 dark:text-neutral-400">
                {c.summary}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
