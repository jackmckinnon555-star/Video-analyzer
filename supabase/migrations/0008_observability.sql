-- Observability columns:
--   transcribe_backend  TEXT  - which transcription backend(s) succeeded for
--                              this video. Single label like "groq" / "cloudflare"
--                              or "mixed" if multiple backends contributed across
--                              chunks. NULL until transcription completes.
--
-- Useful for tracing quality regressions back to a specific provider when a
-- user reports "the transcript looks garbled."

alter table public.videos
  add column if not exists transcribe_backend text;
