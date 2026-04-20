-- Columns for Batch 2 features.
-- Runs after 0001-0006.

alter table public.videos
  add column if not exists show_notes text,
  add column if not exists translations jsonb,
  add column if not exists public_slug text;

-- Slug is case-sensitive and unique.
create unique index if not exists videos_public_slug_idx
  on public.videos (public_slug)
  where public_slug is not null;
