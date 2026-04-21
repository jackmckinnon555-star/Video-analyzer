import { useRef, useState } from "react";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";
import {
  compressStreaming,
  CompressionCanceledError,
  STREAM_UPLOAD_CAP_BYTES,
  type StreamProgress,
} from "../lib/compressStreaming";

export type UploadPhase =
  | "idle"
  | "compressing"
  | "presigning"
  | "uploading"
  | "finalizing"
  | "done"
  | "canceled"
  | "error";

export interface UploadState {
  phase: UploadPhase;
  progress: number;
  compress: StreamProgress | null;
  originalSizeBytes: number | null;
  finalSizeBytes: number | null;
  error: string | null;
  /** Short, plain-English hint for recovery. */
  errorHint?: string | null;
  videoId: string | null;
  file: File | null;
}

const initial: UploadState = {
  phase: "idle",
  progress: 0,
  compress: null,
  originalSizeBytes: null,
  finalSizeBytes: null,
  error: null,
  errorHint: null,
  videoId: null,
  file: null,
};

const COMPRESS_THRESHOLD = 45 * 1024 * 1024;

export function useUpload() {
  const [state, setState] = useState<UploadState>(initial);
  const abortRef = useRef<AbortController | null>(null);

  async function upload(file: File) {
    const controller = new AbortController();
    abortRef.current = controller;

    // For files over the threshold, go straight into compressing. Showing an
    // "estimating" state tempted us to probe metadata on the main thread,
    // which froze the tab for multi-GB files. ffmpeg now handles all
    // metadata detection inside its worker.
    const startPhase: UploadPhase =
      file.size > COMPRESS_THRESHOLD ? "compressing" : "presigning";
    setState({ ...initial, originalSizeBytes: file.size, file, phase: startPhase });

    let phaseLabel: "compress" | "presign" | "upload" | "finalize" = "compress";
    try {
      let toUpload = file;

      if (file.size > COMPRESS_THRESHOLD) {
        phaseLabel = "compress";
        toUpload = await compressStreaming(
          file,
          (cp) => setState((s) => ({ ...s, compress: cp, progress: cp.overallProgress })),
          { signal: controller.signal },
        );
      }

      if (toUpload.size > STREAM_UPLOAD_CAP_BYTES) {
        throw new Error(
          `Compressed file is ${(toUpload.size / 1024 / 1024).toFixed(1)} MB — above the 50 MB upload cap.`,
        );
      }

      phaseLabel = "presign";
      setState((s) => ({
        ...s,
        phase: "presigning",
        progress: 0,
        finalSizeBytes: toUpload.size,
      }));
      const presign = await api.presignUpload({
        filename: toUpload.name,
        contentType: toUpload.type || "application/octet-stream",
        sizeBytes: toUpload.size,
      });

      if (controller.signal.aborted) throw new CompressionCanceledError();

      phaseLabel = "upload";
      setState((s) => ({ ...s, phase: "uploading", videoId: presign.videoId, progress: 0 }));
      const { error: upErr } = await supabase.storage
        .from(presign.bucket)
        .uploadToSignedUrl(presign.path, presign.token, toUpload, {
          contentType: toUpload.type || "application/octet-stream",
          upsert: true,
        });
      if (upErr) throw new Error(`Upload failed: ${upErr.message ?? JSON.stringify(upErr)}`);
      setState((s) => ({ ...s, progress: 1 }));

      if (controller.signal.aborted) throw new CompressionCanceledError();

      phaseLabel = "finalize";
      setState((s) => ({ ...s, phase: "finalizing", progress: 1 }));
      const fin = await api.finalizeUpload({ videoId: presign.videoId });
      setState((s) => ({ ...s, phase: "done", progress: 1 }));

      if (fin.status === "dispatch_failed" && fin.warning) {
        console.warn("[upload] stored but dispatch failed:", fin.warning);
      }
      return presign.videoId;
    } catch (err) {
      if (err instanceof CompressionCanceledError) {
        setState((s) => ({ ...s, phase: "canceled" }));
        throw err;
      }
      console.error(`[upload] ${phaseLabel} failed:`, err);
      const message = err instanceof Error ? err.message : String(err);
      const hint = recoveryHint(phaseLabel, message);
      setState((s) => ({
        ...s,
        phase: "error",
        error: message,
        errorHint: hint,
      }));
      throw err;
    } finally {
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  function reset() {
    setState(initial);
  }

  return { state, upload, cancel, reset };
}

/** Map common failures to a friendly follow-up action. */
function recoveryHint(
  phase: "compress" | "presign" | "upload" | "finalize",
  message: string,
): string | null {
  if (phase === "compress") {
    if (/stalled/i.test(message)) {
      return "Try the faster local compression tool.";
    }
    if (/unsupported|DRM|metadata/i.test(message)) {
      return "Try converting the video to MP4 first using HandBrake (free).";
    }
    if (/cap|too big|above the/i.test(message)) {
      return "Try trimming the video to a shorter clip.";
    }
    return "Try again, or use the faster local compression tool.";
  }
  if (phase === "upload") return "Check your internet connection and try again.";
  if (phase === "finalize") return "The file uploaded, but processing didn't start. Click 'Retry' on the video row.";
  return null;
}
