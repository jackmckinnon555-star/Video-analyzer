import { useVideos } from "../hooks/useVideos";
import { Uploader } from "../components/Uploader";
import { VideoRow } from "../components/VideoRow";

export default function Dashboard() {
  const { data: videos, isLoading, error } = useVideos();

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">Videos</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Upload long-form video and get a title, timestamped captions, and chapter markers back.
      </p>

      <div className="mb-8">
        <Uploader />
      </div>

      {isLoading && <div className="text-sm text-neutral-500">Loading…</div>}
      {error && (
        <div className="text-sm text-red-600">
          {error instanceof Error ? error.message : "Failed to load videos"}
        </div>
      )}

      {videos && videos.length === 0 && (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-6 text-center text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
          No videos yet. Upload one above to get started.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {videos?.map((v) => <VideoRow key={v.id} video={v} />)}
      </div>
    </div>
  );
}
