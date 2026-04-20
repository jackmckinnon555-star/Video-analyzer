import { Link } from "react-router-dom";
import { useState } from "react";
import type { Video } from "@shared/types/video";
import { formatBytes } from "../lib/format";
import { api } from "../lib/api";

export function VideoRow({ video }: { video: Video }) {
  const [busy, setBusy] = useState<"delete" | "retry" | null>(null);

  async function onDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${video.title || video.filename}"?`)) return;
    setBusy("delete");
    try {
      await api.deleteVideo(video.id);
      // Realtime subscription will drop the row automatically.
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
      setBusy(null);
    }
  }

  async function onRetry(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy("retry");
    try {
      await api.retryVideo(video.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Link
      to={`/video/${video.id}`}
      className="flex items-start justify-between gap-4 rounded-md border border-neutral-200 bg-white px-4 py-3 transition hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-600"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">
          {video.title || video.filename}
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-neutral-500">
          <StatusBadge status={video.status} />
          <span>{formatBytes(video.size_bytes)}</span>
          <span>{new Date(video.created_at).toLocaleString()}</span>
        </div>
        {video.error && (
          <div className="mt-1 text-xs text-red-600">{video.error}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {video.status === "failed" && (
          <button
            onClick={onRetry}
            disabled={busy === "retry"}
            className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {busy === "retry" ? "…" : "Retry"}
          </button>
        )}
        <button
          onClick={onDelete}
          disabled={busy === "delete"}
          className="rounded border border-transparent px-2 py-1 text-xs text-neutral-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 dark:hover:border-red-900 dark:hover:bg-red-950/50 dark:hover:text-red-400"
        >
          {busy === "delete" ? "…" : "×"}
        </button>
      </div>
    </Link>
  );
}

function StatusBadge({ status }: { status: Video["status"] }) {
  const color: Record<Video["status"], string> = {
    pending: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
    queued: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    transcribing: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    analyzing: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
    done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${color[status]}`}>
      {status}
    </span>
  );
}
