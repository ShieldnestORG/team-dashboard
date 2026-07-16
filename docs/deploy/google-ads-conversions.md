# Google Ads — University purchase conversion upload

> **Cluster:** payments-attribution · **Tags:** google-ads, conversion, gclid, offline-conversion, university, stripe-webhook · **Related:** [env-vars](env-vars.md), [stripe-runbook](stripe-runbook.md), [stripe-products](stripe-products.md)

How a paid Google Ads click becomes a **purchase conversion** in the Ads account
— and exactly what Mark must provision before uploads go live.

## Why server-side

The University sale completes on Stripe's **hosted** checkout, then lands on
`app.coherencedaddy.com` — a different site than the ad's landing page
(`jointhecoherent.com` / `coherencedaddy.com/university`). No on-page tag can
honestly measure the purchase, and Google's click cookie never crosses those
domains. So the click id makes the trip in the request path instead:

```
ad click → landing URL ?gclid=…            (storefront stores it, localStorage 90d)
        → POST /api/university/checkout    (storefront forwards gclid/wbraid/gbraid)
        → Stripe session metadata.gclid    (routes/university-checkout.ts)
        → checkout.session.completed       (webhook)
        → uploadClickConversions           (services/google-ads-conversions.ts)
```

The uploader sends: the click id, the **real billed amount**
(`metadata.unit_amount_cents`), and the Stripe checkout session id as
`orderId` — Google's dedupe key, so a webhook retry (or the portal's
client-side belt-and-suspenders fire with the same `transaction_id`) can never
double-count.

## Degraded states (safe by construction)

| State | Behavior |
|---|---|
| Env vars not set | Conversion is **logged** (level=info, full payload, greppable `google-ads-conversions: NOT CONFIGURED`) and skipped. Nothing breaks. |
| Purchase with no click id (organic/direct) | Skipped silently (debug log). |
| Google API error / expired click / duplicate | Logged, webhook still returns 200 — ad measurement never blocks member activation. |

Backfill: click ids also persist on the Stripe session metadata, and Google
accepts click-conversion uploads for **90 days after the click** — so a
purchase that happened while the env was unprovisioned can be uploaded later
(from the VPS4 logs or by listing Stripe checkout sessions).

## Provisioning checklist (owner)

Everything below is one-time. Until **all** of steps 1–4 are done, the
uploader stays in log-only mode.

1. **Create the conversion action** (Ads account `226-801-4496`):
   Tools → Goals → Conversions → **New conversion action → Import → Manual
   import using API or uploads → Track conversions from clicks**.
   - Name: `CD - University purchase` · Category: **Purchase** · Value: *use
     the value from the upload* (fallback $50) · Count: **One** ·
     Click-through window: 90 days.
   - After creation, grab the action's **numeric id** (in the URL as
     `ctId=…`, or via the API) → `GOOGLE_ADS_UNIVERSITY_CONVERSION_ACTION_ID`.
   - Do NOT reuse the old `CD - University signup` action
     (`vLiuCIGV5MUcEM_mxf1C`) — that one is the retired email-reservation /
     checkout-start signal; repurpose it as a secondary "begin checkout"
     action or remove it from the conversions column.
2. **Developer token**: Ads UI → Tools → **API Center** (must be done on a
   MANAGER account; create a free MCC and link `226-801-4496` if there isn't
   one). Basic access is enough (conversion upload only)
   → `GOOGLE_ADS_DEVELOPER_TOKEN`.
3. **OAuth client + refresh token** (Google Cloud console, any project):
   enable the **Google Ads API**, create an OAuth client (Desktop type is
   simplest), run the standard OAuth flow for the Google user that owns the
   Ads account with scope `https://www.googleapis.com/auth/adwords`, keep the
   refresh token → `GOOGLE_ADS_OAUTH_CLIENT_ID` /
   `GOOGLE_ADS_OAUTH_CLIENT_SECRET` / `GOOGLE_ADS_OAUTH_REFRESH_TOKEN`.
4. **Env on VPS4** (`.env.production`, then redeploy team-dashboard):
   ```
   GOOGLE_ADS_DEVELOPER_TOKEN=…
   GOOGLE_ADS_OAUTH_CLIENT_ID=…
   GOOGLE_ADS_OAUTH_CLIENT_SECRET=…
   GOOGLE_ADS_OAUTH_REFRESH_TOKEN=…
   GOOGLE_ADS_CUSTOMER_ID=226-801-4496
   GOOGLE_ADS_LOGIN_CUSTOMER_ID=<MCC id, only if using one>
   GOOGLE_ADS_UNIVERSITY_CONVERSION_ACTION_ID=<numeric id from step 1>
   ```
5. **Portal client-side fire (optional but recommended)**: set
   `NEXT_PUBLIC_GADS_ID=AW-17980027727` and
   `NEXT_PUBLIC_GADS_PURCHASE_LABEL=<label of the step-1 action>` on the
   **app-coherencedaddy-portal** Vercel project and redeploy. Uses the same
   conversion action + the same transaction id, so Google dedupes it against
   the server upload. (The label is the part after the `/` in the action's
   `send_to` snippet.)
6. **Verify**: buy through an ad click (or append a real `?gclid=` from a test
   campaign click to the landing URL), complete checkout, then check VPS4 logs
   for `google-ads-conversions: purchase conversion uploaded` and Ads UI →
   Conversions (uploads can take ~3h to appear; diagnostics under the
   conversion action's "Uploads" tab).

## What this deliberately does NOT do

- **No Enhanced Conversions for Leads** (hashed-email uploads for click-id-less
  purchases). Possible follow-up; requires enabling EC on the conversion
  action + user-identifier payloads.
- **No DB column** — the click id lives on the Stripe session metadata only.
  If we ever want in-DB attribution reporting, add a migration then.
- **No consent-mode plumbing** — campaigns are US-only today; EEA consent
  fields (`consent.adUserData`…) would be needed before targeting the EEA.
