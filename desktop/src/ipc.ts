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
  /** Audio bitrate (kbps) the compressor will target. Adaptive: lower for very long inputs. */
  audioKbps: number;
  /** Video bitrate (kbps) — only meaningful when mode === "video". */
  videoKbps?: number;
  /** Whether the input has any audio stream at all. */
  hasAudio: boolean;
  targetSizeBytes: number;
  estimatedSeconds: number;
  /** Multi-part plan when duration exceeds the audio-only ladder (~14.5 hr).
   *  When set, the orchestrator stream-copies the source into N segments and
   *  uploads each as its own video, linking them as parts of one logical upload. */
  partPlan?: PartPlan;
}

export interface PartPlan {
  totalParts: number;
  segmentSeconds: number;
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
  /** Set during upload retry attempts; 1-based, 1 = first attempt. */
  attempt?: number;
  /** Total attempts the uploader will make. */
  maxAttempts?: number;
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
/**
 * Adaptive audio-bitrate ladder. We start at 32 kbps and step down for very
 * long inputs so the output always fits under UPLOAD_CAP_BYTES.
 *   32 kbps → up to ~3.6 hr   (good clarity)
 *   16 kbps → up to ~7.3 hr   (clear speech, slight artifacts)
 *   12 kbps → up to ~9.7 hr   (intelligible for Whisper)
 *    8 kbps → up to ~14.5 hr  (last-resort; quality is rough but transcribable)
 */
export const AUDIO_BITRATE_LADDER_KBPS = [32, 16, 12, 8] as const;
export const AUDIO_BITRATE_KBPS = AUDIO_BITRATE_LADDER_KBPS[0];
export const MIN_VIDEO_BITRATE_KBPS = 100;
export const VIDEO_MAX_WIDTH = 640;
