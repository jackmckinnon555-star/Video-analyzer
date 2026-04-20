-- Add detected language to videos
alter table public.videos
  add column if not exists detected_language text;
