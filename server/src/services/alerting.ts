import { createTransport, type Transporter } from "nodemailer";
import { logger } from "../middleware/logger.js";

// Alert types
export type AlertType = "health_down" | "eval_failed" | "agent_error" | "budget_breach" | "backup_failed";

export interface AlertRecord {
  id: string;
  type: AlertType;
  subject: string;
  body: string;
  sentAt: string;
  emailSent: boolean;
  error?: string;
}

// In-memory ring buffer of recent alerts (last 50)
const recentAlerts: AlertRecord[] = [];
const MAX_ALERTS = 50;

// Dedup cooldown: don't re-send same alert type within this window
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const lastSentByType = new Map<string, number>();

// Lazy SMTP transporter
let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  transporter = createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return transporter;
}

export function getRecentAlerts(): AlertRecord[] {
  return [...recentAlerts].reverse(); // newest first
}

export async function sendAlert(type: AlertType, subject: string, body: string): Promise<void> {
  // Check cooldown
  const lastSent = lastSentByType.get(type);
  if (lastSent && Date.now() - lastSent < COOLDOWN_MS) {
    logger.debug({ type }, "Alert suppressed (cooldown)");
    return;
  }

  const record: AlertRecord = {
    id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    subject,
    body,
    sentAt: new Date().toISOString(),
    emailSent: false,
  };

  const smtp = getTransporter();
  const to = process.env.ALERT_EMAIL_TO;
  const from = process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER;

  if (smtp && to && from) {
    try {
      await smtp.sendMail({
        from,
        to,
        subject: `[Team Dashboard] ${subject}`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:600px">
          <h2 style="color:#ef4444">${subject}</h2>
          <p style="color:#666;font-size:12px">Alert type: ${type} | ${new Date().toISOString()}</p>
          <div style="background:#f8f8f8;padding:16px;border-radius:8px;margin:16px 0">
            <pre style="white-space:pre-wrap;font-size:14px">${body}</pre>
          </div>
          <p style="color:#999;font-size:11px">Sent by Team Dashboard alerting system</p>
        </div>`,
      });

      record.emailSent = true;
      lastSentByType.set(type, Date.now());
      logger.info({ type, subject }, "Alert email sent");
    } catch (err) {
      record.error = `SMTP error: ${err instanceof Error ? err.message : String(err)}`;
      logger.warn({ err, type }, "Alert email send error");
    }
  } else {
    record.error = "SMTP not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS, ALERT_EMAIL_TO)";
    logger.debug({ type, subject }, "Alert recorded (no SMTP config)");
  }

  // Always store in memory regardless of email success
  recentAlerts.push(record);
  if (recentAlerts.length > MAX_ALERTS) recentAlerts.shift();
  lastSentByType.set(type, Date.now());
}
