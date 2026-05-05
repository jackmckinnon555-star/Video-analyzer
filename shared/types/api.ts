export interface PresignUploadRequest {
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploaderName?: string;
}

export interface PresignUploadResponse {
  videoId: string;
  /** Storage bucket (always "videos" today but returned for forward-compat). */
  bucket: string;
  /** Object path within the bucket (e.g. `uploads/<uuid>/<filename>`). */
  path: string;
  /** Short-lived upload token. Pair with `path` in supabase-js `uploadToSignedUrl`. */
  token: string;
  /** Full Supabase-signed upload URL. PUT the file body directly to this URL
   *  (no auth headers needed — the token is embedded in the query string).
   *  Used by the desktop upload script; the web client prefers path+token. */
  signedUrl: string;
  expiresInSeconds: number;
}

export interface FinalizeUploadRequest {
  videoId: string;
  /** For multi-part uploads of very long source files. videoId is the
   *  parent (part 1); childIds is parts 2..N in order. The endpoint
   *  links them via parent_video_id / part_index / total_parts and
   *  dispatches the worker only once for the parent. */
  childIds?: string[];
}

export interface FinalizeUploadResponse {
  ok: true;
  status: "queued" | "dispatch_failed";
  /** Populated if the row was queued but GHA dispatch failed. */
  warning?: string;
}

export interface ApiError {
  error: string;
  code?: string;
}
