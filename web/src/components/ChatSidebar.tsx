import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { formatTimestamp } from "../lib/format";

interface Source {
  video_id: string;
  video_title: string;
  start_seconds: number;
  snippet: string;
}
interface Turn {
  q: string;
  a: string | null;
  sources: Source[];
  err?: string;
}

export function ChatSidebar({ videoId }: { videoId?: string }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || thinking) return;
    setInput("");
    setTurns((t) => [...t, { q, a: null, sources: [] }]);
    setThinking(true);
    try {
      const r = await api.ragChat({ question: q, videoId });
      setTurns((t) =>
        t.map((turn, i) => (i === t.length - 1 ? { ...turn, a: r.answer, sources: r.sources } : turn)),
      );
    } catch (err) {
      setTurns((t) =>
        t.map((turn, i) =>
          i === t.length - 1
            ? { ...turn, a: "", err: err instanceof Error ? err.message : "Chat failed", sources: [] }
            : turn,
        ),
      );
    } finally {
      setThinking(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm shadow-lg hover:shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
        aria-label="Open chat"
      >
        <span aria-hidden>💬</span>
        <span>Ask about {videoId ? "this video" : "all videos"}</span>
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-6 right-6 z-30 flex h-[60vh] w-[90vw] max-w-md flex-col rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
      role="dialog"
      aria-label="AI chat"
    >
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <span className="text-sm font-medium">
          Chat · {videoId ? "this video" : "all videos"}
        </span>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          aria-label="Close chat"
        >
          ×
        </button>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        {turns.length === 0 && (
          <p className="text-xs text-neutral-500">
            Ask anything about your {videoId ? "video" : "video library"}.
            Answers cite the source video + timestamp.
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <div className="rounded-md bg-neutral-100 px-3 py-2 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100">
              {t.q}
            </div>
            {t.a === null ? (
              <div className="text-xs text-neutral-500">Thinking…</div>
            ) : t.err ? (
              <div className="text-xs text-red-600">{t.err}</div>
            ) : (
              <>
                <div className="whitespace-pre-wrap">{t.a}</div>
                {t.sources.length > 0 && (
                  <div className="space-y-1 border-l-2 border-neutral-200 pl-2 text-xs dark:border-neutral-800">
                    {t.sources.map((s, j) => (
                      <Link
                        key={j}
                        to={`/video/${s.video_id}#t=${Math.floor(s.start_seconds)}`}
                        className="block text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                      >
                        {s.video_title} @ {formatTimestamp(s.start_seconds)}
                      </Link>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={ask} className="flex items-center gap-2 border-t border-neutral-200 p-2 dark:border-neutral-800">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask…"
          className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        />
        <button
          type="submit"
          disabled={thinking || !input.trim()}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {thinking ? "…" : "Ask"}
        </button>
      </form>
    </div>
  );
}
