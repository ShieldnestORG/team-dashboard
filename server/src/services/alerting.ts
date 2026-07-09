import { createTransport, type Transporter } from "nodemailer";
import { logger } from "../middleware/logger.js";
import { sendMailBrevoFirst, brevoConfigured } from "./brevo.js";
import { alertEvents, type Db } from "@paperclipai/db";

// Alert types
export type AlertType =
  | "health_down" | "eval_failed" | "agent_error" | "budget_breach" | "backup_failed"
  | "service_down" | "service_recovered" | "disk_warning" | "memory_warning" | "cron_stale"
  | "cron_breaker" | "weekly_recap";

// Severity routing: "critical" types email immediately; "routine" types are
// only persisted to alert_events and surfaced by the Sunday alert:weekly-recap
// cron. Keep the routine set small — it exists to stop inbox noise, not to
// hide outages.
export type AlertSeverity = "critical" | "routine";

const ROUTINE_TYPES: ReadonlySet<AlertType> = new Set(["cron_stale", "eval_failed"]);

export function alertSeverity(type: AlertType): AlertSeverity {
  return ROUTINE_TYPES.has(type) ? "routine" : "critical";
}

export interface AlertRecord {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
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

// Optional DB handle so alerts persist to alert_events (set at boot via
// startAlertCrons; alerting still works in-memory without it).
let alertDb: Db | null = null;

export function setAlertDb(db: Db): void {
  alertDb = db;
}

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

  const severity = alertSeverity(type);
  const record: AlertRecord = {
    id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    severity,
    subject,
    body,
    sentAt: new Date().toISOString(),
    emailSent: false,
  };

  if (severity === "routine") {
    logger.info({ type, subject }, "Routine alert recorded (weekly recap will summarize)");
  } else {
    const to = process.env.ALERT_EMAIL_TO;
    const from = process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER;
    const html = `<div style="font-family:system-ui,sans-serif;max-width:600px">
          <h2 style="color:#ef4444">${subject}</h2>
          <p style="color:#666;font-size:12px">Alert type: ${type} | ${new Date().toISOString()}</p>
          <div style="background:#f8f8f8;padding:16px;border-radius:8px;margin:16px 0">
            <pre style="white-space:pre-wrap;font-size:14px">${body}</pre>
          </div>
          <p style="color:#999;font-size:11px">Sent by Team Dashboard alerting system</p>
        </div>`;

    if (to && from && (brevoConfigured() || getTransporter())) {
      try {
        // Brevo-first; falls back to Proton SMTP if Brevo is unconfigured or fails.
        const sent = await sendMailBrevoFirst(
          { from, to, subject: `[Team Dashboard] ${subject}`, html },
          getTransporter(),
        );
        if (sent) {
          record.emailSent = true;
          lastSentByType.set(type, Date.now());
          logger.info({ type, subject }, "Alert email sent (Brevo-first)");
        } else {
          record.error = "no transport (Brevo + SMTP both unavailable)";
        }
      } catch (err) {
        record.error = `send error: ${err instanceof Error ? err.message : String(err)}`;
        logger.warn({ err, type }, "Alert email send error");
      }
    } else {
      record.error = "no email transport (set BREVO_API_KEY, or SMTP_HOST/USER/PASS + ALERT_EMAIL_TO)";
      logger.debug({ type, subject }, "Alert recorded (no transport)");
    }
  }

  // Persist for history + the weekly recap (best-effort; never blocks alerting)
  if (alertDb) {
    try {
      await alertDb.insert(alertEvents).values({
        type,
        severity,
        subject,
        body,
        emailSent: record.emailSent,
        emailError: record.error ?? null,
      });
    } catch (err) {
      logger.warn({ err, type }, "Alert DB persist failed");
    }
  }

  // Always store in memory regardless of email success
  recentAlerts.push(record);
  if (recentAlerts.length > MAX_ALERTS) recentAlerts.shift();
  lastSentByType.set(type, Date.now());
}
