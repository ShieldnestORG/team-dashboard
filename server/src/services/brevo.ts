// ---------------------------------------------------------------------------
// Backend (VPS4) Brevo transactional email helper.
//
// Mirrors the landing's lib/brevo.ts: a plain HTTPS POST to Brevo's API using
// BREVO_API_KEY — no SDK (Node 18+ global fetch). Accepts the nodemailer-style
// { from, to, subject, html, bcc, attachments } shape used by the existing
// alerting + email-templates call sites so swapping in is a one-line change.
//
// `sendMailBrevoFirst` prefers Brevo and falls back to the provided nodemailer
// SMTP transport (Proton) if Brevo is unconfigured or its send fails — so this
// is additive resilience, not a hard cutover that can drop mail.
// ---------------------------------------------------------------------------
import { type Transporter } from "nodemailer";
import { logger } from "../middleware/logger.js";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export function brevoConfigured(): boolean {
  return !!process.env.BREVO_API_KEY;
}

type Addr = { email: string; name?: string };

interface MailAttachment {
  filename?: string;
  content?: Buffer | string;
  contentType?: string;
  cid?: string;
}

export interface BackendMailOpts {
  /** "Name <email>" or a bare email address. */
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  bcc?: string | string[];
  attachments?: MailAttachment[];
}

function parseAddr(s: string): Addr {
  const m = s.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) {
    const name = m[1].trim();
    const email = m[2].trim();
    return name ? { name, email } : { email };
  }
  return { email: s.trim() };
}

function toAddrList(v?: string | string[]): Addr[] | undefined {
  if (!v) return undefined;
  const list = (Array.isArray(v) ? v : [v]).filter(Boolean);
  return list.length ? list.map((email) => ({ email })) : undefined;
}

/** Send one email via Brevo's transactional API. Returns true on success. Never throws. */
export async function sendBrevoEmail(opts: BackendMailOpts): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return false;

  const body: Record<string, unknown> = {
    sender: parseAddr(opts.from),
    to: toAddrList(opts.to),
    subject: opts.subject,
    htmlContent: opts.html,
  };
  const bcc = toAddrList(opts.bcc);
  if (bcc) body.bcc = bcc;
  if (opts.attachments?.length) {
    body.attachment = opts.attachments
      .filter((a) => a.content != null)
      .map((a) => ({
        name: a.filename ?? "attachment",
        content: Buffer.isBuffer(a.content)
          ? a.content.toString("base64")
          : Buffer.from(String(a.content)).toString("base64"),
      }));
  }

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      logger.warn({ status: res.status, detail }, "[BREVO] send failed");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, "[BREVO] send threw");
    return false;
  }
}

/**
 * Brevo-first delivery with optional SMTP fallback. Prefers Brevo when
 * BREVO_API_KEY is set; falls back to the provided nodemailer transport if
 * Brevo is unconfigured or its send fails. Returns true if either path sent.
 */
export async function sendMailBrevoFirst(
  opts: BackendMailOpts,
  smtpFallback?: Transporter | null,
): Promise<boolean> {
  if (brevoConfigured()) {
    if (await sendBrevoEmail(opts)) return true;
    logger.warn(
      { to: opts.to, subject: opts.subject },
      "[BREVO] failed — trying SMTP fallback",
    );
  }
  if (smtpFallback) {
    await smtpFallback.sendMail({
      from: opts.from,
      to: opts.to,
      bcc: opts.bcc,
      subject: opts.subject,
      html: opts.html,
      attachments: opts.attachments,
    });
    return true;
  }
  return false;
}
