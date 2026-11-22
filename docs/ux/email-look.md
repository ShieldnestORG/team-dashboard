# Email look — Coherence Daddy mail sent by team-dashboard

> **Cluster:** ux/email · **Tags:** email, branding, house look, email-theme, unsubscribe, plain text, alerts · **Related:** [Alerting Policy](../operations/alerting-policy.md), [Design System](design-system.md), [Ownership](../OWNERSHIP.md)

Owner request 2026-11-21 ("all of my coherence daddy and evntrace and tokns out going emails fully branded"),
ticket DEV-141 (track 2 of 5). Owner decisions that day: brand **both** customer mail and owner-only alerts (alerts
get a light frame and stay quick to scan); tokns footer address and outside services (hosted Supabase, Stripe, Brevo)
are other tracks.

## Where it lives

| What | File |
|---|---|
| Look: palette, components, the two frames, plain-text renderer | `server/src/services/email-theme.ts` |
| 21 affiliate / partner / directory / Intel / renewal templates, dashboard password reset, shop-sharer welcome | `server/src/services/email-templates.ts` |
| Owner alerts (`sendAlert`) | `server/src/services/alerting.ts` |
| Owner "new paying member" notice | `buildNewMemberOwnerEmail` in `server/src/services/university-email.ts`, sent by `university-stripe-handler.ts` |
| Transport (Brevo first, Proton SMTP fallback), now passes `text` | `server/src/services/brevo.ts` |
| Tests | `server/src/__tests__/email-theme.test.ts`, `email-templates-brand.test.ts`, `new-member-owner-email.test.ts`, `brevo-text-part.test.ts`, `services/alerting.test.ts` |

The values are **ported from coherencedaddy-landing `emails/theme.ts`** (the source of truth for the Coherence Daddy
email look). Change them there first, then mirror them in `email-theme.ts`.

## The look

| Token | Hex | Use |
|---|---|---|
| PAPER | `#F8F7F4` | page canvas, code chips |
| CARD | `#FFFFFF` | the raised card |
| INK | `#0E0E10` | headings, links, the label on coral |
| MUTED | `#57554F` | body text |
| FAINT | `#8A8780` | footer / legal text |
| HAIRLINE | `#E5E2DC` | rules and borders (neutral grey, never coloured) |
| CORAL | `#FF6B4A` | buttons and the top rule only, never running text |

- Images are PNG only (never SVG): the coral rule `https://coherencedaddy.com/brand/email/coral-rule.png` and the
  monogram `https://coherencedaddy.com/brand/monogram-cd-coral-email.png`.
- Buttons are a coral table cell with an **ink** label (ink on coral 6.8:1; white on coral 2.5:1 fails). The landing's
  pre-rendered PNG buttons exist only for its own fixed labels, so these are the CSS fallback from its theme.
- Links are ink and underlined. Inline styles and tables only; system font stack; dark mode through the two
  colour-scheme metas plus the `.bg-page` / `.bg-card` / `.t-*` classes every text element carries.
- Text put into the HTML is escaped by default: `h` tagged template and the component helpers escape every value;
  only `SafeHtml` (what the helpers return) goes in verbatim.
- Every send carries a plain-text part, derived from the same HTML by `htmlToText` (links as `label (url)`, the button as
  `Label: url`).

## The two frames

| Frame | Function | For | Footer |
|---|---|---|---|
| Customer letterhead | `renderCustomerEmail({kind})` | customers, affiliates, partners | postal address `Coherence Daddy · 415 Dairy Rd E413 · Kahului, HI 96732`; `kind: "commercial"` adds the **Unsubscribe** link |
| Owner frame | `renderOwnerEmail` | mail only the owner reads: alerts, signup notices, affiliate application, compliance alert | "Owner-only message from Team Dashboard." No address, no unsubscribe |

Which template uses which (set in the builder):

- **commercial** (unsubscribe link): `checkout-reminder`, `affiliate-reengagement`, `affiliate-giveaway-winner`, shop-sharer welcome.
- **owner**: `affiliate-application`, `affiliate-violation-warning`, every `sendAlert` mail, the new-member notice.
- **transactional**: everything else.

### Unsubscribe is by email, on purpose

team-dashboard has **no suppression list** of its own. The storefront's tokenized one-click page only edits the
storefront's own newsletter list, so linking to it from an affiliate or checkout mail would promise something that
does not stop these sends. Commercial footers therefore link to
`mailto:info@coherencedaddy.com?subject=Unsubscribe`; a person acts on it. A real one-click opt-out needs a
suppression table that every `sendTransactional` path checks (and a `List-Unsubscribe` header): a separate piece of
work, owner decision.

## Every HTML sender in this repo (inventory 2026-11-21)

| Sender | Status |
|---|---|
| `email-templates.ts` — 21 `sendTransactional` templates | branded |
| `email-templates.ts` — `sendPasswordResetEmail` (better-auth) | branded (was two bare `<p>` tags) |
| `email-templates.ts` — `sendSharerWelcomeEmail` | branded, QR stays a CID attachment |
| `alerting.ts` — `sendAlert` (critical types; routine types send no email) | branded, owner frame |
| `university-stripe-handler.ts` — new paying member notice | branded, owner frame |
| `creditscore-email-callback.ts`, `watchtower-email-callback.ts`, `university-email.ts` | **no HTML here**: they post `{kind, to, data}` to the storefront, which renders them (coherencedaddy-landing, track 1) |
| `university-email-events.ts` | inbound engagement webhooks only, sends nothing |
| `socials/daily-brief.ts` | writes a brief to the database and `/daily-brief`; sends no email |
| `affiliate-crons.ts`, `compliance-scanner.ts`, `intel-billing.ts`, routes | call `sendTransactional`, inherit the shell |

Host-level alerts (`egress-watch.sh` on the VPS boxes) are shell scripts outside this repo and are not covered here.

## Adding or changing a template

1. Build the body from the helpers in `email-theme.ts` (`heading`, `para`, `lead`, `label`, `note`, `bulletList`,
   `link`, `ctaButton`, `monoBox`, `dataTable`) inside the `h` tagged template. No raw hex, no raw `<a>` or `<strong style>`.
2. Return it through `customer(subject, body, kind)` or `ownerOnly(...)`. Pick `commercial` for a nudge or promo.
3. Add the name to the lists in `email-templates-brand.test.ts`; the sweep checks palette, PNG-only images, ink on coral,
   ink underlined links, address, unsubscribe and the plain-text part.
4. Render it and look at it at 375 / 1024 / 1440, light and dark (`ui-ship-check`).

## Not covered / open

- PNG buttons (they would need new files in coherencedaddy-landing `public/brand/email/`).
- `List-Unsubscribe` header and a real suppression list (see above).
- Outside services (Brevo templates, Stripe receipts, hosted Supabase auth mail) are a separate track, one owner yes each.
- Footer text is FAINT on white (3.5:1), inherited from the landing theme.
