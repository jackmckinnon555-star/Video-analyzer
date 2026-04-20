import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { Video } from "@shared/types/video";
import { ChapterList } from "../components/ChapterList";
import { TranscriptViewer } from "../components/TranscriptViewer";
import { CaptionDownloads } from "../components/CaptionDownloads";
import { InsightsSidebar } from "../components/InsightsSidebar";
import { useVideoKeyboard } from "../hooks/useVideoKeyboard";
import { formatTimestamp } from "../lib/format";
import { AppLogo } from "../components/AppLogo";

type PublicVideo = Omit<Video, "preview_path" | "storage_path"> & {
  preview_url: string | null;
  preview_expires_in_seconds: number;
};

export default function PublicVideoResult() {
  const { slug } = useParams<{ slug: string }>();
  const [video, setVideo] = useState<PublicVideo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef<HTMLVideoElement | null>(null);
  useVideoKeyboard(playerRef);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/public-video?slug=${encodeURIComponent(slug!)}`);
        if (!res.ok) throw new Error(`Load failed: ${res.status}`);
        const body = (await res.json()) as PublicVideo;
        if (!cancelled) setVideo(body);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  function jump(seconds: number) {
    if (!playerRef.current) return;
    playerRef.current.currentTime = seconds;
    playerRef.current.play().catch(() => {});
  }

  if (error)
    return <div className="mx-auto max-w-4xl px-6 py-10 text-sm text-red-600">{error}</div>;
  if (!video) return <div className="mx-auto max-w-4xl px-6 py-10 text-sm">Loading…</div>;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-6 py-4 text-sm">
          <AppLogo size={24} />
          <span className="font-semibold tracking-tight">TRA Video Analyzer</span>
          <span className="text-xs text-neutral-400">· shared</span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl flex-1 px-6 py-10">
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{video.title || video.filename}</h1>
            <div className="mt-1 text-xs text-neutral-500">
              {video.duration_seconds ? formatTimestamp(video.duration_seconds) : ""}
              {video.detected_language ? ` · ${video.detected_language.toUpperCase()}` : ""}
              {video.uploader_name ? ` · ${video.uploader_name}` : ""}
            </div>
          </div>
          {video.transcript && video.transcript.length > 0 && (
            <CaptionDownloads
              segments={video.transcript}
              baseFilename={video.title || video.filename}
            />
          )}
        </div>

        {video.preview_url && (
          <video
            ref={playerRef}
            src={video.preview_url}
            poster={video.thumbnail_url ?? undefined}
            controls
            className="mt-6 aspect-video w-full rounded-md bg-black"
          />
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

        <footer className="mt-12 border-t border-neutral-200 pt-4 text-center text-xs text-neutral-400 dark:border-neutral-800">
          Generated by TRA Video Analyzer
        </footer>
      </main>
    </div>
  );
}
