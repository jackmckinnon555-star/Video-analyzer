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
  expiresInSeconds: number;
}

export interface FinalizeUploadRequest {
  videoId: string;
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
