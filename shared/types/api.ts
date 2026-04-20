export interface PresignUploadRequest {
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploaderName?: string;
}

export interface PresignUploadResponse {
  videoId: string;
  uploadUrl: string;
  r2Key: string;
  expiresInSeconds: number;
}

export interface FinalizeUploadRequest {
  videoId: string;
}

export interface FinalizeUploadResponse {
  ok: true;
  status: "queued";
}

export interface ApiError {
  error: string;
  code?: string;
}
