import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { formatTimestamp } from "../lib/format";

interface Result {
  id: string;
  video_id: string;
  video_title: string;
  start_seconds: number;
  end_seconds: number;
  text: string;
  similarity: number;
}

export function SearchBar({ videoId }: { videoId?: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await api.search({ query, videoId, limit: 10 });
      setResults(r.results);
      setOpen(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={videoId ? "Search within this video…" : "Search across all videos…"}
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {loading ? "…" : "Search"}
        </button>
      </form>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-[400px] overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-1.5 text-xs text-neutral-500 dark:border-neutral-800">
            <span>{results.length} matches</span>
            <button onClick={() => setOpen(false)} className="hover:text-neutral-900 dark:hover:text-neutral-100">close</button>
          </div>
          <ul className="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
            {results.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/video/${r.video_id}#t=${Math.floor(r.start_seconds)}`}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <div className="flex items-center justify-between text-xs text-neutral-500">
                    <span className="truncate font-medium text-neutral-700 dark:text-neutral-300">
                      {r.video_title}
                    </span>
                    <span className="ml-2 shrink-0 font-mono">
                      {formatTimestamp(r.start_seconds)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-neutral-600 dark:text-neutral-400">
                    {r.text}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {open && results.length === 0 && !loading && (
        <div className="absolute left-0 right-0 z-20 mt-1 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-500 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          No matches. Try different words.
        </div>
      )}
    </div>
  );
}
