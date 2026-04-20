import type { TranscriptSegment } from "@shared/types/video";
import { formatTimestamp } from "../lib/format";

export function TranscriptViewer({
  segments,
  onJump,
}: {
  segments: TranscriptSegment[];
  onJump?: (seconds: number) => void;
}) {
  if (!segments.length) {
    return <div className="text-sm text-neutral-500">No transcript yet.</div>;
  }
  return (
    <div className="max-h-[500px] overflow-y-auto rounded-md border border-neutral-200 bg-white p-4 text-sm leading-relaxed dark:border-neutral-800 dark:bg-neutral-950">
      {segments.map((seg, i) => (
        <p key={i} className="mb-3 flex gap-3">
          <button
            onClick={() => onJump?.(seg.start)}
            className="w-14 shrink-0 text-left font-mono text-xs text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            {formatTimestamp(seg.start)}
          </button>
          <span className="min-w-0 flex-1">
            {seg.speaker && (
              <span className="mr-1 text-xs font-semibold text-neutral-500">
                {seg.speaker}:
              </span>
            )}
            {seg.text}
          </span>
        </p>
      ))}
    </div>
  );
}
