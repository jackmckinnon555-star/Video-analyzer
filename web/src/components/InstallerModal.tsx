import { useEffect, useRef } from "react";
import { formatBytes } from "../lib/format";

const RELEASES_BASE =
  "https://github.com/jackmckinnon555-star/Video-analyzer/releases/latest/download";

const INSTALLERS = [
  {
    os: "Windows 10 / 11",
    name: "TRA Video Uploader.exe",
    href: `${RELEASES_BASE}/TRA.Video.Uploader-win-x64.exe`,
    meta: "~120 MB · per-user install",
  },
  {
    os: "macOS · Apple Silicon",
    name: "TRA Video Uploader.dmg",
    href: `${RELEASES_BASE}/TRA.Video.Uploader-mac-arm64.dmg`,
    meta: "M1 / M2 / M3 / M4",
  },
  {
    os: "macOS · Intel",
    name: "TRA Video Uploader.dmg",
    href: `${RELEASES_BASE}/TRA.Video.Uploader-mac-x64.dmg`,
    meta: "2019 Intel Macs",
  },
] as const;

export function InstallerModal({
  fileName,
  fileSize,
  onClose,
}: {
  fileName: string;
  fileSize: number;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    // Move focus into the dialog for keyboard users.
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="installer-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-2xl outline-none dark:bg-neutral-900"
      >
        <h2
          id="installer-modal-title"
          className="text-xl font-semibold tracking-tight"
        >
          This file is too big for the browser
        </h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          <span className="font-medium text-neutral-800 dark:text-neutral-200">
            {fileName}
          </span>{" "}
          is{" "}
          <span className="font-medium text-neutral-800 dark:text-neutral-200">
            {formatBytes(fileSize)}
          </span>
          . Files over 50&nbsp;MB go through the desktop uploader, which
          compresses on your computer and uploads in one click.
        </p>

        <div className="mt-5 space-y-2">
          {INSTALLERS.map((inst) => (
            <a
              key={inst.os}
              href={inst.href}
              className="block rounded-lg bg-neutral-900 px-4 py-3 text-white transition hover:-translate-y-0.5 hover:shadow-lg dark:bg-white dark:text-neutral-900"
            >
              <div className="text-[11px] uppercase tracking-wider opacity-70">
                {inst.os}
              </div>
              <div className="mt-0.5 text-sm font-semibold">{inst.name}</div>
              <div className="text-xs opacity-75">{inst.meta}</div>
            </a>
          ))}
        </div>

        <div className="mt-4 rounded-md border-l-2 border-amber-500 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <strong>Heads up:</strong> first-launch warning is normal.
          <br />
          <strong>Windows SmartScreen</strong> — click "More info → Run anyway".
          <br />
          <strong>macOS Gatekeeper</strong> — right-click the app → Open → Open.
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <a
            href="/compress-tool/"
            target="_blank"
            rel="noopener"
            className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200"
          >
            More install options →
          </a>
          <button
            onClick={onClose}
            className="rounded-md border border-neutral-300 px-4 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Pick a different file
          </button>
        </div>
      </div>
    </div>
  );
}
