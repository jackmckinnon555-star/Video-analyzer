/**
 * Prominent card linking to the two compress paths, shown on the Dashboard.
 * Designed to be glance-able: one-line pitch, two clear CTAs.
 */
export function CompressCard() {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h18" />
              <path d="M7 6l-4 6 4 6" />
              <path d="M17 6l4 6-4 6" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Compress a large video first</h3>
            <p className="mt-0.5 text-xs text-neutral-500">
              The uploader caps at 50 MB. For multi-GB files, compress locally first — output is byte-identical to the built-in browser compressor.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/compress"
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Compress in browser
            <span aria-hidden>→</span>
          </a>
          <a
            href="/compress-tool/"
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Native script
            <span aria-hidden>→</span>
          </a>
        </div>
      </div>
    </div>
  );
}
