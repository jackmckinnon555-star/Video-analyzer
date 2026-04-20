import { envOptional } from "./env.js";
import { log } from "./log.js";

export interface AlertPayload {
  videoId: string;
  phase: string;
  error: string;
  ghaRunUrl?: string;
  extra?: Record<string, unknown>;
}

/**
 * Fan out a failure alert to every configured channel. Each channel is behind
 * its own env var; missing env = silently skipped, so you can enable any
 * subset. Every send is best-effort — we never let an alert failure mask the
 * original worker error.
 */
export async function sendFailureAlert(p: AlertPayload): Promise<void> {
  await Promise.all([
    sendDiscord(p).catch((e) => log.warn("alert: discord failed", { e: String(e) })),
    sendSlack(p).catch((e) => log.warn("alert: slack failed", { e: String(e) })),
    sendEmail(p).catch((e) => log.warn("alert: email failed", { e: String(e) })),
  ]);
}

async function sendDiscord(p: AlertPayload): Promise<void> {
  const webhook = envOptional("DISCORD_WEBHOOK_URL");
  if (!webhook) return;
  const content = buildMessage(p);
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      username: "TRA Video Analyzer",
    }),
  });
  if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text()}`);
}

async function sendSlack(p: AlertPayload): Promise<void> {
  const webhook = envOptional("SLACK_WEBHOOK_URL");
  if (!webhook) return;
  const text = buildMessage(p);
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Slack ${res.status}: ${await res.text()}`);
}

async function sendEmail(p: AlertPayload): Promise<void> {
  const key = envOptional("RESEND_API_KEY");
  const to = envOptional("ALERT_EMAIL");
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
      from: envOptional("RESEND_FROM") ?? "alerts@onresend.dev",
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
  if (p.ghaRunUrl) lines.push(`run: ${p.ghaRunUrl}`);
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
