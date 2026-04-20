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
  search(body: { query: string; videoId?: string; limit?: number }) {
    return apiFetch<{
      results: Array<{
        id: string;
        video_id: string;
        video_title: string;
        start_seconds: number;
        end_seconds: number;
        text: string;
        similarity: number;
      }>;
    }>("/api/search", { method: "POST", body: JSON.stringify(body) });
  },
  ragChat(body: { question: string; videoId?: string }) {
    return apiFetch<{
      answer: string;
      sources: Array<{
        video_id: string;
        video_title: string;
        start_seconds: number;
        snippet: string;
      }>;
    }>("/api/rag-chat", { method: "POST", body: JSON.stringify(body) });
  },
  generateShowNotes(videoId: string, force = false) {
    return apiFetch<{ markdown: string; cached: boolean }>(
      "/api/generate-shownotes",
      { method: "POST", body: JSON.stringify({ videoId, force }) },
    );
  },
  shareVideo(videoId: string, revoke = false) {
    return apiFetch<{ ok: true; slug?: string; revoked?: boolean }>(
      "/api/share-video",
      { method: "POST", body: JSON.stringify({ videoId, revoke }) },
    );
  },
  translate(videoId: string, targetLanguage: string) {
    return apiFetch<{ transcript: unknown; cached: boolean }>("/api/translate", {
      method: "POST",
      body: JSON.stringify({ videoId, targetLanguage }),
    });
  },
};
