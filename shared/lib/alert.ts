// Failure-alert fan-out shared by the worker and Netlify functions.
// Each channel is behind its own env var; missing env = silently skipped.
// Every send is best-effort — alerts must never mask the original error.

export interface AlertPayload {
  videoId: string;
  /** Stage where the failure happened — e.g. "transcribing", "dispatch", "worker". */
  phase: string;
  error: string;
  /** Optional URL where the user can dig deeper (GHA run, function log, etc.). */
  detailUrl?: string;
  extra?: Record<string, unknown>;
}

export async function sendFailureAlert(p: AlertPayload): Promise<void> {
  await Promise.all([
    sendDiscord(p).catch((e) => console.warn("[alert] discord failed:", String(e))),
    sendSlack(p).catch((e) => console.warn("[alert] slack failed:", String(e))),
    sendEmail(p).catch((e) => console.warn("[alert] email failed:", String(e))),
  ]);
}

async function sendDiscord(p: AlertPayload): Promise<void> {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return;
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: buildMessage(p),
      username: "TRA Video Analyzer",
    }),
  });
  if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text()}`);
}

async function sendSlack(p: AlertPayload): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: buildMessage(p) }),
  });
  if (!res.ok) throw new Error(`Slack ${res.status}: ${await res.text()}`);
}

async function sendEmail(p: AlertPayload): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL;
  if (!key || !to) return;
  const subject = `[Video Analyzer] ${p.phase} failed for ${p.videoId.slice(0, 8)}`;
  const html = `<pre style="font-family:monospace;font-size:12px;line-height:1.5">${escapeHtml(
    buildMessage(p),
  )}</pre>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM ?? "alerts@onresend.dev",
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

function buildMessage(p: AlertPayload): string {
  const lines = [
    `⚠️  Video Analyzer failure`,
    `video: ${p.videoId}`,
    `phase: ${p.phase}`,
    `error: ${p.error}`,
  ];
  if (p.detailUrl) lines.push(`detail: ${p.detailUrl}`);
  if (p.extra) lines.push(`extra: ${JSON.stringify(p.extra)}`);
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
