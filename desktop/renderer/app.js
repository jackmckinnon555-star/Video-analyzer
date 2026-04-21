/* TRA Video Uploader — renderer.
 * Communicates with the main process via window.api (set up in preload.ts).
 */
/* global window, document */

const api = window.api;

const $ = (id) => document.getElementById(id);

const panels = {
  passwordSetup: $("password-setup"),
  idle: $("idle"),
  active: $("active"),
  done: $("done"),
  error: $("error"),
};

function showPanel(name) {
  for (const [k, el] of Object.entries(panels)) {
    el.hidden = k !== name;
  }
}

function formatBytes(n) {
  if (!n) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return v >= 10 ? `${v.toFixed(0)} ${units[i]}` : `${v.toFixed(1)} ${units[i]}`;
}

function humanDuration(seconds) {
  if (seconds == null || !isFinite(seconds)) return "";
  if (seconds < 1) return "a moment";
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return m === 1 ? "1 minute" : `${m} minutes`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (mm === 0) return h === 1 ? "1 hour" : `${h} hours`;
  return `${h}h ${mm}m`;
}

// ── State + boot ─────────────────────────────────────────────────────
let currentResultUrl = null;

async function boot() {
  const cfg = await api.getConfig();
  if (!cfg.hasPassword) {
    showPanel("passwordSetup");
  } else {
    showPanel("idle");
  }
}
boot();

// ── Password setup ───────────────────────────────────────────────────
$("password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = $("password-input").value.trim();
  if (!pw) return;
  try {
    await api.setPassword(pw);
    $("password-error").hidden = true;
    $("password-input").value = "";
    showPanel("idle");
  } catch (err) {
    $("password-error").textContent = err && err.message ? err.message : "Couldn't save password";
    $("password-error").hidden = false;
  }
});

// ── File picker + drop zone ──────────────────────────────────────────
const dropZone = $("drop-zone");
dropZone.addEventListener("click", pickAndStart);
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickAndStart(); }
});
["dragenter", "dragover"].forEach((ev) => {
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });
});
["dragleave", "drop"].forEach((ev) => {
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
  });
});
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (!f) return;
  // Electron exposes file.path on File objects dropped into a window.
  if (!f.path) {
    setError("Couldn't read the dropped file path. Try the click-to-browse option.");
    return;
  }
  startJob(f.path);
});

async function pickAndStart() {
  const filepath = await api.pickFile();
  if (filepath) startJob(filepath);
}

// ── Job lifecycle ────────────────────────────────────────────────────
async function startJob(filepath) {
  try {
    showPanel("active");
    $("file-name").textContent = filepath.split(/[\\/]/).pop();
    $("file-meta").textContent = "Reading file…";
    $("phase-label").textContent = "Starting…";
    $("phase-sub").textContent = "";
    $("progress-fill").style.width = "2%";

    // Probe first so we can show accurate duration + size.
    const info = await api.probe(filepath);
    $("file-meta").textContent = [
      formatBytes(info.sizeBytes),
      humanDuration(info.durationSeconds) + (info.durationSeconds ? " of " + (info.mode === "audio-only" ? "audio" : "video") : ""),
      info.mode === "audio-only" ? "audio-only mode (long video)" : null,
    ].filter(Boolean).join(" · ");

    const res = await api.startJob({ filepath });
    if (res.ok) {
      currentResultUrl = res.resultUrl;
      showPanel("done");
    } else {
      setError(res.message || "Upload failed");
    }
  } catch (err) {
    setError(err && err.message ? err.message : "Upload failed");
  }
}

function setError(msg) {
  $("error-message").textContent = msg;
  showPanel("error");
}

api.onProgress((p) => {
  const pct = Math.max(2, Math.min(100, (p.overallProgress ?? 0) * 100));
  $("progress-fill").style.width = pct + "%";
  switch (p.phase) {
    case "probing":
      $("phase-label").textContent = "Checking your video…";
      break;
    case "compressing":
      $("phase-label").textContent = `Compressing… ${Math.round((p.progress ?? 0) * 100)}%`;
      break;
    case "uploading":
      $("phase-label").textContent = `Uploading… ${Math.round((p.progress ?? 0) * 100)}%`;
      break;
    case "finalizing":
      $("phase-label").textContent = "Queuing for processing…";
      break;
    case "done":
      $("phase-label").textContent = "Done";
      break;
    case "canceled":
      $("phase-label").textContent = "Canceled";
      break;
    case "error":
      $("phase-label").textContent = "Error";
      break;
  }
  $("phase-sub").textContent = p.etaSeconds != null && p.phase === "compressing"
    ? `${p.message || ""}${p.message ? " · " : ""}about ${humanDuration(p.etaSeconds)} left`
    : (p.message || "");
});

$("cancel-btn").addEventListener("click", async () => {
  $("cancel-btn").disabled = true;
  await api.cancelJob();
});

$("open-result-btn").addEventListener("click", () => {
  if (currentResultUrl) api.openExternal(currentResultUrl);
});

$("upload-another-btn").addEventListener("click", () => {
  currentResultUrl = null;
  showPanel("idle");
});

$("retry-btn").addEventListener("click", () => {
  showPanel("idle");
});

// ── Settings modal ───────────────────────────────────────────────────
const modal = $("settings-modal");
$("settings-btn").addEventListener("click", async () => {
  const cfg = await api.getConfig();
  $("base-url-input").value = cfg.baseUrl;
  $("settings-password-input").value = "";
  modal.showModal();
});
$("settings-cancel").addEventListener("click", () => modal.close());
$("settings-save").addEventListener("click", async () => {
  const url = $("base-url-input").value.trim();
  const pw  = $("settings-password-input").value.trim();
  if (url) await api.setBaseUrl(url);
  if (pw) await api.setPassword(pw);
  modal.close();
  // If password state changed, re-boot panel selection.
  const cfg = await api.getConfig();
  if (!cfg.hasPassword) showPanel("passwordSetup");
  else if (!panels.active.hidden === false /* no-op */) {
    // leave current panel alone
  }
});
$("clear-password-btn").addEventListener("click", async () => {
  await api.clearPassword();
  modal.close();
  showPanel("passwordSetup");
});
