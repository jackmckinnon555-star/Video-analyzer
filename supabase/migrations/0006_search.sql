-- Semantic search + RAG infrastructure.
-- Runs after 0001-0005.
--
-- The `embedding` column on video_chunks is vector(3072) — gemini-embedding-001's
-- default output. pgvector's index types (HNSW + IVFFLAT) both cap at 2000
-- dimensions, so we can't index a 3072-dim column without halfvec or an
-- extension. For the small-team scale this app targets (low thousands of
-- chunks), sequential scan over the embeddings is sub-millisecond and the
-- index would be premature optimization. Add an index later via halfvec
-- (4000-dim HNSW limit) once row counts get into the high tens of thousands.

-- Drop any leftover index attempts from earlier versions of this migration.
drop index if exists public.video_chunks_embedding_hnsw;
drop index if exists public.video_chunks_embedding_ivfflat;

-- Helper function that the search endpoint calls. Returns rows sorted by
-- cosine distance, with the parent video's title for display.
create or replace function public.match_video_chunks(
  query_embedding vector(3072),
  match_count int default 10,
  filter_video_id uuid default null
)
returns table (
  id uuid,
  video_id uuid,
  video_title text,
  start_seconds numeric,
  end_seconds numeric,
  text text,
  similarity float
)
language sql stable
as $$
  select
    c.id,
    c.video_id,
    coalesce(v.title, v.filename) as video_title,
    c.start_seconds,
    c.end_seconds,
    c.text,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.video_chunks c
  join public.videos v on v.id = c.video_id
  where
    c.embedding is not null
    and (filter_video_id is null or c.video_id = filter_video_id)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- Allow the anon role to call the function (the frontend hits search via the
-- Netlify function, but keeping it open lets future features call directly
-- with RLS-guarded reads).
grant execute on function public.match_video_chunks(vector, int, uuid) to anon, authenticated, service_role;
