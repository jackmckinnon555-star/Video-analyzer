import { useEffect } from "react";
import { useVideos } from "../hooks/useVideos";
import { Uploader } from "../components/Uploader";
import { VideoRow } from "../components/VideoRow";
import { SkeletonRow } from "../components/SkeletonRow";
import { AppLogo } from "../components/AppLogo";
import { SearchBar } from "../components/SearchBar";
import { ChatSidebar } from "../components/ChatSidebar";
import { CompressCard } from "../components/CompressCard";
import { api } from "../lib/api";

export default function Dashboard() {
  const { data: videos, isLoading, error } = useVideos();

  // Prefetch the first "done" video's preview so clicking into it feels instant.
  useEffect(() => {
    const first = videos?.find((v) => v.status === "done" && v.preview_path);
    if (!first) return;
    let cancelled = false;
    api.getPreviewUrl(first.id)
      .then((r) => {
        if (cancelled) return;
        const link = document.createElement("link");
        link.rel = "prefetch";
        link.as = "video";
        link.href = r.url;
        document.head.appendChild(link);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [videos]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">Videos</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Upload long-form video and get a title, timestamped captions, and chapter markers back.
      </p>

      <div className="mb-4">
        <SearchBar />
      </div>

      <div className="mb-4">
        <Uploader />
      </div>

      <div className="mb-8">
        <CompressCard />
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50">
          {error instanceof Error ? error.message : "Failed to load videos"}
        </div>
      )}

      {videos && videos.length === 0 && <EmptyState />}

      {videos && videos.length > 0 && (
        <div className="flex flex-col gap-2">
          {videos.map((v) => <VideoRow key={v.id} video={v} />)}
        </div>
      )}

      <ChatSidebar />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-6 py-12 text-center dark:border-neutral-700 dark:bg-neutral-900">
      <AppLogo size={64} />
      <div className="max-w-sm">
        <h2 className="text-lg font-semibold">Upload your first video</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Best with podcasts, talks, and lectures. Files over 45 MB are
          compressed in your browser before upload.
        </p>
      </div>
      <ul className="mt-1 flex flex-col gap-1 text-xs text-neutral-500">
        <li>• Processing typically takes 2-5 min for a 10-minute clip.</li>
        <li>• Transcript, chapters, and highlights are auto-generated.</li>
        <li>• Preview plays back with clickable timestamps.</li>
      </ul>
    </div>
  );
}
