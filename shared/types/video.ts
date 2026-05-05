export type VideoStatus =
  | "pending"
  | "queued"
  | "transcribing"
  | "analyzing"
  | "done"
  | "failed";

export interface TranscriptWord {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
  words?: TranscriptWord[];
}

export interface Chapter {
  start_seconds: number;
  title: string;
  summary: string;
}

export interface Highlight {
  timestamp_seconds: number;
  description: string;
  reason: string;
}

export interface Entity {
  name: string;
  type: "person" | "org" | "place" | "product" | "other";
  mentions: number;
}

export interface KeyQuote {
  timestamp_seconds: number;
  text: string;
  speaker?: string;
}

export interface ProgressInfo {
  phase: "transcribing" | "analyzing" | "embedding" | "finalizing";
  chunk_index?: number;
  total_chunks?: number;
  message?: string;
  updated_at: string;
}

export interface Video {
  id: string;
  uploader_name: string | null;
  storage_path: string;
  filename: string;
  size_bytes: number | null;
  duration_seconds: number | null;
  detected_language: string | null;
  status: VideoStatus;
  title: string | null;
  transcript: TranscriptSegment[] | null;
  chapters: Chapter[] | null;
  highlights: Highlight[] | null;
  entities: Entity[] | null;
  keywords: string[] | null;
  key_quotes: KeyQuote[] | null;
  thumbnail_url: string | null;
  preview_path: string | null;
  progress: ProgressInfo | null;
  show_notes: string | null;
  translations: Record<string, TranscriptSegment[]> | null;
  public_slug: string | null;
  /** Which transcription backend(s) succeeded — "groq", "cloudflare", or "mixed". */
  transcribe_backend: string | null;
  error: string | null;
  dispatched_at: string | null;
  created_at: string;
  updated_at: string;
}
