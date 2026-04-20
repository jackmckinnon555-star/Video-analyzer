alter table public.videos
  add column if not exists preview_key text;
