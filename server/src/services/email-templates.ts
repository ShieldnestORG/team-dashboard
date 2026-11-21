// ---------------------------------------------------------------------------
// Reusable transactional email service
// Built on the same nodemailer transporter pattern as alerting.ts
// Templates: directory-welcome, partner-welcome, intel-welcome,
//            checkout-reminder, renewal-reminder, and the affiliate set.
//
// Look: every template is rendered through ./email-theme.ts (the house email
// look ported from coherencedaddy-landing emails/theme.ts). A builder picks its
// frame: "transactional" (account/activity mail), "commercial" (nudges and
// promos; adds the unsubscribe link) or owner-only (light frame for mail that
// goes to the business inbox). Every send carries a plain-text part.
// ---------------------------------------------------------------------------

import { createTransport, type Transporter } from "nodemailer";
import { logger } from "../middleware/logger.js";
import { sendMailBrevoFirst, brevoConfigured } from "./brevo.js";
import {
  CARD,
  HAIRLINE,
  bulletList,
  code,
  ctaButton,
  dataTable,
  escapeHtml,
  h,
  heading,
  lead,
  label,
  link,
  monoBox,
  note,
  nowrap,
  para,
  raw,
  renderCustomerEmail,
  renderOwnerEmail,
  rule,
  secondaryLink,
  type CustomerKind,
  type SafeHtml,
} from "./email-theme.js";

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
// Frames: every builder returns { subject, html, text }
// ---------------------------------------------------------------------------

interface Built {
  subject: string;
  html: string;
  text: string;
}

/** Customer-facing mail in the full house letterhead. */
function customer(subject: string, body: SafeHtml, kind: CustomerKind = "transactional"): Built {
  const { html, text } = renderCustomerEmail({ title: subject, body, kind });
  return { subject, html, text };
}

/** Owner-only mail in the light branded frame (no postal address, no unsubscribe). */
function ownerOnly(subject: string, title: string, tag: string, body: SafeHtml): Built {
  const { html, text } = renderOwnerEmail({ title, label: tag, body });
  return { subject, html, text };
}

/** The closing "Questions?" block most affiliate mails end with. */
function questions(sentence: SafeHtml): SafeHtml {
  return h`${rule()}${note(sentence)}`;
}

function mailto(addr: string): SafeHtml {
  return link(`mailto:${addr}`, addr);
}

/**
 * Send a password-reset link (better-auth `sendResetPassword` callback).
 * Silently skips if SMTP is not configured — better-auth still returns success
 * to the caller regardless, which avoids leaking whether an email is registered.
 */
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const transport = getTransporter();
  if (!transport) {
    logger.warn({ to }, "email-templates: SMTP not configured — password reset email skipped");
    return;
  }
  const from = process.env.ALERT_EMAIL_FROM ?? "noreply@coherencedaddy.com";
  const subject = "Reset your team dashboard password";
  const body = h`
    ${heading("Reset your password")}
    ${para("We received a request to reset your team dashboard password.")}
    ${ctaButton(String(resetUrl), "Choose a new password")}
    ${note("This link expires shortly. If you didn't request a reset, you can safely ignore this email.")}
  `;
  const { html, text } = customer(subject, body);
  await transport.sendMail({ from, to, subject, html, text });
}

// ---------------------------------------------------------------------------
// Template builders
// ---------------------------------------------------------------------------

function buildDirectoryWelcome(vars: EmailVars): Built {
  const tier = vars.listingTier ?? "Featured";
  const dirUrl = vars.directoryUrl ?? "https://directory.coherencedaddy.com";
  const dashUrl = vars.dashboardUrl ?? "https://coherencedaddy.com/intel";
  const name = vars.companyName ?? vars.recipientName ?? "there";

  const subject = `Your ${tier} listing is live on the Coherence Daddy Directory!`;

  const body = h`
    ${heading(`Welcome to the Directory, ${name}!`)}
    ${para(h`Your <strong>${tier}</strong> listing is now live on the Coherence Daddy Directory — real-time AI/ML, Crypto, DeFi, and DevTools intelligence for 530+ projects.`)}

    ${lead("What happens next:")}
    ${bulletList([
      h`Your company card appears with a <strong>${tier}</strong> badge in search results`,
      "Our AI content engine will begin weaving your brand into relevant articles",
      "Monthly analytics reports will land in your inbox automatically",
    ])}

    ${ctaButton(dirUrl, "View Your Listing →")}
    ${secondaryLink(dashUrl, "Manage your subscription")}

    ${rule()}
    ${note(h`Want more? The ${link("https://coherencedaddy.com/partner-network", "Partner Network")} drives targeted traffic to your site through AI-generated content and tracked redirect links.`)}
  `;

  return customer(subject, body);
}

function buildPartnerWelcome(vars: EmailVars): Built {
  const name = vars.companyName ?? vars.recipientName ?? "there";
  const dashUrl = vars.partnerDashboardUrl ?? "https://coherencedaddy.com/partner-dashboard";
  const token = vars.partnerToken;

  const subject = "Welcome to the Coherence Daddy Partner Network!";

  const dashLink = token ? `${dashUrl}?token=${token}` : dashUrl;

  const body = h`
    ${heading(`Welcome, ${name}!`)}
    ${para("You’re now part of the Coherence Daddy Partner Network. Our AI content engine will start driving traffic your way through articles, social content, and AEO-optimized posts.")}

    ${lead("Your partner dashboard is ready:")}
    ${bulletList([
      "Track real-time click counts and content mentions",
      "See which content pieces are sending you traffic",
      "View 30-day trends and source breakdowns",
    ])}

    ${ctaButton(dashLink, "Open Your Dashboard →")}

    ${token && h`${note("Your dashboard link is unique to you — bookmark it. Your access token:")}${monoBox(token)}`}

    ${rule()}
    ${note(h`Questions? Reply to this email or reach us at ${mailto("info@coherencedaddy.com")}.`)}
  `;

  return customer(subject, body);
}

function buildIntelWelcome(vars: EmailVars): Built {
  const plan = vars.planName ?? "Starter";
  const apiKey = vars.apiKey ?? "";
  const docsUrl = vars.docsUrl ?? "https://coherencedaddy.com/intel/docs";

  const subject = `Your Coherence Daddy Intel API key — ${plan}`;

  const body = h`
    ${heading("Welcome to the Intel API!")}
    ${para(h`You’re on the <strong>${plan}</strong> plan. Below is your API key — save it somewhere safe, it will only be shown once.`)}

    ${label("Your API key")}
    ${monoBox(apiKey)}

    ${lead("Quickstart:")}
    ${monoBox(h`curl https://api.coherencedaddy.com/api/intel/companies \\<br />&nbsp;&nbsp;-H "Authorization: Bearer ${apiKey}"`)}

    ${lead("What you have access to:")}
    ${bulletList([
      h`${code("/api/intel/companies")} — 530+ tracked projects`,
      h`${code("/api/intel/search")} — full-text + vector search`,
      h`${code("/api/intel/prices")} — hourly price updates`,
      h`${code("/api/intel/news")} — aggregated news + social signals`,
    ])}

    ${ctaButton(docsUrl, "Read the Docs →")}
    ${secondaryLink("https://coherencedaddy.com/intel/billing", "Manage your subscription")}

    ${rule()}
    ${note("If you didn’t sign up, reply to this email and we’ll revoke the key immediately.")}
  `;

  return customer(subject, body);
}

function buildCheckoutReminder(vars: EmailVars): Built {
  const tier = vars.tierName ?? "your selected plan";
  const checkoutUrl = vars.checkoutUrl ?? "https://coherencedaddy.com";
  const name = vars.recipientName ?? "there";

  const subject = `You left something behind — complete your ${tier} checkout`;

  const body = h`
    ${heading(`Still interested, ${name}?`)}
    ${para(h`You started a checkout for <strong>${tier}</strong> but didn’t complete it. Your spot is still available — pick up where you left off.`)}

    ${ctaButton(checkoutUrl, "Complete Checkout →")}

    ${note("If you changed your mind, no action is needed — your checkout session will expire automatically.")}
  `;

  return customer(subject, body, "commercial");
}

function buildRenewalReminder(vars: EmailVars): Built {
  const subName = vars.subscriptionName ?? "your subscription";
  const renewalDate = vars.renewalDate ?? "soon";
  const manageUrl = vars.manageUrl ?? "https://coherencedaddy.com/intel/billing";
  const name = vars.recipientName ?? "there";

  const subject = `Your ${subName} renews on ${renewalDate}`;

  const body = h`
    ${heading(`Renewal reminder, ${name}`)}
    ${para(h`Just a heads-up: <strong>${subName}</strong> is set to automatically renew on <strong>${renewalDate}</strong>.`)}
    ${para("If you’d like to make changes, update your plan, or cancel before then, use the link below.")}

    ${ctaButton(manageUrl, "Manage Subscription →")}

    ${note("No action needed if you’d like to continue — your subscription will renew automatically.")}
  `;

  return customer(subject, body);
}

function buildAffiliateApplication(vars: EmailVars): Built {
  const affiliateName = vars.affiliateName ?? "Unknown";
  const email = vars.recipientEmail;
  const adminUrl =
    (vars.adminAffiliatesUrl ?? "https://teamdashboard.coherencedaddy.com") + "/affiliates";

  const subject = `New Affiliate Application — ${affiliateName}`;

  const body = h`
    ${para(h`<strong>${affiliateName}</strong> (${mailto(email)}) has applied to become a Coherence Daddy affiliate. Their account is currently <strong>pending</strong> — review and approve or reject below.`)}
    ${ctaButton(adminUrl, "Review Application →")}
    ${note(h`Log in to the admin dashboard to change their status to <em>active</em> or <em>suspended</em>.`)}
  `;

  return ownerOnly(subject, "New Affiliate Application", "Affiliates", body);
}

function buildAffiliateApproved(vars: EmailVars): Built {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const dashUrl = vars.affiliateDashboardUrl ?? "https://affiliates.coherencedaddy.com/dashboard";

  const subject = "You're approved — Welcome to the Coherence Daddy Affiliate Program";

  const body = h`
    ${heading(`Congratulations, ${name}!`)}
    ${para(h`Your affiliate account is now <strong>active</strong>. You can start adding prospects and earning commissions right away.`)}
    ${lead("What to do next:")}
    ${bulletList([
      "Log in to your dashboard and add your first prospect",
      "Share your referrals and track your earnings in real time",
      "Reach out if you have any questions — we’re here to help",
    ])}
    ${ctaButton(dashUrl, "Go to Your Dashboard →")}
    ${questions(h`Questions? Reply to this email or reach us at ${mailto("info@coherencedaddy.com")}.`)}
  `;

  return customer(subject, body);
}

function buildAffiliateResetPassword(vars: EmailVars): Built {
  const token = vars.resetToken ?? "";
  const resetUrl = `https://affiliates.coherencedaddy.com/reset-password?token=${token}`;

  const subject = "Reset your Coherence Daddy affiliate password";

  const body = h`
    ${heading("Password reset request")}
    ${para(h`Someone requested a password reset for your Coherence Daddy affiliate account. If that was you, click the button below. The link is valid for <strong>1 hour</strong>.`)}
    ${ctaButton(resetUrl, "Reset My Password →")}
    ${note("If you didn’t request this, you can safely ignore this email — your password will not change.")}
  `;

  return customer(subject, body);
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

export function buildAffiliateCommissionCreated(vars: EmailVars): Built {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const support = vars.supportEmail ?? "info@coherencedaddy.com";
  const dashUrl =
    vars.dashboardUrl ??
    vars.affiliateDashboardUrl ??
    "https://affiliates.coherencedaddy.com/earnings";
  const amount = formatDollars(vars.amountCents);
  const lead_ = vars.leadName ?? "a new lead";
  const kind = vars.type === "recurring" ? "recurring" : "initial";

  const subject = `New commission pending — $${amount} from ${lead_}`;

  const body = h`
    ${heading(`Nice work, ${name}!`)}
    ${para(h`A new <strong>${kind}</strong> commission of <strong>$${amount}</strong> just dropped into your ledger from <strong>${lead_}</strong>.`)}
    ${para(h`Heads up: there’s a standard <strong>30-day hold window</strong> — after that the commission moves from <em>pending</em> to <em>approved</em> and rolls into your next monthly payout batch.`)}
    ${ctaButton(dashUrl, "View Your Earnings →")}
    ${questions(h`Questions? Reach us at ${mailto(support)}.`)}
  `;

  return customer(subject, body);
}

export function buildAffiliateCommissionApproved(vars: EmailVars): Built {
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

  const body = h`
    ${heading(`Great news, ${name}!`)}
    ${para(h`<strong>${count}</strong> ${plural} totaling <strong>$${total}</strong> just passed the hold window and will be paid in your next monthly batch.`)}
    ${ctaButton(dashUrl, "View Your Earnings →")}
    ${questions(h`Questions? Reach us at ${mailto(support)}.`)}
  `;

  return customer(subject, body);
}

export function buildAffiliatePayoutSent(vars: EmailVars): Built {
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

  const body = h`
    ${heading(`Your payout is on its way, ${name}`)}
    ${para(h`We just sent <strong>$${amount}</strong> covering <strong>${count}</strong> commission${count === 1 ? "" : "s"} via <strong>${methodLabel}</strong>.`)}
    ${label("Reference")}
    ${monoBox(ref)}
    ${para(h`Expected to land within <strong>${nowrap(landing)}</strong>.`)}
    ${ctaButton(dashUrl, "View Payout History →")}
    ${questions(h`Questions? Reach us at ${mailto(support)}.`)}
  `;

  return customer(subject, body);
}

export function buildAffiliatePayoutHeld(vars: EmailVars): Built {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const support = vars.supportEmail ?? "info@coherencedaddy.com";
  const dashUrl =
    vars.dashboardUrl ??
    vars.affiliateDashboardUrl ??
    "https://affiliates.coherencedaddy.com/payouts";
  const amount = formatDollars(vars.amountCents);
  const reason = vars.reason ?? "Awaiting admin review.";

  const subject = "Action needed on your payout";

  const body = h`
    ${heading(`Payout on hold, ${name}`)}
    ${para(h`Your pending payout of <strong>$${amount}</strong> has been placed on hold.`)}
    ${label("Reason")}
    ${monoBox(reason)}
    ${para(h`Please reply directly to this email, or reach us at ${mailto(support)}, and we’ll help sort it out.`)}
    ${ctaButton(dashUrl, "View Payouts →")}
  `;

  return customer(subject, body);
}

export function buildAffiliateLockExpired(vars: EmailVars): Built {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const support = vars.supportEmail ?? "info@coherencedaddy.com";
  const dashUrl =
    vars.dashboardUrl ??
    vars.affiliateDashboardUrl ??
    "https://affiliates.coherencedaddy.com/leads";
  const lead_ = vars.leadName ?? "a lead";

  const subject = `Lock expired on ${lead_}`;

  const body = h`
    ${heading(`Heads up, ${name}`)}
    ${para(h`The 30-day attribution lock on <strong>${lead_}</strong> has expired without the lead converting past qualification, and the record is now open for re-assignment.`)}
    ${para("If you’re still actively working this one, reach out to us right away so we can review the status together — otherwise no action is needed.")}
    ${ctaButton(dashUrl, "View Your Leads →")}
    ${questions(h`Questions? Reach us at ${mailto(support)}.`)}
  `;

  return customer(subject, body);
}

export function buildAffiliateLeadStatusChange(vars: EmailVars): Built {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const support = vars.supportEmail ?? "info@coherencedaddy.com";
  const dashUrl =
    vars.leadUrl ??
    vars.dashboardUrl ??
    vars.affiliateDashboardUrl ??
    "https://affiliates.coherencedaddy.com/leads";
  const lead_ = vars.leadName ?? "your lead";
  const statusLabel = vars.statusLabel ?? vars.toStatus ?? "Updated";

  const subject = `${lead_}: ${statusLabel}`;

  const body = h`
    ${heading(`Status update, ${name}`)}
    ${para(h`<strong>${lead_}</strong> moved to <strong>${statusLabel}</strong>.`)}
    ${ctaButton(dashUrl, "View Lead →")}
    ${questions(h`Questions? Reach us at ${mailto(support)}.`)}
  `;

  return customer(subject, body);
}

export function buildAffiliateTierUpgraded(vars: EmailVars): Built {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const support = vars.supportEmail ?? "info@coherencedaddy.com";
  const dashUrl =
    vars.affiliateDashboardUrl ?? vars.dashboardUrl ?? "https://affiliates.coherencedaddy.com/dashboard";
  const toTier = (vars.toTier ?? "Silver").replace(/^./, (c) => c.toUpperCase());
  const fromTier = vars.fromTier ? vars.fromTier.replace(/^./, (c) => c.toUpperCase()) : null;
  const rate = vars.newRate ?? "—";

  const subject = `You're now a ${toTier} affiliate`;

  const body = h`
    ${heading(`Congrats, ${name}! 🎉`)}
    ${para(h`You’ve been promoted to <strong>${toTier}</strong>${fromTier ? ` from ${fromTier}` : ""}. Your commission rate is now <strong>${rate}</strong> on all future qualifying referrals.`)}
    ${para("This kicks in automatically on your next approved commission — no action needed.")}
    ${ctaButton(dashUrl, "View Your Dashboard →")}
    ${questions(h`Questions? Reach us at ${mailto(support)}.`)}
  `;

  return customer(subject, body);
}

export function buildAffiliateViolationWarning(vars: EmailVars): Built {
  const name = vars.recipientName ?? "Team";
  const affiliate = vars.affiliateName ?? "an affiliate";
  const rule_ = vars.ruleCode ?? "policy_violation";
  const severity = vars.severity ?? "warning";
  const excerpt = vars.evidenceExcerpt ?? "(no excerpt available)";
  const adminUrl = vars.adminAffiliatesUrl ?? "https://dashboard.coherencedaddy.com/affiliates/compliance";

  const subject = `[${severity.toUpperCase()}] Affiliate violation detected — ${affiliate}`;

  const body = h`
    ${para(h`A potential violation was detected for <strong>${affiliate}</strong>.`)}
    ${dataTable([
      ["Rule", rule_],
      ["Severity", severity],
    ])}
    ${label("Excerpt")}
    ${monoBox(excerpt)}
    ${para("Review in the compliance queue to acknowledge, overturn, or enforce.")}
    ${ctaButton(adminUrl, "Open Compliance Queue →")}
  `;

  return ownerOnly(subject, `Compliance alert for ${name}`, "Compliance", body);
}

export function buildAffiliateSuspended(vars: EmailVars): Built {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const reason = vars.reason ?? vars.suspensionReason ?? "a policy violation";
  const support = vars.supportEmail ?? "info@coherencedaddy.com";

  const subject = "Your affiliate account has been suspended";

  const body = h`
    ${heading(`Important notice, ${name}`)}
    ${para(h`Your Coherence Daddy affiliate account has been <strong>suspended</strong>.`)}
    ${para(h`<strong>Reason:</strong> ${reason}`)}
    ${para("During suspension, you can still view your dashboard but cannot submit new leads, request merch, or earn new commissions. Existing pending commissions may be reviewed for clawback.")}
    ${para(h`If you believe this is in error, reply to this email or reach us at ${mailto(support)}.`)}
  `;

  return customer(subject, body);
}

export function buildAffiliateGiveawayWinner(vars: EmailVars): Built {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const campaign = vars.campaignName ?? "our latest campaign";
  const prize = vars.prize ?? "a giveaway prize";
  const support = vars.supportEmail ?? "info@coherencedaddy.com";
  const dashUrl = vars.affiliateDashboardUrl ?? "https://affiliates.coherencedaddy.com/promo";

  const subject = `🎁 You won the ${campaign} giveaway!`;

  const body = h`
    ${heading(`Congrats, ${name}! 🎉`)}
    ${para(h`You’re a winner in the <strong>${campaign}</strong> giveaway. Your prize: <strong>${prize}</strong>.`)}
    ${para("Reply to this email within 7 days to claim your prize with your shipping details (if applicable).")}
    ${ctaButton(dashUrl, "View Promotions →")}
    ${questions(h`Questions? ${mailto(support)}.`)}
  `;

  return customer(subject, body, "commercial");
}

export function buildAffiliateReengagement(vars: EmailVars): Built {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const support = vars.supportEmail ?? "info@coherencedaddy.com";
  const dashUrl = vars.affiliateDashboardUrl ?? "https://affiliates.coherencedaddy.com/dashboard";
  const days = vars.daysInactive ?? 45;

  const subject = "We've missed you — easy lead wins waiting";

  const body = h`
    ${heading(`Still here, ${name}?`)}
    ${para(h`It’s been about <strong>${days} days</strong> since you last submitted a lead. Your account is still in good standing and your commission rate is intact — we just wanted to nudge you in case life got busy.`)}
    ${para("Got a warm intro you’ve been sitting on? A single well-qualified lead can push you toward the next tier.")}
    ${ctaButton(dashUrl, "Submit a Lead →")}
    ${questions(h`Questions or need support? ${mailto(support)}.`)}
  `;

  return customer(subject, body, "commercial");
}

export function buildAffiliateMerchShipped(vars: EmailVars): Built {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const item = vars.merchItem ?? "Your merch";
  const tracking = vars.trackingNumber ?? null;
  const support = vars.supportEmail ?? "info@coherencedaddy.com";

  const subject = `${item} is on the way! 📦`;

  const body = h`
    ${heading(`Shipped, ${name}!`)}
    ${para(h`<strong>${item}</strong> just left the warehouse and is headed to you.`)}
    ${tracking && h`${lead("Tracking number:")}${monoBox(tracking)}`}
    ${para(h`Tag <strong>@coherencedaddy</strong> when you post it — we love seeing our community rep the brand.`)}
    ${questions(h`Questions? ${mailto(support)}.`)}
  `;

  return customer(subject, body);
}

function buildAffiliatePendingDigest(vars: EmailVars): Built {
  const name = vars.affiliateName ?? vars.recipientName ?? "there";
  const support = vars.supportEmail ?? "info@coherencedaddy.com";

  const subject = "Your Coherence Daddy affiliate application — still under review";

  const body = h`
    ${heading(`We haven’t forgotten you, ${name}`)}
    ${para(h`Your application to join the Coherence Daddy Affiliate Program is still under review by our team. We typically respond within <strong>${nowrap("1–2 business days")}</strong> — we appreciate your patience.`)}
    ${para("Once approved, you’ll receive an email with a link to your dashboard where you can start submitting prospects and tracking your earnings.")}
    ${note(h`Questions or concerns? Reach us at ${mailto(support)} — we’re happy to help.`)}
  `;

  return customer(subject, body);
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

function buildSharerWelcome(input: Omit<SharerWelcomeInput, "to" | "qrPng">): Built {
  const { shareUrl, referralCode, shareLandingUrl } = input;
  const subject = "You're in. Your share link is live.";
  // The QR is a CID attachment on a white chip: a QR needs a light ground to scan.
  const qr = raw(
    `<div style="text-align:center;margin:8px 0 0;"><img src="cid:sharer-qr" alt="${escapeHtml(`QR code for ${shareUrl}`)}" width="300" height="300" style="display:inline-block;box-sizing:border-box;width:100%;max-width:300px;height:auto;border:1px solid ${HAIRLINE};border-radius:10px;padding:8px;background:${CARD};" /></div>`,
  );
  const body = h`
    ${heading("You’re in. Now go make some noise.")}
    ${para("Every click on your link is tracked to you. Prize drops, discounts, commissions — details TBA, but the leaderboard starts the second you hit send.")}

    ${lead("Your share link")}
    ${monoBox(link(shareUrl, raw(escapeHtml(shareUrl).replace(/\//g, "/<wbr>"))))}

    ${lead("Your code")}
    ${monoBox(referralCode)}

    ${lead("Your QR (600×600 — screenshot, print, sticker, tattoo, whatever)")}
    ${qr}

    ${ctaButton(shareLandingUrl, "Open your share page →")}

    ${rule()}
    ${lead("What’s next")}
    ${bulletList([
      "Drop the link in your stories, group chats, pinned posts.",
      "Top sharers land in prize drops. Details TBA.",
      "Want commissions? Apply for the affiliate program from your share page — we review manually.",
    ])}

    ${note("No newsletters. We only email you for affiliate updates and prize drops.")}
  `;
  return customer(subject, body, "commercial");
}

export async function sendSharerWelcomeEmail(input: SharerWelcomeInput): Promise<void> {
  const transport = getTransporter();
  if (!transport) {
    logger.warn({ to: input.to }, "sharer-welcome: SMTP not configured — skipped");
    return;
  }
  const from = process.env.ALERT_EMAIL_FROM ?? "noreply@coherencedaddy.com";
  const { subject, html, text } = buildSharerWelcome({
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
      text,
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
  if (!transport && !brevoConfigured()) {
    logger.warn({ template, to }, "email-templates: no transport (Brevo/SMTP) — email skipped");
    return;
  }

  const from = process.env.ALERT_EMAIL_FROM ?? "noreply@coherencedaddy.com";
  const bcc = process.env.ALERT_EMAIL_TO ?? undefined;

  let subject: string;
  let html: string;
  let text: string;

  switch (template) {
    case "directory-welcome":
      ({ subject, html, text } = buildDirectoryWelcome(vars));
      break;
    case "partner-welcome":
      ({ subject, html, text } = buildPartnerWelcome(vars));
      break;
    case "intel-welcome":
      ({ subject, html, text } = buildIntelWelcome(vars));
      break;
    case "checkout-reminder":
      ({ subject, html, text } = buildCheckoutReminder(vars));
      break;
    case "renewal-reminder":
      ({ subject, html, text } = buildRenewalReminder(vars));
      break;
    case "affiliate-application":
      ({ subject, html, text } = buildAffiliateApplication(vars));
      break;
    case "affiliate-approved":
      ({ subject, html, text } = buildAffiliateApproved(vars));
      break;
    case "affiliate-reset-password":
      ({ subject, html, text } = buildAffiliateResetPassword(vars));
      break;
    case "affiliate-pending-digest":
      ({ subject, html, text } = buildAffiliatePendingDigest(vars));
      break;
    case "affiliate-commission-created":
      ({ subject, html, text } = buildAffiliateCommissionCreated(vars));
      break;
    case "affiliate-commission-approved":
      ({ subject, html, text } = buildAffiliateCommissionApproved(vars));
      break;
    case "affiliate-payout-sent":
      ({ subject, html, text } = buildAffiliatePayoutSent(vars));
      break;
    case "affiliate-payout-held":
      ({ subject, html, text } = buildAffiliatePayoutHeld(vars));
      break;
    case "affiliate-lock-expired":
      ({ subject, html, text } = buildAffiliateLockExpired(vars));
      break;
    case "affiliate-lead-status-change":
      ({ subject, html, text } = buildAffiliateLeadStatusChange(vars));
      break;
    case "affiliate-tier-upgraded":
      ({ subject, html, text } = buildAffiliateTierUpgraded(vars));
      break;
    case "affiliate-violation-warning":
      ({ subject, html, text } = buildAffiliateViolationWarning(vars));
      break;
    case "affiliate-suspended":
      ({ subject, html, text } = buildAffiliateSuspended(vars));
      break;
    case "affiliate-giveaway-winner":
      ({ subject, html, text } = buildAffiliateGiveawayWinner(vars));
      break;
    case "affiliate-reengagement":
      ({ subject, html, text } = buildAffiliateReengagement(vars));
      break;
    case "affiliate-merch-shipped":
      ({ subject, html, text } = buildAffiliateMerchShipped(vars));
      break;
    default: {
      const _exhaustive: never = template;
      logger.error({ template: _exhaustive }, "email-templates: unknown template");
      return;
    }
  }

  try {
    // Brevo-first; falls back to Proton SMTP if Brevo is unconfigured or fails.
    const sent = await sendMailBrevoFirst({ from, to, bcc, subject, html, text }, transport);
    if (sent) {
      logger.info({ template, to }, "email-templates: sent");
    } else {
      logger.warn({ template, to }, "email-templates: send dropped (Brevo unconfigured/failed and no SMTP fallback)");
    }
  } catch (err) {
    logger.error({ err, template, to }, "email-templates: send failed");
  }
}
