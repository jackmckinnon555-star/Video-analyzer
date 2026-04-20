import type { TranscriptSegment } from "../types/video.js";

export type CaptionFormat = "srt" | "vtt" | "txt" | "json";

export function formatCaptions(
  segments: TranscriptSegment[],
  format: CaptionFormat,
): string {
  switch (format) {
    case "srt":
      return toSrt(segments);
    case "vtt":
      return toVtt(segments);
    case "txt":
      return toTxt(segments);
    case "json":
      return JSON.stringify(segments, null, 2);
  }
}

export const captionMimeTypes: Record<CaptionFormat, string> = {
  srt: "application/x-subrip",
  vtt: "text/vtt",
  txt: "text/plain",
  json: "application/json",
};

function toSrt(segs: TranscriptSegment[]): string {
  return segs
    .map(
      (s, i) =>
        `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${prefix(s)}${s.text}\n`,
    )
    .join("\n");
}

function toVtt(segs: TranscriptSegment[]): string {
  const body = segs
    .map(
      (s) =>
        `${vttTime(s.start)} --> ${vttTime(s.end)}\n${prefix(s)}${s.text}\n`,
    )
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

function toTxt(segs: TranscriptSegment[]): string {
  // Plain reading transcript; blank line between speaker turns.
  const lines: string[] = [];
  let lastSpeaker: string | undefined;
  for (const s of segs) {
    if (s.speaker && s.speaker !== lastSpeaker) {
      if (lines.length) lines.push("");
      lines.push(`${s.speaker}:`);
      lastSpeaker = s.speaker;
    }
    lines.push(s.text);
  }
  return lines.join("\n");
}

function prefix(s: TranscriptSegment): string {
  return s.speaker ? `<v ${s.speaker}>` : "";
}

function srtTime(seconds: number): string {
  return formatClock(seconds, ",");
}

function vttTime(seconds: number): string {
  return formatClock(seconds, ".");
}

function formatClock(seconds: number, msSep: string): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${msSep}${pad(ms, 3)}`;
}
