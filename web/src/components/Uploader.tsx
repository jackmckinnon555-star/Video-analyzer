import { useEffect, useRef, useState } from "react";
import { useUpload, type UploadState } from "../hooks/useUpload";
import { formatBytes } from "../lib/format";

const SUPPORTED_EXT = new Set([
  "mp4", "mov", "m4v", "mkv", "webm", "avi", "wmv",
  "mp3", "m4a", "wav", "aac", "ogg", "opus", "flac",
]);

export function Uploader({ onDone }: { onDone?: (videoId: string) => void }) {
  const { state, upload, cancel, reset } = useUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const [showHelp, setShowHelp] = useState(false);

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
  const showActive = busy || state.phase === "done" || state.phase === "error" || state.phase === "canceled";

  return (
    <div className="rounded-lg border border-dashed border-neutral-300 p-6 dark:border-neutral-700">
      {!showActive && (
        <IdleView
          onClick={() => inputRef.current?.click()}
          onToggleHelp={() => setShowHelp((v) => !v)}
          showHelp={showHelp}
        />
      )}

      {showActive && (
        <ActiveView
          state={state}
          onCancel={cancel}
          onReset={reset}
        />
      )}

      <input
        ref={inputRef}
        type="file"
        accept="video/*,audio/*"
        hidden
        onChange={onChange}
      />

      <div className="mt-4 border-t border-neutral-200 pt-3 text-center text-[11px] text-neutral-400 dark:border-neutral-800">
        Power users:{" "}
        <a
          href="/compress-tool/"
          target="_blank"
          rel="noopener"
          className="underline underline-offset-2 hover:text-neutral-600 dark:hover:text-neutral-300"
        >
          10× faster local compression with ffmpeg →
        </a>
      </div>
    </div>
  );
}

// ─── Idle state ─────────────────────────────────────────────────────────────

function IdleView({
  onClick,
  onToggleHelp,
  showHelp,
}: {
  onClick: () => void;
  onToggleHelp: () => void;
  showHelp: boolean;
}) {
  return (
    <div>
      {/* Primary CTA: the desktop uploader. Handles any file size reliably. */}
      <div className="rounded-md border border-neutral-900 bg-neutral-900 p-4 text-white dark:border-white dark:bg-white dark:text-neutral-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-md">
            <div className="text-sm font-semibold">For videos larger than 50 MB</div>
            <p className="mt-1 text-xs opacity-80">
              Download our desktop uploader. It compresses on your computer
              using native ffmpeg (fast, reliable, any size) and uploads
              straight to the server. One click, one script, one results page.
            </p>
          </div>
          <a
            href="/compress-tool/"
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 rounded-md bg-white px-4 py-2 text-xs font-medium text-neutral-900 hover:bg-neutral-100 dark:bg-neutral-900 dark:text-white dark:hover:bg-neutral-800"
          >
            Get the desktop uploader
            <span aria-hidden>→</span>
          </a>
        </div>
      </div>

      {/* Secondary: direct browser upload (small files / already-compressed files) */}
      <div className="mt-4 text-center">
        <button
          onClick={onClick}
          className="min-h-[44px] rounded-md border border-neutral-300 bg-white px-6 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:hover:bg-neutral-800"
          aria-label="Upload a video"
        >
          Or upload a small file directly
        </button>
        <p className="mt-2 text-xs text-neutral-500">
          Files under 50 MB upload straight through. Larger files get
          compressed in your browser —{" "}
          <span className="italic">experimental; may not work for multi-GB files.</span>
          <button
            onClick={onToggleHelp}
            className="ml-1 rounded-full border border-neutral-300 px-1.5 py-0 text-[10px] text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
            aria-label="How it works"
            aria-expanded={showHelp}
          >
            ?
          </button>
        </p>

        {showHelp && (
          <ol className="mx-auto mt-3 max-w-md space-y-1 rounded-md bg-neutral-50 p-3 text-left text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
            <li>
              <strong className="text-neutral-800 dark:text-neutral-200">Small files (&lt;50 MB):</strong>{" "}
              direct upload via the button above.
            </li>
            <li>
              <strong className="text-neutral-800 dark:text-neutral-200">Everything else:</strong>{" "}
              run the desktop uploader script. Native ffmpeg compresses +
              uploads in about a minute for a 3-hour video.
            </li>
            <li>
              <strong className="text-neutral-800 dark:text-neutral-200">Analysis:</strong>{" "}
              takes 2–5 min after upload lands. You'll see chapters,
              transcript, and highlights.
            </li>
          </ol>
        )}
      </div>
    </div>
  );
}

// ─── Active states ─────────────────────────────────────────────────────────

function ActiveView({
  state,
  onCancel,
  onReset,
}: {
  state: UploadState;
  onCancel: () => void;
  onReset: () => void;
}) {
  const name = state.file?.name ?? "Your video";
  const size = state.file?.size ?? state.originalSizeBytes ?? null;
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const supported = SUPPORTED_EXT.has(ext);

  return (
    <div>
      {/* Header row: filename + format chip + size */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="truncate font-medium">{name}</span>
        <span className="text-xs text-neutral-500">
          {size != null ? formatBytes(size) : ""}
        </span>
        {ext && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
              supported
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            }`}
            title={supported ? "Common format — expected to work" : "Unusual format — let's try anyway"}
          >
            .{ext}
          </span>
        )}
      </div>

      {state.phase === "compressing" && (
        <CompressingBody state={state} onCancel={onCancel} />
      )}

      {state.phase === "presigning" && (
        <SimpleBody message="Getting ready to upload…" />
      )}

      {state.phase === "uploading" && (
        <UploadingBody state={state} />
      )}

      {state.phase === "finalizing" && (
        <SimpleBody message="Queuing for processing…" />
      )}

      {state.phase === "done" && (
        <DoneBody onReset={onReset} />
      )}

      {state.phase === "canceled" && (
        <CanceledBody onReset={onReset} />
      )}

      {state.phase === "error" && (
        <ErrorBody state={state} onReset={onReset} />
      )}
    </div>
  );
}

const ROTATING_MESSAGES = [
  "This is normal — your browser is doing real work.",
  "Keep this tab open, feel free to switch tabs.",
  "Still going — large files take several minutes.",
  "Hang tight…",
];

function CompressingBody({
  state,
  onCancel,
}: {
  state: UploadState;
  onCancel: () => void;
}) {
  const c = state.compress;
  const [msgIdx, setMsgIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMsgIdx((i) => (i + 1) % ROTATING_MESSAGES.length), 4500);
    return () => clearInterval(id);
  }, []);

  const pct = Math.round((c?.progress ?? 0) * 100);
  const etaLabel = c?.etaSeconds != null ? humanDuration(c.etaSeconds) : null;
  const duration = c?.durationSeconds;

  const primary = (() => {
    if (!c) return "Starting…";
    switch (c.phase) {
      case "loading": return "Getting the compressor ready…";
      case "mounting": return "Getting your file ready…";
      case "analyzing": return "Analyzing your video…";
      case "compressing":
        return `Shrinking your video… ${pct}%${etaLabel ? ` · about ${etaLabel} left` : ""}`;
      case "finalizing": return "Almost done — packaging the result…";
      default: return "Working…";
    }
  })();

  return (
    <div className="mt-3 space-y-2">
      <ProgressBar progress={c?.overallProgress ?? 0.05} />
      <p className="text-sm font-medium">{primary}</p>

      {duration != null && c?.phase === "compressing" && (
        <p className="text-xs text-neutral-500">
          <strong>{humanDuration(duration)}</strong> of{" "}
          {c.mode === "audio-only" ? "audio" : "video"} → ~{" "}
          <strong>{formatBytes(47 * 1024 * 1024)}</strong> output
        </p>
      )}

      {/* Rotating reassurance line */}
      <p className="text-xs text-neutral-500">{ROTATING_MESSAGES[msgIdx]}</p>

      {/* Live log tail during the slow analysis phase — proves the worker is alive */}
      {c?.phase === "analyzing" && c.message && (
        <p className="truncate font-mono text-[10px] text-neutral-400">{c.message}</p>
      )}

      <div className="flex justify-end pt-1">
        <button
          onClick={onCancel}
          className="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function UploadingBody({ state }: { state: UploadState }) {
  const pct = Math.round((state.progress ?? 0) * 100);
  return (
    <div className="mt-3 space-y-2">
      <ProgressBar progress={state.progress ?? 0} />
      <p className="text-sm font-medium">
        Uploading… {pct}%
        {state.finalSizeBytes ? ` (${formatBytes(state.finalSizeBytes)})` : ""}
      </p>
    </div>
  );
}

function SimpleBody({ message }: { message: string }) {
  return (
    <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">{message}</p>
  );
}

function DoneBody({ onReset }: { onReset: () => void }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-2 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
      <span>Queued. Processing will start shortly.</span>
      <button
        onClick={onReset}
        className="rounded-md border border-emerald-300 bg-white px-3 py-1 text-xs text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
      >
        Upload another
      </button>
    </div>
  );
}

function CanceledBody({ onReset }: { onReset: () => void }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-2 rounded-md bg-neutral-50 p-3 text-sm text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
      <span>Canceled.</span>
      <button
        onClick={onReset}
        className="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        Start over
      </button>
    </div>
  );
}

function ErrorBody({ state, onReset }: { state: UploadState; onReset: () => void }) {
  return (
    <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
      <p className="font-medium">Something went wrong.</p>
      <p className="mt-1 text-xs">{state.error}</p>
      {state.errorHint && (
        <p className="mt-2 text-xs text-red-800 dark:text-red-200">{state.errorHint}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={onReset}
          className="rounded-md border border-red-300 bg-white px-3 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900/50"
        >
          Try again
        </button>
        <a
          href="/compress-tool/"
          target="_blank"
          rel="noopener"
          className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          Faster local tool →
        </a>
      </div>
    </div>
  );
}

// ─── Shared bits ───────────────────────────────────────────────────────────

function ProgressBar({ progress }: { progress: number }) {
  const pct = Math.max(2, Math.min(100, progress * 100));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full bg-neutral-900 transition-[width] duration-200 dark:bg-white"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function humanDuration(seconds: number): string {
  if (seconds < 1) return "a moment";
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return m === 1 ? "1 minute" : `${m} minutes`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (mm === 0) return h === 1 ? "1 hour" : `${h} hours`;
  return `${h}h ${mm}m`;
}
