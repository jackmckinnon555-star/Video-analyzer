-- Multi-part uploads: support source files longer than the audio-only ladder
-- can cover (~14.5 hr at 8 kbps mono AAC). The desktop uploader splits very
-- long inputs into ~6-hour segments, each compressed + uploaded as its own
-- video row. The worker then sees the parent row, gathers siblings, and
-- transcribes/analyzes them as a single unit, writing results to the parent.
--
-- Convention:
--   Standalone video:  parent_video_id = NULL, part_index = NULL, total_parts = NULL
--   Multi-part PARENT (part 1):
--                      parent_video_id = NULL, part_index = 1,    total_parts = N
--   Multi-part CHILD (parts 2..N):
--                      parent_video_id = <parent's id>, part_index = k, total_parts = N
--
-- Dashboard queries should filter `parent_video_id IS NULL` to only show
-- standalones + part-1 (which represents the whole logical upload).

alter table public.videos
  add column if not exists parent_video_id uuid references public.videos(id) on delete cascade,
  add column if not exists part_index int,
  add column if not exists total_parts int;

create index if not exists videos_parent_idx on public.videos(parent_video_id) where parent_video_id is not null;
