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
  | "affiliate-pending-digest"
  | "affiliate-commission-created"
  | "affiliate-commission-approved"
  | "affiliate-payout-sent"
  | "affiliate-payout-held"
  | "affiliate-lock-expired"
  | "affiliate-lead-status-change"
  | "affiliate-tier-upgraded"
  | "affiliate-violation-warning"
  | "affiliate-suspended"
  | "affiliate-giveaway-winner"
  | "affiliate-reengagement"
  | "affiliate-merch-shipped";

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
  // Affiliate commissions / payouts
  leadName?: string;
  amountCents?: number;
  totalCents?: number;
  count?: number;
  type?: string;
  commissionCount?: number;
  method?: string;
  externalId?: string;
  reason?: string;
  // Lead status / lock expiry (Phase 3)
  fromStatus?: string;
  toStatus?: string;
  statusLabel?: string;
  leadUrl?: string;
  // Phase 4 — tiers, compliance, merch, engagement
  fromTier?: string;
  toTier?: string;
  newRate?: string;
  nextTier?: string;
  lifetimeCents?: number;
  ruleCode?: string;
  severity?: string;
  evidenceExcerpt?: string;
  campaignName?: string;
  prize?: string;
  trackingNumber?: string;
  merchItem?: string;
  daysInactive?: number;
  suspensionReason?: string;
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
            <td style="background:#FF876D;padding:24px 32px;">
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
    <a href="${href}" style="display:inline-block;background:#FF876D;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;">
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
      Questions? Reply to this email or reach us at <a href="mailto:info@coherencedaddy.com" style="color:#4ECDC4;">info@coherencedaddy.com</a>.
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
      Questions? Reply to this email or reach us at <a href="mailto:info@coherencedaddy.com" style="color:#4ECDC4;">info@coherencedaddy.com</a>.
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

// ---------------------------------------------------------------------------
// Affiliate commission + payout helpers
// ---------------------------------------------------------------------------

function formatDollars(cents: number | undefined): string {
  return ((cents ?? 0) / 100).toFixed(2);
}

function payoutMethodLabel(method: string | undefined): string {
  switch (method) {
    case "manual_ach":
      return "ACH transfer";
    case "manual_paypal":
      return "PayPal";
    case "manual_check":
      return "Check";
    case "stripe_connect":
      return "Stripe Connect";
    default:
      return method ?? "bank transfer";
  }
}

export function buildAffiliateCommissionCreated(
  vars: EmailVars,
): { subject: string; html: string; text: string } {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const support = vars.supportEmail ?? "info@coherencedaddy.com";
  const dashUrl =
    vars.dashboardUrl ??
    vars.affiliateDashboardUrl ??
    "https://affiliates.coherencedaddy.com/earnings";
  const amount = formatDollars(vars.amountCents);
  const lead = vars.leadName ?? "a new lead";
  const kind = vars.type === "recurring" ? "recurring" : "initial";

  const subject = `New commission pending — $${amount} from ${lead}`;

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">Nice work, ${name}!</h2>
    <p style="margin:0 0 16px;">
      A new <strong>${kind}</strong> commission of <strong>$${amount}</strong> just dropped into your ledger from <strong>${lead}</strong>.
    </p>
    <p style="margin:0 0 16px;">
      Heads up: there&rsquo;s a standard <strong>30-day hold window</strong> — after that the commission moves from <em>pending</em> to <em>approved</em> and rolls into your next monthly payout batch.
    </p>
    ${ctaButton(dashUrl, "View Your Earnings →")}
    <hr style="margin:28px 0;border:none;border-top:1px solid #eeeeee;" />
    <p style="margin:0;font-size:13px;color:#777777;">
      Questions? Reach us at <a href="mailto:${support}" style="color:#4ECDC4;">${support}</a>.
    </p>
  `;

  const text = `Nice work, ${name}!\n\nA new ${kind} commission of $${amount} just dropped into your ledger from ${lead}.\n\nThere is a standard 30-day hold window — after that the commission moves from pending to approved and rolls into your next monthly payout batch.\n\nView your earnings: ${dashUrl}\n\nQuestions? Reach us at ${support}.`;

  return { subject, html: htmlShell(subject, body), text };
}

export function buildAffiliateCommissionApproved(
  vars: EmailVars,
): { subject: string; html: string; text: string } {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const support = vars.supportEmail ?? "info@coherencedaddy.com";
  const dashUrl =
    vars.dashboardUrl ??
    vars.affiliateDashboardUrl ??
    "https://affiliates.coherencedaddy.com/earnings";
  const total = formatDollars(vars.totalCents);
  const count = vars.count ?? 0;
  const plural = count === 1 ? "commission" : "commissions";

  const subject = `$${total} in commissions approved`;

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">Great news, ${name}!</h2>
    <p style="margin:0 0 16px;">
      <strong>${count}</strong> ${plural} totaling <strong>$${total}</strong> just passed the hold window and will be paid in your next monthly batch.
    </p>
    ${ctaButton(dashUrl, "View Your Earnings →")}
    <hr style="margin:28px 0;border:none;border-top:1px solid #eeeeee;" />
    <p style="margin:0;font-size:13px;color:#777777;">
      Questions? Reach us at <a href="mailto:${support}" style="color:#4ECDC4;">${support}</a>.
    </p>
  `;

  const text = `Great news, ${name}!\n\n${count} ${plural} totaling $${total} just passed the hold window and will be paid in your next monthly batch.\n\nView your earnings: ${dashUrl}\n\nQuestions? Reach us at ${support}.`;

  return { subject, html: htmlShell(subject, body), text };
}

export function buildAffiliatePayoutSent(
  vars: EmailVars,
): { subject: string; html: string; text: string } {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const support = vars.supportEmail ?? "info@coherencedaddy.com";
  const dashUrl =
    vars.dashboardUrl ??
    vars.affiliateDashboardUrl ??
    "https://affiliates.coherencedaddy.com/payouts";
  const amount = formatDollars(vars.amountCents);
  const count = vars.commissionCount ?? 0;
  const methodLabel = payoutMethodLabel(vars.method);
  const ref = vars.externalId ?? "(reference pending)";
  const landing =
    vars.method === "manual_check"
      ? "7–10 business days"
      : vars.method === "manual_paypal"
      ? "1–2 business days"
      : vars.method === "stripe_connect"
      ? "1–2 business days"
      : "2–5 business days";

  const subject = `Payout sent — $${amount}`;

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">Your payout is on its way, ${name}</h2>
    <p style="margin:0 0 16px;">
      We just sent <strong>$${amount}</strong> covering <strong>${count}</strong> commission${count === 1 ? "" : "s"} via <strong>${methodLabel}</strong>.
    </p>
    <p style="margin:0 0 4px;font-weight:600;font-size:13px;color:#555555;">REFERENCE</p>
    ${monoBox(ref)}
    <p style="margin:0 0 16px;">
      Expected to land within <strong>${landing}</strong>.
    </p>
    ${ctaButton(dashUrl, "View Payout History →")}
    <hr style="margin:28px 0;border:none;border-top:1px solid #eeeeee;" />
    <p style="margin:0;font-size:13px;color:#777777;">
      Questions? Reach us at <a href="mailto:${support}" style="color:#4ECDC4;">${support}</a>.
    </p>
  `;

  const text = `Your payout is on its way, ${name}.\n\nWe just sent $${amount} covering ${count} commission${count === 1 ? "" : "s"} via ${methodLabel}.\n\nReference: ${ref}\nExpected to land within ${landing}.\n\nView payout history: ${dashUrl}\n\nQuestions? Reach us at ${support}.`;

  return { subject, html: htmlShell(subject, body), text };
}

export function buildAffiliatePayoutHeld(
  vars: EmailVars,
): { subject: string; html: string; text: string } {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const support = vars.supportEmail ?? "info@coherencedaddy.com";
  const dashUrl =
    vars.dashboardUrl ??
    vars.affiliateDashboardUrl ??
    "https://affiliates.coherencedaddy.com/payouts";
  const amount = formatDollars(vars.amountCents);
  const reason = vars.reason ?? "Awaiting admin review.";

  const subject = "Action needed on your payout";

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">Payout on hold, ${name}</h2>
    <p style="margin:0 0 16px;">
      Your pending payout of <strong>$${amount}</strong> has been placed on hold.
    </p>
    <p style="margin:0 0 4px;font-weight:600;font-size:13px;color:#555555;">REASON</p>
    ${monoBox(reason)}
    <p style="margin:16px 0;">
      Please reply directly to this email, or reach us at
      <a href="mailto:${support}" style="color:#4ECDC4;">${support}</a>, and we&rsquo;ll help sort it out.
    </p>
    ${ctaButton(dashUrl, "View Payouts →")}
  `;

  const text = `Payout on hold, ${name}.\n\nYour pending payout of $${amount} has been placed on hold.\n\nReason: ${reason}\n\nPlease reply directly to this email, or reach us at ${support}, and we will help sort it out.\n\nView payouts: ${dashUrl}`;

  return { subject, html: htmlShell(subject, body), text };
}

export function buildAffiliateLockExpired(
  vars: EmailVars,
): { subject: string; html: string; text: string } {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const support = vars.supportEmail ?? "info@coherencedaddy.com";
  const dashUrl =
    vars.dashboardUrl ??
    vars.affiliateDashboardUrl ??
    "https://affiliates.coherencedaddy.com/leads";
  const lead = vars.leadName ?? "a lead";

  const subject = `Lock expired on ${lead}`;

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">Heads up, ${name}</h2>
    <p style="margin:0 0 16px;">
      The 30-day attribution lock on <strong>${lead}</strong> has expired without
      the lead converting past qualification, and the record is now open for
      re-assignment.
    </p>
    <p style="margin:0 0 16px;">
      If you&rsquo;re still actively working this one, reach out to us right away
      so we can review the status together — otherwise no action is needed.
    </p>
    ${ctaButton(dashUrl, "View Your Leads →")}
    <hr style="margin:28px 0;border:none;border-top:1px solid #eeeeee;" />
    <p style="margin:0;font-size:13px;color:#777777;">
      Questions? Reach us at <a href="mailto:${support}" style="color:#4ECDC4;">${support}</a>.
    </p>
  `;

  const text = `Heads up, ${name}.\n\nThe 30-day attribution lock on ${lead} has expired without the lead converting past qualification, and the record is now open for re-assignment.\n\nIf you're still actively working this one, reach out to us right away — otherwise no action is needed.\n\nView your leads: ${dashUrl}\n\nQuestions? Reach us at ${support}.`;

  return { subject, html: htmlShell(subject, body), text };
}

export function buildAffiliateLeadStatusChange(
  vars: EmailVars,
): { subject: string; html: string; text: string } {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const support = vars.supportEmail ?? "info@coherencedaddy.com";
  const dashUrl =
    vars.leadUrl ??
    vars.dashboardUrl ??
    vars.affiliateDashboardUrl ??
    "https://affiliates.coherencedaddy.com/leads";
  const lead = vars.leadName ?? "your lead";
  const statusLabel = vars.statusLabel ?? vars.toStatus ?? "Updated";

  const subject = `${lead}: ${statusLabel}`;

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">Status update, ${name}</h2>
    <p style="margin:0 0 16px;">
      <strong>${lead}</strong> moved to <strong>${statusLabel}</strong>.
    </p>
    ${ctaButton(dashUrl, "View Lead →")}
    <hr style="margin:28px 0;border:none;border-top:1px solid #eeeeee;" />
    <p style="margin:0;font-size:13px;color:#777777;">
      Questions? Reach us at <a href="mailto:${support}" style="color:#4ECDC4;">${support}</a>.
    </p>
  `;

  const text = `Status update, ${name}.\n\n${lead} moved to ${statusLabel}.\n\nView lead: ${dashUrl}\n\nQuestions? Reach us at ${support}.`;

  return { subject, html: htmlShell(subject, body), text };
}

export function buildAffiliateTierUpgraded(
  vars: EmailVars,
): { subject: string; html: string; text: string } {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const support = vars.supportEmail ?? "info@coherencedaddy.com";
  const dashUrl =
    vars.affiliateDashboardUrl ?? vars.dashboardUrl ?? "https://affiliates.coherencedaddy.com/dashboard";
  const toTier = (vars.toTier ?? "Silver").replace(/^./, (c) => c.toUpperCase());
  const fromTier = vars.fromTier ? vars.fromTier.replace(/^./, (c) => c.toUpperCase()) : null;
  const rate = vars.newRate ?? "—";

  const subject = `You&rsquo;re now a ${toTier} affiliate`;

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">Congrats, ${name}! 🎉</h2>
    <p style="margin:0 0 16px;">
      You&rsquo;ve been promoted to <strong>${toTier}</strong>${fromTier ? ` from ${fromTier}` : ""}.
      Your commission rate is now <strong>${rate}</strong> on all future qualifying referrals.
    </p>
    <p style="margin:0 0 16px;">
      This kicks in automatically on your next approved commission — no action needed.
    </p>
    ${ctaButton(dashUrl, "View Your Dashboard →")}
    <hr style="margin:28px 0;border:none;border-top:1px solid #eeeeee;" />
    <p style="margin:0;font-size:13px;color:#777777;">
      Questions? Reach us at <a href="mailto:${support}" style="color:#4ECDC4;">${support}</a>.
    </p>
  `;

  const text = `Congrats, ${name}!\n\nYou've been promoted to ${toTier}${fromTier ? ` from ${fromTier}` : ""}. Your commission rate is now ${rate} on all future qualifying referrals.\n\nThis kicks in automatically on your next approved commission — no action needed.\n\nView your dashboard: ${dashUrl}\n\nQuestions? ${support}`;

  return { subject, html: htmlShell(subject, body), text };
}

export function buildAffiliateViolationWarning(
  vars: EmailVars,
): { subject: string; html: string; text: string } {
  const name = vars.recipientName ?? "Team";
  const affiliate = vars.affiliateName ?? "an affiliate";
  const rule = vars.ruleCode ?? "policy_violation";
  const severity = vars.severity ?? "warning";
  const excerpt = vars.evidenceExcerpt ?? "(no excerpt available)";
  const adminUrl = vars.adminAffiliatesUrl ?? "https://dashboard.coherencedaddy.com/affiliates/compliance";

  const subject = `[${severity.toUpperCase()}] Affiliate violation detected — ${affiliate}`;

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">Compliance alert for ${name}</h2>
    <p style="margin:0 0 16px;">
      A potential violation was detected for <strong>${affiliate}</strong>.
    </p>
    <p style="margin:0 0 8px;"><strong>Rule:</strong> ${rule}</p>
    <p style="margin:0 0 8px;"><strong>Severity:</strong> ${severity}</p>
    ${monoBox(excerpt.replace(/</g, "&lt;").replace(/>/g, "&gt;"))}
    <p style="margin:16px 0 0;">
      Review in the compliance queue to acknowledge, overturn, or enforce.
    </p>
    ${ctaButton(adminUrl, "Open Compliance Queue →")}
  `;

  const text = `Compliance alert.\n\nA potential violation was detected for ${affiliate}.\nRule: ${rule}\nSeverity: ${severity}\nExcerpt: ${excerpt}\n\nReview: ${adminUrl}`;

  return { subject, html: htmlShell(subject, body), text };
}

export function buildAffiliateSuspended(
  vars: EmailVars,
): { subject: string; html: string; text: string } {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const reason = vars.reason ?? vars.suspensionReason ?? "a policy violation";
  const support = vars.supportEmail ?? "info@coherencedaddy.com";

  const subject = "Your affiliate account has been suspended";

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">Important notice, ${name}</h2>
    <p style="margin:0 0 16px;">
      Your Coherence Daddy affiliate account has been <strong>suspended</strong>.
    </p>
    <p style="margin:0 0 8px;"><strong>Reason:</strong> ${reason}</p>
    <p style="margin:16px 0 0;">
      During suspension, you can still view your dashboard but cannot submit new
      leads, request merch, or earn new commissions. Existing pending commissions
      may be reviewed for clawback.
    </p>
    <p style="margin:16px 0 0;">
      If you believe this is in error, reply to this email or reach us at
      <a href="mailto:${support}" style="color:#4ECDC4;">${support}</a>.
    </p>
  `;

  const text = `Important notice, ${name}.\n\nYour Coherence Daddy affiliate account has been suspended.\n\nReason: ${reason}\n\nDuring suspension, you can still view your dashboard but cannot submit new leads, request merch, or earn new commissions. Existing pending commissions may be reviewed for clawback.\n\nIf you believe this is in error, reply or reach us at ${support}.`;

  return { subject, html: htmlShell(subject, body), text };
}

export function buildAffiliateGiveawayWinner(
  vars: EmailVars,
): { subject: string; html: string; text: string } {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const campaign = vars.campaignName ?? "our latest campaign";
  const prize = vars.prize ?? "a giveaway prize";
  const support = vars.supportEmail ?? "info@coherencedaddy.com";
  const dashUrl = vars.affiliateDashboardUrl ?? "https://affiliates.coherencedaddy.com/promo";

  const subject = `🎁 You won the ${campaign} giveaway!`;

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">Congrats, ${name}! 🎉</h2>
    <p style="margin:0 0 16px;">
      You&rsquo;re a winner in the <strong>${campaign}</strong> giveaway.
      Your prize: <strong>${prize}</strong>.
    </p>
    <p style="margin:0 0 16px;">
      Reply to this email within 7 days to claim your prize with your shipping
      details (if applicable).
    </p>
    ${ctaButton(dashUrl, "View Promotions →")}
    <hr style="margin:28px 0;border:none;border-top:1px solid #eeeeee;" />
    <p style="margin:0;font-size:13px;color:#777777;">
      Questions? <a href="mailto:${support}" style="color:#4ECDC4;">${support}</a>.
    </p>
  `;

  const text = `Congrats, ${name}!\n\nYou're a winner in the ${campaign} giveaway. Prize: ${prize}.\n\nReply within 7 days to claim with shipping details.\n\nView: ${dashUrl}\n\nQuestions? ${support}`;

  return { subject, html: htmlShell(subject, body), text };
}

export function buildAffiliateReengagement(
  vars: EmailVars,
): { subject: string; html: string; text: string } {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const support = vars.supportEmail ?? "info@coherencedaddy.com";
  const dashUrl = vars.affiliateDashboardUrl ?? "https://affiliates.coherencedaddy.com/dashboard";
  const days = vars.daysInactive ?? 45;

  const subject = "We&rsquo;ve missed you — easy lead wins waiting";

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">Still here, ${name}?</h2>
    <p style="margin:0 0 16px;">
      It&rsquo;s been about <strong>${days} days</strong> since you last submitted
      a lead. Your account is still in good standing and your commission rate
      is intact — we just wanted to nudge you in case life got busy.
    </p>
    <p style="margin:0 0 16px;">
      Got a warm intro you&rsquo;ve been sitting on? A single well-qualified
      lead can push you toward the next tier.
    </p>
    ${ctaButton(dashUrl, "Submit a Lead →")}
    <hr style="margin:28px 0;border:none;border-top:1px solid #eeeeee;" />
    <p style="margin:0;font-size:13px;color:#777777;">
      Questions or need support? <a href="mailto:${support}" style="color:#4ECDC4;">${support}</a>.
    </p>
  `;

  const text = `Still here, ${name}?\n\nIt's been about ${days} days since your last lead submission. Your account is still in good standing and your commission rate is intact.\n\nGot a warm intro? A single qualified lead can push you toward the next tier.\n\nSubmit a lead: ${dashUrl}\n\nQuestions? ${support}`;

  return { subject, html: htmlShell(subject, body), text };
}

export function buildAffiliateMerchShipped(
  vars: EmailVars,
): { subject: string; html: string; text: string } {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const item = vars.merchItem ?? "Your merch";
  const tracking = vars.trackingNumber ?? null;
  const support = vars.supportEmail ?? "info@coherencedaddy.com";

  const subject = `${item} is on the way! 📦`;

  const body = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;">Shipped, ${name}!</h2>
    <p style="margin:0 0 16px;">
      <strong>${item}</strong> just left the warehouse and is headed to you.
    </p>
    ${tracking ? `<p style="margin:0 0 8px;"><strong>Tracking number:</strong></p>${monoBox(tracking)}` : ""}
    <p style="margin:16px 0 0;">
      Tag <strong>@coherencedaddy</strong> when you post it — we love seeing
      our community rep the brand.
    </p>
    <hr style="margin:28px 0;border:none;border-top:1px solid #eeeeee;" />
    <p style="margin:0;font-size:13px;color:#777777;">
      Questions? <a href="mailto:${support}" style="color:#4ECDC4;">${support}</a>.
    </p>
  `;

  const text = `Shipped, ${name}!\n\n${item} just left the warehouse and is headed to you.${tracking ? `\n\nTracking: ${tracking}` : ""}\n\nTag @coherencedaddy when you post it.\n\nQuestions? ${support}`;

  return { subject, html: htmlShell(subject, body), text };
}

function buildAffiliatePendingDigest(vars: EmailVars): { subject: string; html: string } {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const support = vars.supportEmail ?? "info@coherencedaddy.com";

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
// Shop sharer welcome — hype email with embedded QR (CID attachment)
// ---------------------------------------------------------------------------

interface SharerWelcomeInput {
  to: string;
  shareUrl: string;
  referralCode: string;
  shareLandingUrl: string; // e.g. https://coherencedaddy.com/shop/share?code=abc123
  qrPng: Buffer; // 600×600 PNG
}

function buildSharerWelcome(input: Omit<SharerWelcomeInput, "to" | "qrPng">): {
  subject: string;
  html: string;
} {
  const { shareUrl, referralCode, shareLandingUrl } = input;
  const subject = "You're in. Your share link is live.";
  const body = `
    <h2 style="margin:0 0 8px;font-size:24px;color:#222222;line-height:1.2;">You&rsquo;re in. Now go make some noise.</h2>
    <p style="margin:0 0 20px;font-size:15px;">
      Every click on your link is tracked to you. Prize drops, discounts,
      commissions — details TBA, but the leaderboard starts the second you
      hit send.
    </p>

    <p style="margin:0 0 6px;font-weight:600;color:#222222;">Your share link</p>
    ${monoBox(`<a href="${shareUrl}" style="color:#333333;text-decoration:none;">${shareUrl}</a>`)}

    <p style="margin:20px 0 6px;font-weight:600;color:#222222;">Your code</p>
    ${monoBox(referralCode)}

    <p style="margin:28px 0 10px;font-weight:600;color:#222222;">Your QR (600×600 — screenshot, print, sticker, tattoo, whatever)</p>
    <div style="text-align:center;margin:8px 0 0;">
      <img src="cid:sharer-qr" alt="QR code for ${shareUrl}" width="300" height="300" style="display:inline-block;border:1px solid #e0e0e0;border-radius:8px;padding:8px;background:#ffffff;" />
    </div>

    ${ctaButton(shareLandingUrl, "Open your share page →")}

    <hr style="margin:28px 0;border:none;border-top:1px solid #eeeeee;" />
    <p style="margin:0 0 8px;font-weight:600;color:#222222;">What&rsquo;s next</p>
    <ul style="margin:0 0 16px;padding-left:20px;color:#444444;">
      <li style="margin-bottom:6px;">Drop the link in your stories, group chats, pinned posts.</li>
      <li style="margin-bottom:6px;">Top sharers land in prize drops. Details TBA.</li>
      <li style="margin-bottom:6px;">Want commissions? Apply for the affiliate program from your share page — we review manually.</li>
    </ul>

    <p style="margin:20px 0 0;font-size:13px;color:#777777;">
      No newsletters. We only email you for affiliate updates and prize drops.
    </p>
  `;
  return { subject, html: htmlShell(subject, body) };
}

export async function sendSharerWelcomeEmail(input: SharerWelcomeInput): Promise<void> {
  const transport = getTransporter();
  if (!transport) {
    logger.warn({ to: input.to }, "sharer-welcome: SMTP not configured — skipped");
    return;
  }
  const from = process.env.ALERT_EMAIL_FROM ?? "noreply@coherencedaddy.com";
  const { subject, html } = buildSharerWelcome({
    shareUrl: input.shareUrl,
    referralCode: input.referralCode,
    shareLandingUrl: input.shareLandingUrl,
  });
  try {
    await transport.sendMail({
      from,
      to: input.to,
      subject,
      html,
      attachments: [
        {
          filename: `coherence-daddy-${input.referralCode}.png`,
          content: input.qrPng,
          contentType: "image/png",
          cid: "sharer-qr",
        },
      ],
    });
    logger.info({ to: input.to, code: input.referralCode }, "sharer-welcome: sent");
  } catch (err) {
    logger.error({ err, to: input.to }, "sharer-welcome: send failed");
  }
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
    case "affiliate-commission-created":
      ({ subject, html } = buildAffiliateCommissionCreated(vars));
      break;
    case "affiliate-commission-approved":
      ({ subject, html } = buildAffiliateCommissionApproved(vars));
      break;
    case "affiliate-payout-sent":
      ({ subject, html } = buildAffiliatePayoutSent(vars));
      break;
    case "affiliate-payout-held":
      ({ subject, html } = buildAffiliatePayoutHeld(vars));
      break;
    case "affiliate-lock-expired":
      ({ subject, html } = buildAffiliateLockExpired(vars));
      break;
    case "affiliate-lead-status-change":
      ({ subject, html } = buildAffiliateLeadStatusChange(vars));
      break;
    case "affiliate-tier-upgraded":
      ({ subject, html } = buildAffiliateTierUpgraded(vars));
      break;
    case "affiliate-violation-warning":
      ({ subject, html } = buildAffiliateViolationWarning(vars));
      break;
    case "affiliate-suspended":
      ({ subject, html } = buildAffiliateSuspended(vars));
      break;
    case "affiliate-giveaway-winner":
      ({ subject, html } = buildAffiliateGiveawayWinner(vars));
      break;
    case "affiliate-reengagement":
      ({ subject, html } = buildAffiliateReengagement(vars));
      break;
    case "affiliate-merch-shipped":
      ({ subject, html } = buildAffiliateMerchShipped(vars));
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
