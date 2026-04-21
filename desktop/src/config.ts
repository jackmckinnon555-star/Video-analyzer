import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { DEFAULT_BASE_URL } from "./ipc.js";

interface PersistedConfig {
  baseUrl?: string;
  password?: string;
}

function configPath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

function readConfig(): PersistedConfig {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    return JSON.parse(raw) as PersistedConfig;
  } catch {
    return {};
  }
}

function writeConfig(cfg: PersistedConfig): void {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

/** Env var override always wins. */
function envPassword(): string | null {
  return process.env["VIDEO_ANALYZER_PASSWORD"] ?? null;
}

export function getBaseUrl(): string {
  return readConfig().baseUrl || DEFAULT_BASE_URL;
}

export function setBaseUrl(url: string): void {
  const cfg = readConfig();
  cfg.baseUrl = url.replace(/\/+$/, "");
  writeConfig(cfg);
}

export function getPassword(): string | null {
  return envPassword() ?? readConfig().password ?? null;
}

export function setPassword(pw: string): void {
  const cfg = readConfig();
  cfg.password = pw;
  writeConfig(cfg);
}

export function clearPassword(): void {
  const cfg = readConfig();
  delete cfg.password;
  writeConfig(cfg);
}

export function hasPassword(): boolean {
  return getPassword() !== null;
}
