-- Video Analyzer — one-shot setup SQL
-- Paste this entire file into Supabase SQL editor and run once.
-- Idempotent: safe to re-run.

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- Videos table (final schema, column names already reflect Supabase Storage backend).
create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  uploader_name text,
  storage_path text not null,
  filename text not null,
  size_bytes bigint,
  duration_seconds numeric,
  detected_language text,
  status text not null default 'pending'
    check (status in ('pending','queued','transcribing','analyzing','done','failed')),
  title text,
  transcript jsonb,
  chapters jsonb,
  highlights jsonb,
  entities jsonb,
  keywords jsonb,
  key_quotes jsonb,
  thumbnail_url text,
  preview_path text,
  error text,
  dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists videos_created_at_idx
  on public.videos (created_at desc);

create or replace function public.videos_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists videos_updated_at on public.videos;
create trigger videos_updated_at
  before update on public.videos
  for each row execute function public.videos_set_updated_at();

alter table public.videos enable row level security;

drop policy if exists videos_select_all on public.videos;
create policy videos_select_all on public.videos
  for select using (true);

-- No insert/update/delete policy for anon: all writes go through server-side
-- functions using the service role (which bypasses RLS).

-- Semantic search chunks (forward-compatible with Tier-2 semantic search enhancement).
create table if not exists public.video_chunks (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  start_seconds numeric not null,
  end_seconds numeric not null,
  text text not null,
  embedding vector(3072),
  created_at timestamptz not null default now()
);

create index if not exists video_chunks_video_id_idx
  on public.video_chunks (video_id);

alter table public.video_chunks enable row level security;

drop policy if exists video_chunks_select_all on public.video_chunks;
create policy video_chunks_select_all on public.video_chunks
  for select using (true);

-- The `videos` storage bucket is created via the Storage API (the app's deploy
-- script does it programmatically). If you want to ensure it exists via SQL:
-- insert into storage.buckets (id, name, public, file_size_limit)
-- values ('videos', 'videos', false, 52428800)
-- on conflict (id) do nothing;
