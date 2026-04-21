// Shared IPC message shapes between main and renderer.

export interface AppConfig {
  baseUrl: string;
  hasPassword: boolean;
}

export interface ProbeResult {
  filename: string;
  filepath: string;
  sizeBytes: number;
  durationSeconds: number;
  mode: "video" | "audio-only";
  targetSizeBytes: number;
  estimatedSeconds: number;
}

export interface CompressOptions {
  filepath: string;
}

export type JobPhase =
  | "probing"
  | "compressing"
  | "uploading"
  | "finalizing"
  | "done"
  | "error"
  | "canceled";

export interface JobProgress {
  phase: JobPhase;
  /** 0..1 within the current phase. */
  progress: number;
  /** 0..1 across all phases. */
  overallProgress: number;
  mode?: "video" | "audio-only";
  etaSeconds?: number | null;
  message?: string;
}

export interface JobResult {
  ok: true;
  videoId: string;
  resultUrl: string;
}

export interface JobError {
  ok: false;
  message: string;
}

/** Constants used on both sides. */
export const DEFAULT_BASE_URL = "https://video-analyzer-tra.netlify.app";
export const TARGET_BYTES = 47 * 1024 * 1024;
export const UPLOAD_CAP_BYTES = 50 * 1024 * 1024;
export const AUDIO_BITRATE_KBPS = 32;
export const MIN_VIDEO_BITRATE_KBPS = 100;
export const VIDEO_MAX_WIDTH = 640;
