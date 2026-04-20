import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * Fetch a signed GET URL for a video's preview MP4. Re-fetches when it
 * nears expiry so the HTML video element never serves a 403.
 */
export function usePreviewUrl(videoId: string | undefined, hasPreview: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!videoId || !hasPreview) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        const res = await api.getPreviewUrl(videoId!);
        if (cancelled) return;
        setUrl(res.url);
        setError(null);
        // Refresh 2 minutes before expiry.
        const refreshIn = Math.max(10, res.expiresInSeconds - 120) * 1000;
        refreshTimer = setTimeout(load, refreshIn);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load preview");
      }
    }
    load();
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [videoId, hasPreview]);

  return { url, error };
}
