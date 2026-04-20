export function SkeletonRow() {
  return (
    <div
      aria-hidden="true"
      className="flex items-start justify-between gap-4 rounded-md border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="min-w-0 flex-1">
        <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="mt-2 flex items-center gap-3">
          <div className="h-3 w-12 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
          <div className="h-3 w-16 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
          <div className="h-3 w-24 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        </div>
      </div>
    </div>
  );
}
