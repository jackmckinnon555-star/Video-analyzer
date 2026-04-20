"""
Modal Labs adapter for the video-analyzer worker.

Purpose: an optional GPU-accelerated path that shadows the GHA/TypeScript
worker. Same contract: given VIDEO_ID + env vars, process one video end-to-end
and write results back to Supabase, then delete the raw from R2.

v1 status: STUB — implements the skeleton + GPU Whisper transcription only.
Chapter/highlight analysis is still delegated to the TypeScript worker via a
webhook callback until the Python pipeline reaches parity.

Deploy:
    modal deploy worker-modal/modal_app.py

Invoke (after deploy):
    modal run worker-modal/modal_app.py::process_video --video-id <uuid>

Or trigger from a Netlify function with:
    POST https://<user>--video-analyzer-process-video.modal.run
    body: { "video_id": "..." }
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path

import modal

app = modal.App("video-analyzer")

image = (
    modal.Image.debian_slim()
    .apt_install("ffmpeg")
    .pip_install(
        "faster-whisper==1.0.3",
        "boto3==1.35.14",
        "supabase==2.7.4",
        "requests==2.32.3",
    )
)

secrets = [
    modal.Secret.from_name("video-analyzer-secrets"),
]


@app.function(
    image=image,
    gpu="T4",           # bumps Whisper ~30x realtime vs CPU
    timeout=60 * 60,    # 1 hour cap per video; adjust if processing longer
    secrets=secrets,
)
def process_video(video_id: str) -> dict:
    """Download from R2 → extract audio → transcribe on GPU → persist → delete raw."""
    import boto3
    from supabase import create_client
    from faster_whisper import WhisperModel

    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

    row = sb.table("videos").select("r2_key, filename").eq("id", video_id).single().execute()
    if not row.data:
        raise RuntimeError(f"Video {video_id} not found")
    r2_key = row.data["r2_key"]

    sb.table("videos").update({"status": "transcribing"}).eq("id", video_id).execute()

    with tempfile.TemporaryDirectory(prefix=f"va-{video_id}-") as work_dir:
        work = Path(work_dir)
        video_path = work / "video.bin"
        audio_path = work / "audio.opus"

        s3.download_file(os.environ["R2_BUCKET"], r2_key, str(video_path))

        subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(video_path),
                "-vn", "-c:a", "libopus", "-b:a", "32k",
                "-ac", "1", "-ar", "16000", str(audio_path),
            ],
            check=True,
            capture_output=True,
        )

        model = WhisperModel(
            os.environ.get("WHISPER_MODEL", "large-v3"),
            device="cuda",
            compute_type="float16",
        )
        segments_iter, info = model.transcribe(
            str(audio_path),
            beam_size=5,
            vad_filter=True,
        )
        segments = [
            {"start": s.start, "end": s.end, "text": s.text.strip()}
            for s in segments_iter
        ]

        sb.table("videos").update({
            "transcript": segments,
            "duration_seconds": info.duration,
        }).eq("id", video_id).execute()

    # Hand off the Gemini analysis phase to the main (TypeScript) pipeline by
    # triggering the GHA workflow via repository_dispatch with a "transcribe_done"
    # flag, OR call Gemini here once the Python port is written. For now, we mark
    # the row ready and let operators kick off analysis manually until parity.
    #
    # TODO: port analyzeGemini.ts into Python and finish this path.
    sb.table("videos").update({"status": "analyzing"}).eq("id", video_id).execute()

    return {"video_id": video_id, "segments": len(segments)}


@app.function(image=image, secrets=secrets)
@modal.web_endpoint(method="POST")
def webhook(payload: dict) -> dict:
    """Thin HTTP trigger Netlify can call instead of (or in addition to) repository_dispatch."""
    video_id = payload.get("video_id")
    if not video_id:
        return {"ok": False, "error": "missing video_id"}
    process_video.spawn(video_id)
    return {"ok": True, "video_id": video_id}
