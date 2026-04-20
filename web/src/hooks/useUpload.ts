import { useState } from "react";
import { api } from "../lib/api";
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
  progress: number; // 0..1 for the current phase
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

    try {
      let toUpload = file;

      // Compress if the raw file is larger than the upload cap.
      if (file.size > COMPRESS_THRESHOLD_BYTES) {
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

      setState((s) => ({
        ...s,
        phase: "presigning",
        progress: 0,
        finalSizeBytes: toUpload.size,
      }));
      const { uploadUrl, videoId } = await api.presignUpload({
        filename: toUpload.name,
        contentType: toUpload.type || "application/octet-stream",
        sizeBytes: toUpload.size,
      });

      setState((s) => ({ ...s, phase: "uploading", videoId, progress: 0 }));
      await putWithProgress(uploadUrl, toUpload, (p) =>
        setState((s) => ({ ...s, progress: p })),
      );

      setState((s) => ({ ...s, phase: "finalizing", progress: 1 }));
      await api.finalizeUpload({ videoId });
      setState((s) => ({ ...s, phase: "done", progress: 1 }));
      return videoId;
    } catch (err) {
      setState((s) => ({
        ...s,
        phase: "error",
        error: err instanceof Error ? err.message : "Upload failed",
      }));
      throw err;
    }
  }

  function reset() {
    setState(initial);
  }

  return { state, upload, reset };
}

function putWithProgress(
  url: string,
  file: File,
  onProgress: (p: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText} — ${xhr.responseText.slice(0, 200)}`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}
