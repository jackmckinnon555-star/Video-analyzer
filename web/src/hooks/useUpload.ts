import { useState } from "react";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";
import {
  compressForUpload,
  COMPRESS_THRESHOLD_BYTES,
  UPLOAD_CAP_BYTES,
  type CompressProgress,
} from "../lib/compress";

export type UploadPhase =
  | "idle"
  | "compressing"
  | "presigning"
  | "uploading"
  | "finalizing"
  | "done"
  | "error";

export interface UploadState {
  phase: UploadPhase;
  progress: number;
  compress: CompressProgress | null;
  originalSizeBytes: number | null;
  finalSizeBytes: number | null;
  error: string | null;
  videoId: string | null;
}

const initial: UploadState = {
  phase: "idle",
  progress: 0,
  compress: null,
  originalSizeBytes: null,
  finalSizeBytes: null,
  error: null,
  videoId: null,
};

export function useUpload() {
  const [state, setState] = useState<UploadState>(initial);

  async function upload(file: File) {
    setState({ ...initial, originalSizeBytes: file.size });

    let phaseLabel: "compress" | "presign" | "upload" | "finalize" = "compress";
    try {
      let toUpload = file;

      if (file.size > COMPRESS_THRESHOLD_BYTES) {
        phaseLabel = "compress";
        setState((s) => ({ ...s, phase: "compressing" }));
        toUpload = await compressForUpload(file, (cp) => {
          setState((s) => ({ ...s, compress: cp, progress: cp.overallProgress }));
        });
      }

      if (toUpload.size > UPLOAD_CAP_BYTES) {
        throw new Error(
          `File is ${(toUpload.size / 1024 / 1024).toFixed(1)} MB — above the 50 MB upload cap.`,
        );
      }

      // 1. Presign
      phaseLabel = "presign";
      setState((s) => ({ ...s, phase: "presigning", progress: 0, finalSizeBytes: toUpload.size }));
      const presign = await api.presignUpload({
        filename: toUpload.name,
        contentType: toUpload.type || "application/octet-stream",
        sizeBytes: toUpload.size,
      });

      // 2. Upload via Supabase JS client — the officially supported client-side path.
      phaseLabel = "upload";
      setState((s) => ({ ...s, phase: "uploading", videoId: presign.videoId, progress: 0 }));
      const { error: upErr } = await supabase.storage
        .from(presign.bucket)
        .uploadToSignedUrl(presign.path, presign.token, toUpload, {
          contentType: toUpload.type || "application/octet-stream",
          upsert: true,
        });
      if (upErr) {
        throw new Error(
          `Storage upload failed: ${upErr.message ?? JSON.stringify(upErr)}`,
        );
      }
      setState((s) => ({ ...s, progress: 1 }));

      // 3. Finalize
      phaseLabel = "finalize";
      setState((s) => ({ ...s, phase: "finalizing", progress: 1 }));
      const fin = await api.finalizeUpload({ videoId: presign.videoId });
      setState((s) => ({ ...s, phase: "done", progress: 1 }));

      // Surface dispatch warning (stored but not processing) without failing the upload
      if (fin.status === "dispatch_failed" && fin.warning) {
        console.warn("[upload] stored but dispatch failed:", fin.warning);
      }
      return presign.videoId;
    } catch (err) {
      console.error(`[upload] ${phaseLabel} failed:`, err);
      let message: string;
      if (err instanceof Error) {
        message = err.message || err.toString();
      } else if (typeof err === "string") {
        message = err;
      } else {
        try { message = JSON.stringify(err); } catch { message = String(err); }
      }
      if (!message) message = "Unknown error — check browser console";
      setState((s) => ({
        ...s,
        phase: "error",
        error: `[${phaseLabel}] ${message}`,
      }));
      throw err;
    }
  }

  function reset() {
    setState(initial);
  }

  return { state, upload, reset };
}
