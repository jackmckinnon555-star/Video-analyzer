import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";

export const ffmpegBin = (ffmpegStatic as unknown as string) || "ffmpeg";

export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

export async function probeDurationSeconds(videoPath: string): Promise<number | null> {
  // Use ffmpeg -i stderr parsing (ffprobe not bundled with ffmpeg-static).
  return new Promise((resolve) => {
    const proc = spawn(ffmpegBin, ["-i", videoPath], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      if (!m) return resolve(null);
      const [, h, mm, s] = m;
      resolve(Number(h) * 3600 + Number(mm) * 60 + Number(s));
    });
    proc.on("error", () => resolve(null));
  });
}
