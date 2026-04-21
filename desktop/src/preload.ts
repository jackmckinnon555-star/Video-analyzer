import { contextBridge, ipcRenderer } from "electron";
import type {
  AppConfig,
  CompressOptions,
  JobProgress,
  JobResult,
  JobError,
  ProbeResult,
} from "./ipc.js";

// Expose a narrow, typed API to the renderer via contextBridge.
const api = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke("config:get"),
  setBaseUrl: (url: string): Promise<AppConfig> =>
    ipcRenderer.invoke("config:set-base-url", url),
  setPassword: (pw: string): Promise<{ ok: true }> =>
    ipcRenderer.invoke("config:set-password", pw),
  clearPassword: (): Promise<{ ok: true }> =>
    ipcRenderer.invoke("config:clear-password"),
  pickFile: (): Promise<string | null> => ipcRenderer.invoke("file:pick"),
  probe: (filepath: string): Promise<ProbeResult> =>
    ipcRenderer.invoke("file:probe", filepath),
  startJob: (opts: CompressOptions): Promise<JobResult | JobError> =>
    ipcRenderer.invoke("job:start", opts),
  cancelJob: (): Promise<{ ok: true }> => ipcRenderer.invoke("job:cancel"),
  openExternal: (url: string): Promise<{ ok: true }> =>
    ipcRenderer.invoke("shell:open-external", url),
  onProgress: (cb: (p: JobProgress) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: JobProgress) => cb(p);
    ipcRenderer.on("job:progress", handler);
    return () => ipcRenderer.removeListener("job:progress", handler);
  },
};

contextBridge.exposeInMainWorld("api", api);

// Extend Window for the renderer's TS (if it ever adds any).
declare global {
  interface Window {
    api: typeof api;
  }
}
