import { useParams, Link, useNavigate } from "react-router-dom";
import { useRef, useState } from "react";
import { useVideo } from "../hooks/useVideos";
import { usePreviewUrl } from "../hooks/usePreviewUrl";
import { useVideoKeyboard } from "../hooks/useVideoKeyboard";
import { ChapterList } from "../components/ChapterList";
import { TranscriptViewer } from "../components/TranscriptViewer";
import { CaptionDownloads } from "../components/CaptionDownloads";
import { InsightsSidebar } from "../components/InsightsSidebar";
import { formatTimestamp } from "../lib/format";
import { api } from "../lib/api";

export default function VideoResult() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: video, isLoading, error } = useVideo(id);
  const { url: previewUrl, error: previewError } = usePreviewUrl(
    id,
    !!video?.preview_path,
  );
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const [busy, setBusy] = useState<"delete" | "retry" | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  useVideoKeyboard(playerRef, () => setHelpOpen((v) => !v));

  function jump(seconds: number) {
    if (!playerRef.current) return;
    playerRef.current.currentTime = seconds;
    playerRef.current.play().catch(() => {});
  }

  async function onDelete() {
    if (!id) return;
    if (!confirm("Delete this video and all its results? This can't be undone.")) return;
    setBusy("delete");
    try {
      await api.deleteVideo(id);
      navigate("/");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
      setBusy(null);
    }
  }

  async function onRetry() {
    if (!id) return;
    setBusy("retry");
    try {
      await api.retryVideo(id);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return <div className="mx-auto max-w-4xl px-6 py-10 text-sm">Loading…</div>;
  if (error || !video)
    return (
      <div className="mx-auto max-w-4xl px-6 py-10 text-sm text-red-600">
        {error instanceof Error ? error.message : "Not found"}
      </div>
    );

  const processing = video.status !== "done" && video.status !== "failed";

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <Link to="/" className="text-sm text-neutral-500 hover:underline">
        ← Back
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {video.title || video.filename}
          </h1>
          <div className="mt-1 text-xs text-neutral-500">
            Status: {video.status}
            {video.duration_seconds
              ? ` · ${formatTimestamp(video.duration_seconds)}`
              : ""}
            {video.detected_language
              ? ` · ${video.detected_language.toUpperCase()}`
              : ""}
            {video.uploader_name ? ` · uploaded by ${video.uploader_name}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {video.transcript && video.transcript.length > 0 && (
            <CaptionDownloads
              segments={video.transcript}
              baseFilename={video.title || video.filename}
            />
          )}
          {video.status === "failed" && (
            <button
              onClick={onRetry}
              disabled={busy === "retry"}
              className="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              {busy === "retry" ? "Retrying…" : "Retry"}
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={busy === "delete"}
            className="rounded-md border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/50"
          >
            {busy === "delete" ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>

      {video.error && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50">
          {video.error}
        </div>
      )}

      {processing && (
        <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700 dark:border-blue-900 dark:bg-blue-950/50">
          Processing… this page will update automatically when the worker finishes.
        </div>
      )}

      {/* Video player with preview or poster fallback */}
      {previewUrl ? (
        <video
          ref={playerRef}
          src={previewUrl}
          poster={video.thumbnail_url ?? undefined}
          controls
          className="mt-6 aspect-video w-full rounded-md bg-black"
        />
      ) : video.thumbnail_url ? (
        <img
          src={video.thumbnail_url}
          alt=""
          className="mt-6 aspect-video w-full rounded-md bg-black object-cover opacity-80"
        />
      ) : null}
      {previewError && (
        <div className="mt-2 text-xs text-red-600">Preview error: {previewError}</div>
      )}

      {previewUrl && (
        <div className="mt-2 flex items-center gap-3 text-xs text-neutral-500">
          <button
            onClick={() => setHelpOpen((v) => !v)}
            className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
            aria-expanded={helpOpen}
            aria-label="Toggle keyboard shortcuts"
          >
            ? keyboard shortcuts
          </button>
          {helpOpen && (
            <span className="font-mono text-[11px]">
              Space/K play · ← → ±5s · Shift+arrow ±30s · J/L ±10s · , . step frame · &lt;&gt; speed · M mute · F fullscreen
            </span>
          )}
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 flex flex-col gap-8">
          <section>
            <h2 className="mb-3 text-lg font-semibold">Chapters</h2>
            <ChapterList chapters={video.chapters ?? []} onJump={jump} />
          </section>

          {video.highlights && video.highlights.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">Highlights</h2>
              <ul className="flex flex-col gap-2">
                {video.highlights.map((h, i) => (
                  <li
                    key={i}
                    className="flex gap-3 rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800"
                  >
                    <button
                      onClick={() => jump(h.timestamp_seconds)}
                      className="w-16 shrink-0 text-left font-mono text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                    >
                      {formatTimestamp(h.timestamp_seconds)}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div>{h.description}</div>
                      <div className="mt-0.5 text-xs text-neutral-500">{h.reason}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-lg font-semibold">Transcript</h2>
            <TranscriptViewer segments={video.transcript ?? []} onJump={jump} />
          </section>
        </div>

        <InsightsSidebar
          entities={video.entities}
          keywords={video.keywords}
          keyQuotes={video.key_quotes}
          onJump={jump}
        />
      </div>
    </div>
  );
}
