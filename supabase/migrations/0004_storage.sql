-- Create the `videos` storage bucket and allow uploads up to 5 GB per file.
-- Run after 0001/0002/0003.

insert into storage.buckets (id, name, public, file_size_limit)
values ('videos', 'videos', false, 5368709120)       -- 5 GiB per file
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  public = excluded.public;

-- Rename r2_key -> storage_path for clarity (same logical field, new backend).
alter table public.videos rename column r2_key to storage_path;
alter table public.videos rename column preview_key to preview_path;

-- No custom RLS on storage.objects needed: our app uses server-side signed URLs
-- (service role key), and Supabase's default storage policies block anon
-- reads/writes. Signed URLs bypass RLS and are the only way the browser
-- interacts with the bucket.
