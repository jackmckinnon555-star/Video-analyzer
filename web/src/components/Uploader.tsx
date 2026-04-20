import { useRef } from "react";
import { useUpload, type UploadState } from "../hooks/useUpload";
import { formatBytes } from "../lib/format";

export function Uploader({ onDone }: { onDone?: (videoId: string) => void }) {
  const { state, upload, reset } = useUpload();
  const inputRef = useRef<HTMLInputElement>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const id = await upload(file);
      onDone?.(id);
    } catch {
      /* state.error set */
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const busy =
    state.phase === "compressing" ||
    state.phase === "presigning" ||
    state.phase === "uploading" ||
    state.phase === "finalizing";

  return (
    <div className="rounded-lg border border-dashed border-neutral-300 p-6 text-center dark:border-neutral-700">
      <input
        ref={inputRef}
        type="file"
        accept="video/*,audio/*"
        hidden
        onChange={onChange}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {busy ? "Working…" : "Upload a video"}
      </button>
      <p className="mt-2 text-xs text-neutral-500">
        Files over 45 MB are compressed in your browser before upload (supports long videos).
      </p>

      {state.phase !== "idle" && (
        <div className="mt-4 flex flex-col items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
          <StatusLine state={state} />
          <ProgressBar phase={state.phase} progress={state.progress} />
          {state.compress?.mode === "audio-only" && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Video is too long to fit under 50 MB at watchable quality — falling back to audio-only.
              Transcript + chapters + highlights will still work. No preview playback.
            </p>
          )}
        </div>
      )}

      {state.phase === "error" && (
        <button onClick={reset} className="mt-2 text-xs text-neutral-500 underline">
          Try again
        </button>
      )}
    </div>
  );
}

function StatusLine({ state }: { state: UploadState }) {
  if (state.phase === "compressing") {
    const c = state.compress;
    if (!c) return <>Preparing compressor…</>;
    if (c.phase === "loading") return <>Loading in-browser compressor (first time only)…</>;
    if (c.phase === "reading") return <>Reading video metadata…</>;
    if (c.phase === "compressing") {
      const dur = c.durationSeconds ? ` · ${Math.round(c.durationSeconds / 60)} min source` : "";
      const br = c.targetBitrateKbps ? ` @ ${c.targetBitrateKbps} kbps` : "";
      return (
        <>
          Compressing ({c.mode ?? "video"}{br}){dur} · {Math.round(c.progress * 100)}%
        </>
      );
    }
    return <>Compressing…</>;
  }
  if (state.phase === "presigning") return <>Requesting upload URL…</>;
  if (state.phase === "uploading")
    return (
      <>
        Uploading {state.finalSizeBytes ? formatBytes(state.finalSizeBytes) : ""}… {Math.round(state.progress * 100)}%
      </>
    );
  if (state.phase === "finalizing") return <>Queuing for processing…</>;
  if (state.phase === "done")
    return <span className="text-emerald-600">Queued. Processing will start shortly.</span>;
  if (state.phase === "error") return <span className="text-red-600">Error: {state.error}</span>;
  return null;
}

function ProgressBar({ phase, progress }: { phase: UploadState["phase"]; progress: number }) {
  if (phase === "idle" || phase === "error" || phase === "done") return null;
  return (
    <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
      <div
        className="h-full bg-neutral-900 transition-[width] duration-150 dark:bg-white"
        style={{ width: `${Math.max(2, Math.min(100, progress * 100))}%` }}
      />
    </div>
  );
}
