# Video Analyzer

A small-team web app that takes a long-form video upload and returns an AI-generated title, a timestamped transcript, and chapter markers with highlights. Everything runs on free tiers.

- **Frontend**: Vite + React + Tailwind on Netlify
- **Access gate**: one shared site password (no per-user accounts)
- **Storage**: Cloudflare R2 (direct-to-storage presigned uploads)
- **DB + realtime**: Supabase
- **Worker**: GitHub Actions (6-hour runtime) — a Modal GPU adapter is in `/worker-modal` for the optional speed boost
- **Transcription**: Groq Whisper v3 primary, `faster-whisper` CPU fallback in-runner
- **Analysis**: Gemini 2.5 Flash (map-reduce over transcript + sampled frames)

## One-time setup

### 1. Accounts

- [Netlify](https://netlify.com) — hosting + functions
- [Supabase](https://supabase.com) — free Postgres + realtime
- [Cloudflare R2](https://developers.cloudflare.com/r2/) — storage
- [Groq](https://console.groq.com) — Whisper API
- [Google AI Studio](https://aistudio.google.com) — Gemini API (Flash is free, Pro is paid as of April 2026)
- GitHub — repo + Actions worker

### 2. Supabase

Create a project, then apply the migration:

```bash
psql "<supabase connection string>" -f supabase/migrations/0001_init.sql
```

(Or paste the file into the SQL Editor.)

Note: the free-tier project pauses after 7 days idle. The `keepalive-supabase.yml` workflow pings it weekly to prevent that.

### 3. Cloudflare R2

- Create a bucket named (for example) `video-analyzer`
- In bucket settings, add a CORS rule:

```json
[
  {
    "AllowedOrigins": ["https://your-site.netlify.app", "http://localhost:5173", "http://localhost:8888"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

- Create an R2 API token with read/write scoped to that bucket; copy the account ID, access key, and secret.

### 4. GitHub

- Push this repo to GitHub.
- In repo Settings → Secrets and variables → Actions, add every server-side secret from `.env.example` (Supabase, R2, Groq, Gemini).
- Create a fine-grained PAT with `actions: write` scope on the repo. This goes into **Netlify's** env as `GITHUB_DISPATCH_TOKEN`.
- Optionally flip the repo to **Public** to get unlimited Actions minutes. All secrets live in GitHub Secrets, not in code, so this is safe.

### 5. Netlify

- Link the repo; build command `npm run build`, publish dir `web/dist`.
- Under Site settings → Environment variables, add everything from `.env.example` *except* the `VITE_*` ones (those get baked in at build time from the same values).

### 6. Run it

Open the Netlify URL, enter the `SITE_PASSWORD` you set, upload a video.

## Local development

```bash
cp .env.example .env
# fill in values
npm install --workspaces
cd web && npm install && cd ..
cd netlify/functions && npm install && cd ../..
cd worker && npm install && cd ..
npx netlify dev          # serves frontend + functions at http://localhost:8888
```

To run the worker locally against a real queued row:

```bash
cd worker
VIDEO_ID=<uuid> npm start
```

## Architecture

```
Browser                    Netlify Functions              GHA Worker
 │                          │                              │
 │  PasswordGate            │                              │
 │  ────────────────────▶   │                              │
 │                          │                              │
 │  presign-upload          │                              │
 │  ────────────────────▶   │ ◀── insert videos row        │
 │  ◀───── signed PUT URL   │                              │
 │                          │                              │
 │  PUT raw video           │                              │
 │  ──────── (direct to Cloudflare R2) ────────▶           │
 │                          │                              │
 │  finalize-upload         │                              │
 │  ────────────────────▶   │ ── dispatch event ─────────▶ │
 │                          │                              │ download from R2
 │                          │                              │ ffmpeg → audio + frames
 │                          │                              │ Groq Whisper (→ local fallback)
 │                          │                              │ Gemini Flash map-reduce
 │                          │                              │ write results to Supabase
 │                          │                              │ delete raw from R2
 │                          │                              │
 │  Supabase realtime subscription                         │
 │  ◀────────────────────── row update ─────────────────── │
```

## Directory layout

- `/web` — Vite React SPA
- `/netlify/functions` — presign-upload, finalize-upload, get-video, list-videos
- `/worker` — TypeScript pipeline that runs in GHA
- `/worker-modal` — optional Python/Modal GPU adapter (stub)
- `/shared` — types + zod schemas used by all three
- `/supabase/migrations` — SQL schema + RLS policies
- `/.github/workflows` — process-video, keepalive-supabase

## Free-tier reality check

- **R2**: 10 GB cap. Raw videos are deleted after processing; only transcript + chapter JSON is kept. A 2-hour 1080p MP4 is 2–6 GB, so **do not skip the cleanup step**.
- **Groq Whisper**: ~8 hours of audio/day. On exhaustion the worker falls back to `faster-whisper` running inside the GHA runner (CPU, ~2–4× realtime with the `small` model).
- **Gemini Flash**: generous RPM but has a daily cap; map-reduce keeps each call small. Pro is no longer free (as of April 2026).
- **Supabase**: 500 MB Postgres, auto-pauses after 7 days idle (weekly keepalive ping handles this).
- **GHA**: 2,000 min/mo on private repos, unlimited on public. Make the repo public if you expect >25 two-hour videos/month.
- **Netlify**: the presign + finalize functions combined cost <1 invocation per upload. Realtime UI updates come from Supabase, not polling.

## Enhancements (not yet wired up)

See the approved plan at `/C:\Users\deadc\.claude\plans\i-want-to-make-precious-yeti.md` for the full enhancement menu (semantic search over videos via `gemini-embedding-001` + pgvector, RAG chat, short-form clip suggestions, show notes export, public share links, RSS for podcasts, WhisperX for speaker diarization).

## Security

- The site password is enforced in Netlify functions via `X-Site-Password` header (constant-time compare). Set a long random string.
- R2 bucket is private; presigned URLs are scoped to a specific `videoId` path and bound to `ContentType` + `ContentLength`, with a 15-minute expiry.
- Supabase Row Level Security is enabled: anon clients can only SELECT; all writes go through the service role used by Netlify functions and the worker.
- Service role key and R2 credentials live in Netlify env + GHA secrets only. Never in the frontend bundle.
