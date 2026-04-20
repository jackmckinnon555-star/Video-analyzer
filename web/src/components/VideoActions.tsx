import { useState } from "react";
import type { Video, TranscriptSegment } from "@shared/types/video";
import { api } from "../lib/api";
import { formatCaptions, captionMimeTypes } from "@shared/schemas/captions";

const LANGS = [
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "ar", label: "Arabic" },
];

export function VideoActions({ video }: { video: Video }) {
  const [busy, setBusy] = useState<"shownotes" | "share" | "translate" | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [showLangs, setShowLangs] = useState(false);

  async function onShowNotes() {
    setBusy("shownotes");
    try {
      const r = await api.generateShowNotes(video.id);
      const blob = new Blob([r.markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(video.title || video.filename).replace(/[^\w-]+/g, "_").slice(0, 80)}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Show notes failed");
    } finally {
      setBusy(null);
    }
  }

  async function onShare() {
    setBusy("share");
    try {
      const r = await api.shareVideo(video.id);
      if (!r.slug) throw new Error("No slug returned");
      const full = `${window.location.origin}/p/${r.slug}`;
      setShareLink(full);
      await navigator.clipboard.writeText(full).catch(() => {});
    } catch (e) {
      alert(e instanceof Error ? e.message : "Share failed");
    } finally {
      setBusy(null);
    }
  }

  async function onTranslate(lang: string) {
    setBusy("translate");
    setShowLangs(false);
    try {
      const r = await api.translate(video.id, lang);
      const segments = r.transcript as TranscriptSegment[];
      if (!Array.isArray(segments)) throw new Error("Unexpected translation shape");
      const body = formatCaptions(segments, "srt");
      const blob = new Blob([body], { type: captionMimeTypes.srt });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(video.title || video.filename).replace(/[^\w-]+/g, "_").slice(0, 80)}.${lang}.srt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Translate failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={onShowNotes}
        disabled={busy === "shownotes"}
        className="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        {busy === "shownotes" ? "Generating…" : "Show notes (.md)"}
      </button>

      <button
        onClick={onShare}
        disabled={busy === "share"}
        className="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        {busy === "share" ? "…" : shareLink ? "Link copied ✓" : "Share link"}
      </button>

      <div className="relative">
        <button
          onClick={() => setShowLangs((v) => !v)}
          disabled={busy === "translate"}
          className="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          aria-expanded={showLangs}
        >
          {busy === "translate" ? "Translating…" : "Translate SRT ▾"}
        </button>
        {showLangs && (
          <div className="absolute right-0 z-10 mt-1 w-40 rounded-md border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
            {LANGS.map((l) => (
              <button
                key={l.code}
                onClick={() => onTranslate(l.code)}
                className="block w-full px-3 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                {l.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {shareLink && (
        <span className="font-mono text-[11px] text-neutral-500" title={shareLink}>
          {shareLink.replace(/^https?:\/\//, "")}
        </span>
      )}
    </div>
  );
}
