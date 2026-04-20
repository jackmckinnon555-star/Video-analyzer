# Modal worker (optional GPU-accelerated adapter)

The primary worker lives in `/worker` and runs in GitHub Actions. This directory contains an **optional** Python port that runs on [Modal](https://modal.com) — offering GPU-accelerated Whisper and ~30× realtime transcription vs. the CPU path.

## Status

**Stub.** Transcription is implemented; Gemini analysis is still handled by the TypeScript worker. The orchestration hand-off across the two workers is intentionally not wired up in v1 — use Modal only if transcription time is the bottleneck.

## Setup

```bash
pip install modal
modal token new
modal secret create video-analyzer-secrets \
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
    R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=...
modal deploy worker-modal/modal_app.py
```

After deploy, Modal prints a URL for the `webhook` endpoint. Set that URL on Netlify as an alternative dispatch target for `finalize-upload.ts`.

## Free-tier notes

- $30/month recurring compute credit ≈ 50 hours of T4 or 7.5 hours of H100.
- A 2-hour podcast on T4 = ~4 min of GPU time. Budget caps at roughly 15 two-hour videos/month on the free credit.
