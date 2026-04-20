import { sb } from "../lib/supabase.js";
import { log } from "../lib/log.js";
import type { TranscriptSegment, VideoStatus, ProgressInfo } from "../../../shared/types/video.js";
import type { GlobalAnalysis } from "../../../shared/schemas/geminiOutput.js";

export async function setStatus(
  videoId: string,
  status: VideoStatus,
  extras: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await sb().from("videos").update({ status, ...extras }).eq("id", videoId);
  if (error) throw error;
  log.info("status set", { videoId, status });
}

export async function setDuration(videoId: string, seconds: number): Promise<void> {
  const { error } = await sb().from("videos").update({ duration_seconds: seconds }).eq("id", videoId);
  if (error) throw error;
}

export async function saveTranscript(
  videoId: string,
  transcript: TranscriptSegment[],
): Promise<void> {
  const { error } = await sb()
    .from("videos")
    .update({ transcript })
    .eq("id", videoId);
  if (error) throw error;
}

export async function saveAnalysis(
  videoId: string,
  analysis: GlobalAnalysis,
): Promise<void> {
  const { error } = await sb()
    .from("videos")
    .update({
      title: analysis.title,
      chapters: analysis.chapters,
      highlights: analysis.highlights,
      entities: analysis.entities,
      keywords: analysis.keywords,
      key_quotes: analysis.key_quotes,
    })
    .eq("id", videoId);
  if (error) throw error;
}

export async function saveThumbnailUrl(videoId: string, url: string): Promise<void> {
  const { error } = await sb().from("videos").update({ thumbnail_url: url }).eq("id", videoId);
  if (error) throw error;
}

export async function saveLanguage(videoId: string, language: string): Promise<void> {
  const { error } = await sb()
    .from("videos")
    .update({ detected_language: language })
    .eq("id", videoId);
  if (error) throw error;
}

export async function savePreviewPath(videoId: string, storagePath: string): Promise<void> {
  const { error } = await sb()
    .from("videos")
    .update({ preview_path: storagePath })
    .eq("id", videoId);
  if (error) throw error;
}

export async function getVideo(videoId: string): Promise<{ storage_path: string; filename: string } | null> {
  const { data, error } = await sb()
    .from("videos")
    .select("storage_path, filename")
    .eq("id", videoId)
    .single();
  if (error) return null;
  return data;
}

export async function markFailed(videoId: string, error: string): Promise<void> {
  await sb().from("videos").update({ status: "failed", error }).eq("id", videoId);
}

/**
 * Update the fine-grained progress object. Best-effort — a failed progress
 * update never blocks the real pipeline step.
 */
export async function setProgress(
  videoId: string,
  progress: Omit<ProgressInfo, "updated_at">,
): Promise<void> {
  const payload: ProgressInfo = { ...progress, updated_at: new Date().toISOString() };
  try {
    await sb().from("videos").update({ progress: payload }).eq("id", videoId);
  } catch (err) {
    log.warn("progress update failed (continuing)", {
      videoId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
