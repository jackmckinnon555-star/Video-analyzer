import type { TranscriptSegment } from "@shared/types/video";
import {
  formatCaptions,
  captionMimeTypes,
  type CaptionFormat,
} from "@shared/schemas/captions";

const FORMATS: CaptionFormat[] = ["srt", "vtt", "txt", "json"];

export function CaptionDownloads({
  segments,
  baseFilename,
}: {
  segments: TranscriptSegment[];
  baseFilename: string;
}) {
  if (!segments.length) return null;

  function download(format: CaptionFormat) {
    const body = formatCaptions(segments, format);
    const blob = new Blob([body], { type: captionMimeTypes[format] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitize(baseFilename)}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-neutral-500">Download:</span>
      {FORMATS.map((f) => (
        <button
          key={f}
          onClick={() => download(f)}
          className="rounded border border-neutral-300 px-2 py-1 font-mono uppercase hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          {f}
        </button>
      ))}
    </div>
  );
}

function sanitize(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, "");
  return base.replace(/[^\w\-]+/g, "_").slice(0, 80) || "captions";
}
