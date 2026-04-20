import { getSitePassword, clearSitePassword } from "./sitePassword";
import type {
  PresignUploadRequest,
  PresignUploadResponse,
  FinalizeUploadRequest,
  FinalizeUploadResponse,
} from "@shared/types/api";

export class AuthError extends Error {
  constructor() {
    super("Invalid site password");
    this.name = "AuthError";
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const pw = getSitePassword();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(pw ? { "X-Site-Password": pw } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    clearSitePassword();
    throw new AuthError();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

export const api = {
  presignUpload(body: PresignUploadRequest) {
    return apiFetch<PresignUploadResponse>("/api/presign-upload", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  finalizeUpload(body: FinalizeUploadRequest) {
    return apiFetch<FinalizeUploadResponse>("/api/finalize-upload", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  getPreviewUrl(videoId: string) {
    return apiFetch<{ url: string; expiresInSeconds: number }>(
      `/api/get-preview-url?id=${encodeURIComponent(videoId)}`,
    );
  },
  deleteVideo(videoId: string) {
    return apiFetch<{ ok: true }>("/api/delete-video", {
      method: "POST",
      body: JSON.stringify({ videoId }),
    });
  },
  retryVideo(videoId: string) {
    return apiFetch<{ ok: true; status: "queued" }>("/api/retry-video", {
      method: "POST",
      body: JSON.stringify({ videoId }),
    });
  },
};
