import { useRef, useState } from "react";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";

export type UploadPhase =
  | "idle"
  | "presigning"
  | "uploading"
  | "finalizing"
  | "done"
  | "canceled"
  | "error"
  /** File too big for the browser path; renderer should show the installer modal. */
  | "oversize";

export interface UploadState {
  phase: UploadPhase;
  /** 0..1 — meaningful during "uploading". */
  progress: number;
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
  originalSizeBytes: null,
  finalSizeBytes: null,
  error: null,
  errorHint: null,
  videoId: null,
  file: null,
};

/** Supabase Storage enforces a 50 MB cap on signed PUTs for this project. */
export const UPLOAD_CAP_BYTES = 50 * 1024 * 1024;

class UploadCanceledError extends Error {
  constructor() {
    super("Upload canceled");
    this.name = "UploadCanceledError";
  }
}

export function useUpload() {
  const [state, setState] = useState<UploadState>(initial);
  const abortRef = useRef<AbortController | null>(null);

  async function upload(file: File) {
    const controller = new AbortController();
    abortRef.current = controller;

    // Files above the Supabase cap can't go through the browser at all —
    // surface the installer modal instead of attempting the network call.
    if (file.size > UPLOAD_CAP_BYTES) {
      setState({
        ...initial,
        originalSizeBytes: file.size,
        file,
        phase: "oversize",
      });
      // Return null so the caller can distinguish "use installer" from "completed".
      return null;
    }

    setState({
      ...initial,
      originalSizeBytes: file.size,
      file,
      phase: "presigning",
    });

    let phaseLabel: "presign" | "upload" | "finalize" = "presign";
    try {
      const presign = await api.presignUpload({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });

      if (controller.signal.aborted) throw new UploadCanceledError();

      phaseLabel = "upload";
      setState((s) => ({
        ...s,
        phase: "uploading",
        videoId: presign.videoId,
        finalSizeBytes: file.size,
        progress: 0,
      }));
      const { error: upErr } = await supabase.storage
        .from(presign.bucket)
        .uploadToSignedUrl(presign.path, presign.token, file, {
          contentType: file.type || "application/octet-stream",
          upsert: true,
        });
      if (upErr) throw new Error(`Upload failed: ${upErr.message ?? JSON.stringify(upErr)}`);
      setState((s) => ({ ...s, progress: 1 }));

      if (controller.signal.aborted) throw new UploadCanceledError();

      phaseLabel = "finalize";
      setState((s) => ({ ...s, phase: "finalizing", progress: 1 }));
      const fin = await api.finalizeUpload({ videoId: presign.videoId });
      setState((s) => ({ ...s, phase: "done", progress: 1 }));

      if (fin.status === "dispatch_failed" && fin.warning) {
        console.warn("[upload] stored but dispatch failed:", fin.warning);
      }
      return presign.videoId;
    } catch (err) {
      if (err instanceof UploadCanceledError) {
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
  phase: "presign" | "upload" | "finalize",
  _message: string,
): string | null {
  if (phase === "upload") return "Check your internet connection and try again.";
  if (phase === "finalize") return "The file uploaded, but processing didn't start. Click 'Retry' on the video row.";
  return null;
}
