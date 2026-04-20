-- Semantic search + RAG infrastructure.
-- Runs after 0001-0005.

-- The `embedding` column on video_chunks already exists (from 0001) as vector(3072)
-- for gemini-embedding-001 default output. Add an HNSW index for fast top-K
-- similarity lookup (HNSW is safe on free-tier Postgres; IVFFlat needs ANALYZE
-- and re-training after inserts).
create index if not exists video_chunks_embedding_hnsw
  on public.video_chunks using hnsw (embedding vector_cosine_ops);

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
