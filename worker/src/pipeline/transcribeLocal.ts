import { spawn } from "node:child_process";
import { writeFile, readFile, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { log } from "../lib/log.js";
import type { TranscriptSegment } from "../../../shared/types/video.js";
import type { AudioChunk } from "./extractAudio.js";
import type { ChunkResult } from "./transcribeGroq.js";

/**
 * Per-chunk faster-whisper fallback. Runs in-runner on CPU (int8),
 * ~2-4x realtime with the `small` model. Offsets segment timestamps
 * by chunk.startOffsetSeconds to align with global video time.
 *
 * Python + faster-whisper must already be installed (GHA workflow does this).
 * Model size env: WHISPER_LOCAL_MODEL (default: "small").
 */
export async function transcribeChunkLocal(chunk: AudioChunk): Promise<ChunkResult> {
  const model = process.env.WHISPER_LOCAL_MODEL ?? "small";
  const tmp = await mkdtemp(path.join(tmpdir(), "fwhisper-"));
  const script = path.join(tmp, "run.py");
  const outFile = path.join(tmp, "out.json");

  await writeFile(
    script,
    `
import json, sys
from faster_whisper import WhisperModel
model = WhisperModel("${model}", device="cpu", compute_type="int8")
segments, info = model.transcribe(
    sys.argv[1],
    beam_size=1,
    vad_filter=True,
    word_timestamps=True,
)
out = {
    "language": info.language,
    "segments": [
        {
            "start": s.start,
            "end": s.end,
            "text": s.text.strip(),
            "words": [
                {"start": w.start, "end": w.end, "text": w.word}
                for w in (s.words or [])
            ],
        }
        for s in segments
    ],
}
with open(sys.argv[2], "w", encoding="utf-8") as f:
    json.dump(out, f)
`,
    "utf8",
  );

  log.info("local whisper chunk", { model, chunkPath: chunk.path, offset: chunk.startOffsetSeconds });
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("python3", [script, chunk.path, outFile], { stdio: "inherit" });
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`faster-whisper exited ${code}`)),
    );
  });

  const raw = await readFile(outFile, "utf8");
  const parsed = JSON.parse(raw) as {
    language?: string;
    segments: Array<{
      start: number;
      end: number;
      text: string;
      words?: Array<{ start: number; end: number; text: string }>;
    }>;
  };
  const segments: TranscriptSegment[] = parsed.segments.map((s) => ({
    start: s.start + chunk.startOffsetSeconds,
    end: s.end + chunk.startOffsetSeconds,
    text: s.text,
    words: s.words?.map((w) => ({
      start: w.start + chunk.startOffsetSeconds,
      end: w.end + chunk.startOffsetSeconds,
      text: w.text,
    })),
  }));
  return { segments, language: parsed.language ?? null };
}
