import { app, BrowserWindow, ipcMain, shell, dialog } from "electron";
import path from "node:path";
import {
  DEFAULT_BASE_URL,
  type AppConfig,
  type CompressOptions,
  type JobError,
  type JobProgress,
  type JobResult,
  type ProbeResult,
} from "./ipc.js";
import {
  getBaseUrl,
  getPassword,
  hasPassword,
  setBaseUrl,
  setPassword,
  clearPassword,
} from "./config.js";
import { probe, compressAndUpload, cancelRun, type RunContext } from "./compressor.js";

let mainWindow: BrowserWindow | null = null;
let currentRun: RunContext | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 560,
    minWidth: 560,
    minHeight: 460,
    backgroundColor: "#0B2A4A",
    title: "TRA Video Uploader",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    autoHideMenuBar: true,
    show: false,
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // External links open in default browser, not a new Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const rendererIndex = path.resolve(__dirname, "..", "renderer", "index.html");
  await mainWindow.loadFile(rendererIndex);
}

app.whenReady().then(async () => {
  await createWindow();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on("window-all-closed", () => {
  if (currentRun) {
    cancelRun(currentRun);
    currentRun = null;
  }
  if (process.platform !== "darwin") app.quit();
});

// ─── IPC handlers ───────────────────────────────────────────────────────

ipcMain.handle("config:get", (): AppConfig => ({
  baseUrl: getBaseUrl(),
  hasPassword: hasPassword(),
}));

ipcMain.handle("config:set-base-url", (_e, url: string) => {
  setBaseUrl(url);
  return { baseUrl: getBaseUrl(), hasPassword: hasPassword() };
});

ipcMain.handle("config:set-password", (_e, pw: string) => {
  if (!pw || pw.length < 1) throw new Error("Password required");
  setPassword(pw);
  return { ok: true };
});

ipcMain.handle("config:clear-password", () => {
  clearPassword();
  return { ok: true };
});

ipcMain.handle("file:probe", async (_e, filepath: string): Promise<ProbeResult> => {
  return probe(filepath);
});

ipcMain.handle("file:pick", async (): Promise<string | null> => {
  const res = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openFile"],
    filters: [
      { name: "Video / audio", extensions: ["mp4", "mov", "m4v", "mkv", "webm", "avi", "wmv", "mp3", "m4a", "wav", "aac", "ogg", "opus", "flac"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0] ?? null;
});

ipcMain.handle("job:start", async (_e, opts: CompressOptions): Promise<JobResult | JobError> => {
  if (currentRun) return { ok: false, message: "Another job is already running." };
  const baseUrl = getBaseUrl();
  const password = getPassword();
  if (!password) return { ok: false, message: "Password not set — open Settings." };

  const ctx: RunContext = {
    ffmpegProc: null,
    abortController: new AbortController(),
    canceled: false,
  };
  currentRun = ctx;

  const emit = (p: JobProgress) => mainWindow?.webContents.send("job:progress", p);

  try {
    const { videoId, resultUrl } = await compressAndUpload(
      opts.filepath,
      baseUrl,
      password,
      emit,
      ctx,
    );
    return { ok: true, videoId, resultUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (ctx.canceled || /canceled/i.test(msg)) {
      emit({ phase: "canceled", progress: 0, overallProgress: 0, message: "Canceled" });
      return { ok: false, message: "Canceled" };
    }
    // Auto-clear saved password on a 401 so the user can re-enter.
    if (/invalid site password|^401/i.test(msg)) {
      clearPassword();
    }
    emit({ phase: "error", progress: 0, overallProgress: 0, message: msg });
    return { ok: false, message: msg };
  } finally {
    currentRun = null;
  }
});

ipcMain.handle("job:cancel", () => {
  if (currentRun) cancelRun(currentRun);
  return { ok: true };
});

ipcMain.handle("shell:open-external", (_e, url: string) => {
  shell.openExternal(url);
  return { ok: true };
});

// ─── Fallback for DEFAULT_BASE_URL reference so TS doesn't dead-code it
export { DEFAULT_BASE_URL };
