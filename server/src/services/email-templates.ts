// ---------------------------------------------------------------------------
// Reusable transactional email service
// Built on the same nodemailer transporter pattern as alerting.ts
// Templates: directory-welcome, partner-welcome, intel-welcome,
//            checkout-reminder, renewal-reminder
// ---------------------------------------------------------------------------

import { createTransport, type Transporter } from "nodemailer";
import { logger } from "../middleware/logger.js";

// Lazy transporter — same env vars as alerting.ts
let _transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (_transporter) return _transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  _transporter = createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return _transporter;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmailTemplate =
  | "directory-welcome"
  | "partner-welcome"
  | "intel-welcome"
  | "checkout-reminder"
  | "renewal-reminder"
  | "affiliate-application"
  | "affiliate-approved"
  | "affiliate-reset-password"
  | "affiliate-pending-digest";

export interface EmailVars {
  // Common
  recipientName?: string;
  recipientEmail: string;
  companyName?: string;
  // Directory welcome
  listingTier?: string;
  directoryUrl?: string;
  dashboardUrl?: string;
  // Partner welcome
  partnerDashboardUrl?: string;
  partnerToken?: string;
  // Intel welcome
  apiKey?: string;
  planName?: string;
  docsUrl?: string;
  // Checkout reminder
  checkoutUrl?: string;
  tierName?: string;
  // Renewal
  renewalDate?: string;
  subscriptionName?: string;
  manageUrl?: string;
  // Affiliate
  affiliateName?: string;
  affiliateDashboardUrl?: string;
  adminAffiliatesUrl?: string;
  resetToken?: string;
  supportEmail?: string;
}

// ---------------------------------------------------------------------------
// Shared HTML shell
// ---------------------------------------------------------------------------

function htmlShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="background:#FF6B6B;padding:24px 32px;">
              <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">
                Coherence Daddy
              </span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;color:#333333;font-size:15px;line-height:1.6;">
              ${body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f9f9f9;padding:20px 32px;border-top:1px solid #eeeeee;">
              <p style="margin:0;font-size:12px;color:#999999;">
                Coherence Daddy &mdash; <a href="https://coherencedaddy.com" style="color:#4ECDC4;text-decoration:none;">coherencedaddy.com</a><br />
                If you didn&rsquo;t sign up for this, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function ctaButton(href: string, label: string): string {
  return `<p style="margin:24px 0 0;">
    <a href="${href}" style="display:inline-block;background:#FF6B6B;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;">
      ${label}
    </a>
  </p>`;
}

function secondaryLink(href: string, label: string): string {
  return `<p style="margin:12px 0 0;font-size:13px;">
    <a href="${href}" style="color:#4ECDC4;">${label}</a>
  </p>`;
}

function monoBox(content: string): string {
  return `<div style="margin:16px 0;background:#f4f4f4;border:1px solid #e0e0e0;border-radius:4px;padding:14px 16px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:13px;color:#333333;word-break:break-all;">
    ${content}
  </div>`;
}

// ---------------------------------------------------------------------------
// Template builders
// ---------------------------------------------------------------------------

function buildDirectoryWelcome(vars: EmailVars): { subject: string; html: string } {
  const tier = vars.listingTier ?? "Featured";
  const dirUrl = vars.directoryUrl ?? "https://directory.coherencedaddy.com";
  const dashUrl = vars.dashboardUrl ?? "https://coherencedaddy.com/intel";
  const name = vars.companyName ?? vars.recipientName ?? "there";

  const subject = `Your ${tier} listing is live on the Coherence Daddy Directory!`;

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">Welcome to the Directory, ${name}!</h2>
    <p style="margin:0 0 16px;">Your <strong>${tier}</strong> listing is now live on the Coherence Daddy Directory — real-time AI/ML, Crypto, DeFi, and DevTools intelligence for 530+ projects.</p>

    <p style="margin:0 0 8px;font-weight:600;">What happens next:</p>
    <ul style="margin:0 0 16px;padding-left:20px;">
      <li style="margin-bottom:8px;">Your company card appears with a <strong>${tier}</strong> badge in search results</li>
      <li style="margin-bottom:8px;">Our AI content engine will begin weaving your brand into relevant articles</li>
      <li style="margin-bottom:8px;">Monthly analytics reports will land in your inbox automatically</li>
    </ul>

    ${ctaButton(dirUrl, "View Your Listing →")}
    ${secondaryLink(dashUrl, "Manage your subscription")}

    <hr style="margin:28px 0;border:none;border-top:1px solid #eeeeee;" />
    <p style="margin:0;font-size:13px;color:#777777;">
      Want more? The <a href="https://coherencedaddy.com/partner-network" style="color:#4ECDC4;">Partner Network</a> drives targeted traffic to your site through AI-generated content and tracked redirect links.
    </p>
  `;

  return { subject, html: htmlShell(subject, body) };
}

function buildPartnerWelcome(vars: EmailVars): { subject: string; html: string } {
  const name = vars.companyName ?? vars.recipientName ?? "there";
  const dashUrl = vars.partnerDashboardUrl ?? "https://coherencedaddy.com/partner-dashboard";
  const token = vars.partnerToken;

  const subject = "Welcome to the Coherence Daddy Partner Network!";

  const dashLink = token ? `${dashUrl}?token=${token}` : dashUrl;

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">Welcome, ${name}!</h2>
    <p style="margin:0 0 16px;">You&rsquo;re now part of the Coherence Daddy Partner Network. Our AI content engine will start driving traffic your way through articles, social content, and AEO-optimized posts.</p>

    <p style="margin:0 0 8px;font-weight:600;">Your partner dashboard is ready:</p>
    <ul style="margin:0 0 16px;padding-left:20px;">
      <li style="margin-bottom:8px;">Track real-time click counts and content mentions</li>
      <li style="margin-bottom:8px;">See which content pieces are sending you traffic</li>
      <li style="margin-bottom:8px;">View 30-day trends and source breakdowns</li>
    </ul>

    ${ctaButton(dashLink, "Open Your Dashboard →")}

    ${token ? `<p style="margin:16px 0 0;font-size:13px;color:#777777;">Your dashboard link is unique to you — bookmark it. Your access token: <code style="background:#f4f4f4;padding:2px 6px;border-radius:3px;">${token}</code></p>` : ""}

    <hr style="margin:28px 0;border:none;border-top:1px solid #eeeeee;" />
    <p style="margin:0;font-size:13px;color:#777777;">
      Questions? Reply to this email or reach us at <a href="mailto:hello@coherencedaddy.com" style="color:#4ECDC4;">hello@coherencedaddy.com</a>.
    </p>
  `;

  return { subject, html: htmlShell(subject, body) };
}

function buildIntelWelcome(vars: EmailVars): { subject: string; html: string } {
  const plan = vars.planName ?? "Starter";
  const apiKey = vars.apiKey ?? "";
  const docsUrl = vars.docsUrl ?? "https://coherencedaddy.com/intel/docs";

  const subject = `Your Coherence Daddy Intel API key — ${plan}`;

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">Welcome to the Intel API!</h2>
    <p style="margin:0 0 16px;">You&rsquo;re on the <strong>${plan}</strong> plan. Below is your API key — save it somewhere safe, it will only be shown once.</p>

    <p style="margin:0 0 4px;font-weight:600;font-size:13px;color:#555555;">YOUR API KEY</p>
    ${monoBox(apiKey)}

    <p style="margin:16px 0 8px;font-weight:600;">Quickstart:</p>
    ${monoBox(`curl -H "Authorization: Bearer ${apiKey}" \\<br />&nbsp;&nbsp;https://api.coherencedaddy.com/api/intel/companies`)}

    <p style="margin:16px 0 8px;font-weight:600;">What you have access to:</p>
    <ul style="margin:0 0 16px;padding-left:20px;">
      <li style="margin-bottom:6px;"><code style="font-size:13px;">/api/intel/companies</code> — 530+ tracked projects</li>
      <li style="margin-bottom:6px;"><code style="font-size:13px;">/api/intel/search</code> — full-text + vector search</li>
      <li style="margin-bottom:6px;"><code style="font-size:13px;">/api/intel/prices</code> — hourly price updates</li>
      <li style="margin-bottom:6px;"><code style="font-size:13px;">/api/intel/news</code> — aggregated news + social signals</li>
    </ul>

    ${ctaButton(docsUrl, "Read the Docs →")}
    ${secondaryLink("https://coherencedaddy.com/intel/billing", "Manage your subscription")}

    <hr style="margin:28px 0;border:none;border-top:1px solid #eeeeee;" />
    <p style="margin:0;font-size:13px;color:#777777;">
      If you didn&rsquo;t sign up, reply to this email and we&rsquo;ll revoke the key immediately.
    </p>
  `;

  return { subject, html: htmlShell(subject, body) };
}

function buildCheckoutReminder(vars: EmailVars): { subject: string; html: string } {
  const tier = vars.tierName ?? "your selected plan";
  const checkoutUrl = vars.checkoutUrl ?? "https://coherencedaddy.com";
  const name = vars.recipientName ?? "there";

  const subject = `You left something behind — complete your ${tier} checkout`;

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">Still interested, ${name}?</h2>
    <p style="margin:0 0 16px;">You started a checkout for <strong>${tier}</strong> but didn&rsquo;t complete it. Your spot is still available — pick up where you left off.</p>

    ${ctaButton(checkoutUrl, "Complete Checkout →")}

    <p style="margin:20px 0 0;font-size:13px;color:#777777;">
      If you changed your mind, no action is needed — your checkout session will expire automatically.
    </p>
  `;

  return { subject, html: htmlShell(subject, body) };
}

function buildRenewalReminder(vars: EmailVars): { subject: string; html: string } {
  const subName = vars.subscriptionName ?? "your subscription";
  const renewalDate = vars.renewalDate ?? "soon";
  const manageUrl = vars.manageUrl ?? "https://coherencedaddy.com/intel/billing";
  const name = vars.recipientName ?? "there";

  const subject = `Your ${subName} renews on ${renewalDate}`;

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">Renewal reminder, ${name}</h2>
    <p style="margin:0 0 16px;">Just a heads-up: <strong>${subName}</strong> is set to automatically renew on <strong>${renewalDate}</strong>.</p>
    <p style="margin:0 0 16px;">If you&rsquo;d like to make changes, update your plan, or cancel before then, use the link below.</p>

    ${ctaButton(manageUrl, "Manage Subscription →")}

    <p style="margin:20px 0 0;font-size:13px;color:#777777;">
      No action needed if you&rsquo;d like to continue — your subscription will renew automatically.
    </p>
  `;

  return { subject, html: htmlShell(subject, body) };
}

function buildAffiliateApplication(vars: EmailVars): { subject: string; html: string } {
  const affiliateName = vars.affiliateName ?? "Unknown";
  const email = vars.recipientEmail;
  const adminUrl =
    (vars.adminAffiliatesUrl ?? "https://teamdashboard.coherencedaddy.com") + "/affiliates";

  const subject = `New Affiliate Application — ${affiliateName}`;

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">New Affiliate Application</h2>
    <p style="margin:0 0 16px;">
      <strong>${affiliateName}</strong> (<a href="mailto:${email}" style="color:#4ECDC4;">${email}</a>)
      has applied to become a Coherence Daddy affiliate. Their account is currently <strong>pending</strong> — review and approve or reject below.
    </p>
    ${ctaButton(adminUrl, "Review Application →")}
    <p style="margin:20px 0 0;font-size:13px;color:#777777;">
      Log in to the admin dashboard to change their status to <em>active</em> or <em>suspended</em>.
    </p>
  `;

  return { subject, html: htmlShell(subject, body) };
}

function buildAffiliateApproved(vars: EmailVars): { subject: string; html: string } {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const dashUrl = vars.affiliateDashboardUrl ?? "https://affiliates.coherencedaddy.com/dashboard";

  const subject = "You're approved — Welcome to the Coherence Daddy Affiliate Program";

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">Congratulations, ${name}!</h2>
    <p style="margin:0 0 16px;">
      Your affiliate account is now <strong>active</strong>. You can start adding prospects and earning commissions right away.
    </p>
    <p style="margin:0 0 8px;font-weight:600;">What to do next:</p>
    <ul style="margin:0 0 16px;padding-left:20px;">
      <li style="margin-bottom:8px;">Log in to your dashboard and add your first prospect</li>
      <li style="margin-bottom:8px;">Share your referrals and track your earnings in real time</li>
      <li style="margin-bottom:8px;">Reach out if you have any questions — we&rsquo;re here to help</li>
    </ul>
    ${ctaButton(dashUrl, "Go to Your Dashboard →")}
    <hr style="margin:28px 0;border:none;border-top:1px solid #eeeeee;" />
    <p style="margin:0;font-size:13px;color:#777777;">
      Questions? Reply to this email or reach us at <a href="mailto:hello@coherencedaddy.com" style="color:#4ECDC4;">hello@coherencedaddy.com</a>.
    </p>
  `;

  return { subject, html: htmlShell(subject, body) };
}

function buildAffiliateResetPassword(vars: EmailVars): { subject: string; html: string } {
  const token = vars.resetToken ?? "";
  const resetUrl = `https://affiliates.coherencedaddy.com/reset-password?token=${token}`;

  const subject = "Reset your Coherence Daddy affiliate password";

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">Password reset request</h2>
    <p style="margin:0 0 16px;">
      Someone requested a password reset for your Coherence Daddy affiliate account. If that was you, click the button below. The link is valid for <strong>1 hour</strong>.
    </p>
    ${ctaButton(resetUrl, "Reset My Password →")}
    <p style="margin:20px 0 0;font-size:13px;color:#777777;">
      If you didn&rsquo;t request this, you can safely ignore this email — your password will not change.
    </p>
  `;

  return { subject, html: htmlShell(subject, body) };
}

function buildAffiliatePendingDigest(vars: EmailVars): { subject: string; html: string } {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const support = vars.supportEmail ?? "affiliates@coherencedaddy.com";

  const subject = "Your Coherence Daddy affiliate application — still under review";

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">We haven&rsquo;t forgotten you, ${name}</h2>
    <p style="margin:0 0 16px;">
      Your application to join the Coherence Daddy Affiliate Program is still under review by our team.
      We typically respond within <strong>1–2 business days</strong> — we appreciate your patience.
    </p>
    <p style="margin:0 0 16px;">
      Once approved, you&rsquo;ll receive an email with a link to your dashboard where you can start submitting prospects and tracking your earnings.
    </p>
    <p style="margin:0;font-size:13px;color:#777777;">
      Questions or concerns? Reach us at
      <a href="mailto:${support}" style="color:#4ECDC4;">${support}</a> — we&rsquo;re happy to help.
    </p>
  `;

  return { subject, html: htmlShell(subject, body) };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a transactional email using one of the named templates.
 * Silently skips if SMTP is not configured.
 */
export async function sendTransactional(
  template: EmailTemplate,
  to: string,
  vars: EmailVars,
): Promise<void> {
  const transport = getTransporter();
  if (!transport) {
    logger.warn({ template, to }, "email-templates: SMTP not configured — email skipped");
    return;
  }

  const from = process.env.ALERT_EMAIL_FROM ?? "noreply@coherencedaddy.com";
  const bcc = process.env.ALERT_EMAIL_TO ?? undefined;

  let subject: string;
  let html: string;

  switch (template) {
    case "directory-welcome":
      ({ subject, html } = buildDirectoryWelcome(vars));
      break;
    case "partner-welcome":
      ({ subject, html } = buildPartnerWelcome(vars));
      break;
    case "intel-welcome":
      ({ subject, html } = buildIntelWelcome(vars));
      break;
    case "checkout-reminder":
      ({ subject, html } = buildCheckoutReminder(vars));
      break;
    case "renewal-reminder":
      ({ subject, html } = buildRenewalReminder(vars));
      break;
    case "affiliate-application":
      ({ subject, html } = buildAffiliateApplication(vars));
      break;
    case "affiliate-approved":
      ({ subject, html } = buildAffiliateApproved(vars));
      break;
    case "affiliate-reset-password":
      ({ subject, html } = buildAffiliateResetPassword(vars));
      break;
    case "affiliate-pending-digest":
      ({ subject, html } = buildAffiliatePendingDigest(vars));
      break;
    default: {
      const _exhaustive: never = template;
      logger.error({ template: _exhaustive }, "email-templates: unknown template");
      return;
    }
  }

  try {
    await transport.sendMail({
      from,
      to,
      bcc,
      subject,
      html,
    });
    logger.info({ template, to }, "email-templates: sent");
  } catch (err) {
    logger.error({ err, template, to }, "email-templates: send failed");
  }
}
