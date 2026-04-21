import { useRef, useState } from "react";
import { AppLogo } from "../components/AppLogo";
import {
  compressStreaming,
  type StreamProgress,
} from "../lib/compressStreaming";
import { formatBytes } from "../lib/format";

export default function Compress() {
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState<StreamProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<{ file: File; url: string } | null>(null);
  const [input, setInput] = useState<{ name: string; size: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const [dragging, setDragging] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    setProgress(null);
    setOutput(null);
    setInput({ name: file.name, size: file.size });
    setPhase("running");
    try {
      const compressed = await compressStreaming(file, (p) => setProgress(p));
      const url = URL.createObjectURL(compressed);
      setOutput({ file: compressed, url });
      setPhase("done");
    } catch (err) {
      console.error("[compress]", err);
      setError(err instanceof Error ? err.message : "Compression failed");
      setPhase("error");
    }
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  }

  function onDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current++;
    setDragging(true);
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) setDragging(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  function reset() {
    if (output?.url) URL.revokeObjectURL(output.url);
    setPhase("idle");
    setProgress(null);
    setError(null);
    setOutput(null);
    setInput(null);
  }

  const running = phase === "running";
  const progressPct = progress?.overallProgress != null ? progress.overallProgress * 100 : 0;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-6 py-4 text-sm">
          <AppLogo size={24} />
          <span className="font-semibold tracking-tight">TRA Video Analyzer</span>
          <span className="text-xs text-neutral-400">· browser compressor</span>
          <a href="/" className="ml-auto text-xs text-neutral-500 hover:underline">
            ← uploader
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <h1 className="mb-2 text-2xl font-semibold tracking-tight">Compress in your browser</h1>
        <p className="mb-4 text-sm text-neutral-500">
          Experimental — works for many videos, but multi-GB files can freeze the
          tab. For reliability, use the{" "}
          <a
            href="/compress-tool/"
            className="font-medium text-neutral-700 underline underline-offset-2 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
          >
            desktop uploader
          </a>
          {" "}instead — it runs native ffmpeg and uploads in one step.
        </p>
        <div className="mb-6 rounded-md border-l-4 border-amber-500 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <strong>Heads up:</strong> ffmpeg.wasm in the browser is single-threaded
          (slow — ~0.25× realtime) and the load step can hang silently on some
          machines. The <a href="/compress-tool/" className="underline">desktop uploader</a> avoids all of this.
        </div>

        {/* Drop zone / file input */}
        {phase === "idle" && (
          <div
            onDragEnter={onDragEnter}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-16 text-center transition ${
              dragging
                ? "border-amber-500 bg-amber-50 dark:bg-amber-950/20"
                : "border-neutral-300 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-600"
            }`}
          >
            <AppLogo size={48} />
            <div>
              <p className="text-base font-medium">Drop a video file here</p>
              <p className="mt-1 text-xs text-neutral-500">or click to browse · any size</p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="video/*,audio/*"
              hidden
              onChange={onChange}
            />
          </div>
        )}

        {(phase === "running" || phase === "done" || phase === "error") && (
          <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-3 text-sm font-medium">
              {input && (
                <>
                  {input.name}{" "}
                  <span className="text-neutral-500">({formatBytes(input.size)})</span>
                </>
              )}
            </div>

            {running && progress && (
              <>
                <StatusLine p={progress} />
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                  <div
                    className="h-full bg-neutral-900 transition-[width] duration-200 dark:bg-white"
                    style={{ width: `${Math.max(2, progressPct)}%` }}
                  />
                </div>
              </>
            )}

            {phase === "error" && (
              <>
                <p className="text-sm text-red-600">Error: {error}</p>
                <button
                  onClick={reset}
                  className="mt-3 text-xs text-neutral-500 underline"
                >
                  Try again
                </button>
              </>
            )}

            {phase === "done" && output && (
              <>
                <p className="mb-4 text-sm text-emerald-600">
                  Compressed to {formatBytes(output.file.size)}. Ready to upload.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={output.url}
                    download={output.file.name}
                    className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                  >
                    Download {output.file.name}
                  </a>
                  <a
                    href="/"
                    className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
                  >
                    Go to uploader →
                  </a>
                  <button
                    onClick={reset}
                    className="ml-auto text-xs text-neutral-500 underline"
                  >
                    Compress another
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <section className="mt-10 rounded-md border border-neutral-200 bg-neutral-50 p-4 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
          <p className="mb-2 font-medium text-neutral-700 dark:text-neutral-300">
            Want native speed?
          </p>
          <p>
            Single-threaded ffmpeg.wasm runs at ~0.25× realtime in the browser.
            A 3-hour video takes 10–15 min here, but ~30–90 s with native
            ffmpeg —{" "}
            <a
              href="/compress-tool/"
              className="underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              download the script →
            </a>
          </p>
        </section>
      </main>

      <footer className="border-t border-neutral-200 py-4 text-center text-[11px] text-neutral-400 dark:border-neutral-800">
        100% client-side · files never leave your device from this page
      </footer>
    </div>
  );
}

function StatusLine({ p }: { p: StreamProgress }) {
  if (p.phase === "loading") return <span className="text-sm">Getting the compressor ready…</span>;
  if (p.phase === "mounting")
    return <span className="text-sm">{p.message ?? "Getting your file ready…"}</span>;
  if (p.phase === "analyzing")
    return (
      <div className="text-sm">
        <div>Analyzing your video…</div>
        {p.message && (
          <div className="truncate font-mono text-[10px] text-neutral-400">{p.message}</div>
        )}
      </div>
    );
  if (p.phase === "finalizing")
    return <span className="text-sm">{p.message ?? "Packaging the result…"}</span>;
  if (p.phase === "compressing") {
    const dur = p.durationSeconds ? ` · ${Math.round(p.durationSeconds / 60)} min source` : "";
    const eta = p.etaSeconds != null ? ` · about ${formatEta(p.etaSeconds)} left` : "";
    return (
      <span className="text-sm">
        Shrinking your {p.mode === "audio-only" ? "audio" : "video"}{dur} · {Math.round(p.progress * 100)}%{eta}
      </span>
    );
  }
  return <span className="text-sm">Working…</span>;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}
