-- Video Analyzer — initial schema (shared-team mode: one pool of videos, no per-user auth)
-- Apply with: supabase db push  (or paste into the Supabase SQL editor)

create extension if not exists "pgcrypto";
create extension if not exists "vector";

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  uploader_name text,                                 -- optional free-text label, e.g. "alex"
  r2_key text not null,
  filename text not null,
  size_bytes bigint,
  duration_seconds numeric,
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

-- Access model: the team shares a site password enforced at the Netlify function layer.
-- All writes go through functions using the service role. Reads from the browser
-- use the anon key against an open SELECT policy (the site password gate prevents
-- strangers from reaching the page in the first place).
alter table public.videos enable row level security;

drop policy if exists videos_select_all on public.videos;
create policy videos_select_all on public.videos
  for select using (true);

-- No insert / update / delete policy for anon: those operations require the service role.

-- Semantic-search chunks (Tier 2 enhancement).
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
-- pgvector HNSW index (uncomment after chunks exist; free-tier safe)
-- create index if not exists video_chunks_embedding_hnsw
--   on public.video_chunks using hnsw (embedding vector_cosine_ops);

alter table public.video_chunks enable row level security;

drop policy if exists video_chunks_select_all on public.video_chunks;
create policy video_chunks_select_all on public.video_chunks
  for select using (true);
