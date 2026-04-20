-- Per-chunk / per-phase progress for the processing UI.
-- Worker writes here; browser subscribes via realtime and renders a live badge.

alter table public.videos
  add column if not exists progress jsonb;

-- Shape written by the worker:
-- {
--   "phase": "transcribing" | "analyzing" | "embedding",
--   "chunk_index": int,       -- 1-based, optional
--   "total_chunks": int,      -- optional
--   "message": string,        -- short human-readable hint
--   "updated_at": iso-string
-- }
