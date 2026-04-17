# Admin Affiliate Testing Guide

Step-by-step walkthrough for the Coherence Daddy team to test, verify, and demo every part of the affiliate system end-to-end. Use this any time you onboard a new team member, verify a deployment, or demo the program.

---

## Prerequisites

| What | Where | Notes |
|------|-------|-------|
| Team dashboard access | Your Vercel URL or local dev | Must be logged in as board member |
| Affiliate portal | https://affiliates.coherencedaddy.com | Public — no admin auth |
| SMTP configured | Check `SMTP_HOST` in `.env.production` | Emails fire from here |
| Test email address | Any real inbox you can read | For affiliate account + approval email |

---

## Phase 1 — Registration & Pending State

**Goal:** Confirm a new affiliate can register and hits the holding screen.

1. Open **https://affiliates.coherencedaddy.com** in a browser (or incognito tab).
2. Click **Create Account** tab.
3. Fill in:
   - Full Name: `Test Affiliate`
   - Email: your test email
   - Password: `testpass123`
   - Confirm Password: `testpass123`
4. Click **Create Account**.
5. **Expected:** Green success screen — "Application submitted! We'll review and notify you."
6. Check your inbox → you should receive **"New Affiliate Application — Test Affiliate"** email with a link to the Affiliates admin page.
7. Go to **team dashboard → Affiliates** in the sidebar.
8. **Expected:** `Test Affiliate` row with amber **pending** badge, prospect count 0, applied date today.

**Verify rejection cases:**
- Try registering same email again → `Email already registered`
- Try password `abc` (< 8 chars) → `Password must be at least 8 characters`
- Try mismatched confirm password → `Passwords do not match` (client-side, before submit)

---

## Phase 2 — Pending Dashboard Experience

**Goal:** Confirm the affiliate's view while pending.

1. On https://affiliates.coherencedaddy.com, click **Log In** tab.
2. Log in as `Test Affiliate`.
3. **Expected:** Holding screen — "Application Under Review" with applied date and support email link.
4. Try to navigate to `/dashboard` directly → same holding screen (status gates the view).
5. Confirm the "New Client" button is **not** visible (pending affiliates cannot submit).

---

## Phase 3 — Approval & Activation Email

**Goal:** Approve the affiliate and verify the notification.

1. In team dashboard → **Affiliates**, find `Test Affiliate`.
2. Click **Approve**.
3. **Expected:** Row badge changes instantly to green **active** (optimistic update).
4. Check the test inbox → **"You're approved — Welcome to the Coherence Daddy Affiliate Program"** with a dashboard link.
5. Return to https://affiliates.coherencedaddy.com and log in again (or refresh).
6. **Expected:** Full active dashboard — two action cards, stats (0 Prospects, 0 Converted, $0.00 Est. Earnings), empty prospects list.

---

## Phase 4 — Prospect Submission & AI Pipeline

**Goal:** Submit a real business URL and watch the pipeline run.

1. On the affiliate dashboard, click **New Client**.
2. Enter a real business website, e.g. `https://www.sweetgreens.com` or any local business.
3. Click **Lock it In**.
4. **Expected:** < 1 second redirect to `/prospects/:slug`. Status badge shows **Queued**.
5. Watch the status badge — it should progress: **Queued → Scanning → Analyzing → Ready** (takes ~30–90 seconds depending on Firecrawl + Ollama).
6. While it's running, the header shows "Updating automatically..." with a pulse animation.
7. Once **Ready**:
   - **Overview tab:** Business name, industry, location, services tags, description
   - **Competitors tab:** 3 competitor cards with names, URLs, summaries
   - **Notes tab:** Empty text areas, ready for affiliate to fill in
   - **Updates tab:** Editable name/location/website fields

**If it fails (red "Failed" badge):**
- Click "New Client" → enter the same URL again → this should re-trigger (not 409)
- Status resets to Queued and pipeline retries

**Verify duplicate URL rejection:**
- Submit the same URL from a different affiliate account → `This business is already in our system.`

---

## Phase 5 — Notes & Updates

**Goal:** Confirm both note fields save correctly.

1. Open the prospect detail → **Notes tab**.
2. Type in **Your Notes**: `Met the owner, very interested, follow up next week`
3. Type in **Store Notes**: `Owner wants more foot traffic, currently has no social media presence`
4. Click **Save Notes** → **Expected:** "Saved!" confirmation.
5. Refresh the page → both notes persist.
6. Go to **Updates tab** → change the business name → **Save Changes** → refresh and confirm.

---

## Phase 6 — Dashboard Stats

**Goal:** Confirm stats reflect submitted prospects.

1. Return to the affiliate dashboard (`/dashboard`).
2. **Expected:** 
   - **Prospects:** 1 (or however many you submitted)
   - **Converted:** 0 (no Stripe subscriptions yet)
   - **Est. Earnings:** $0.00
3. Commission badge in header shows **10% commission** (not raw `0.10`).
4. Prospects table shows business name, status badge, submitted date, View link.

---

## Phase 7 — Admin Affiliate Table

**Goal:** Verify admin sees correct counts and can manage the affiliate.

1. In team dashboard → **Affiliates**.
2. Verify `Test Affiliate` row shows:
   - Status: **active**
   - Commission: **10%**
   - Prospects: **1** (or your count)
   - Converted: **0**
   - Applied: today's date
3. Click **Suspend** → badge goes to red **suspended**.
4. Log in to affiliate portal → **Expected:** 403 "Account suspended" error, no token issued.
5. Back in admin → click **Reinstate** → affiliate can log in again.

---

## Phase 8 — Password Reset

**Goal:** Confirm self-service password recovery works end-to-end.

1. On https://affiliates.coherencedaddy.com, click **Forgot password?**.
2. Enter the affiliate test email.
3. Click **Send Reset Link** → "Check Your Email" screen appears (whether email exists or not — intentional security behavior).
4. Check inbox → **"Reset your Coherence Daddy affiliate password"** with a reset link.
5. Click the link → password reset form at `/reset-password?token=...`
6. Enter new password `newpass456` + confirm.
7. Click **Update Password** → "Password Updated" screen.
8. Click **Back to Login** → log in with new password.

**Verify expired token:** Wait 1 hour and try using the same link → `Invalid or expired reset link`.

---

## Phase 9 — Conversion Tracking (Simulated)

**Goal:** Verify `is_paying` flag and dashboard stats update correctly.

Since you likely won't run a real Stripe checkout in testing, simulate it directly in the database:

```bash
ssh root@31.220.61.12 'docker exec -i $(docker ps -q | head -1) sh -c "cd /app && node -e \"
const { db } = await import('./server/dist/app.js');
// Or use psql directly:
\""'
```

**Simpler — use psql directly:**
```bash
ssh root@31.220.61.12 'docker exec -i $(docker ps -q | head -1) sh -c "
  DATABASE_URL=\$(grep DATABASE_URL /app/.env.production | cut -d= -f2-)
  psql \$DATABASE_URL -c \"
    UPDATE partner_companies
    SET is_paying = true,
        converted_at = now(),
        subscription_status = '\''active'\'',
        status = '\''active'\''
    WHERE slug = '\''YOUR-PROSPECT-SLUG'\'';
  \"
"'
```

Replace `YOUR-PROSPECT-SLUG` with the slug from the URL when you viewed the prospect (`/prospects/THE-SLUG`).

After running:
1. Refresh the affiliate dashboard.
2. **Expected:**
   - Converted stat: **1** (green)
   - Est. Earnings: e.g. **$49.00** (if `monthly_fee` is set on the partner row)
   - Prospect row shows green **Converted** badge alongside the status badge
3. Refresh admin → **Affiliates** page.
4. **Expected:** `Test Affiliate` row Converted column shows **1** (green).

---

## Phase 10 — Pending Digest Email (Manual Trigger)

**Goal:** Confirm the weekly cron email works without waiting until Monday.

Trigger the cron manually from the system crons admin page or via API:

1. In team dashboard → **System → Crons** (if accessible).
2. Find `affiliate:pending-digest` → click **Run Now**.

Or trigger via curl from VPS:
```bash
ssh root@31.220.61.12 'curl -s -X POST http://localhost:3200/api/crons/run \
  -H "Content-Type: application/json" \
  -d "{\"jobName\":\"affiliate:pending-digest\"}" \
  -H "Cookie: your-admin-session-cookie"'
```

**Expected:** Any affiliate with status `pending` receives the "still under review" digest email.

---

## Quick-Reference: All Affiliate API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/affiliates/register` | Public | Register new affiliate |
| `POST` | `/api/affiliates/login` | Public | Login, get JWT |
| `GET` | `/api/affiliates/me` | JWT | Profile + stats (prospectCount, convertedCount, estimatedEarned) |
| `GET` | `/api/affiliates/prospects` | JWT | List my prospects (with isPaying) |
| `POST` | `/api/affiliates/prospects` | JWT | Submit new prospect URL |
| `GET` | `/api/affiliates/prospects/:slug` | JWT | Get prospect detail |
| `PUT` | `/api/affiliates/prospects/:slug/notes` | JWT | Save affiliate + store notes |
| `PUT` | `/api/affiliates/prospects/:slug` | JWT | Update name/location/website |
| `POST` | `/api/affiliates/forgot-password` | Public | Initiate password reset |
| `POST` | `/api/affiliates/reset-password` | Public | Confirm password reset with token |
| `GET` | `/api/affiliates/admin` | Board | List all affiliates with counts |
| `PUT` | `/api/affiliates/admin/:id/status` | Board | Approve / suspend / reinstate |

**Rate limits:** 10 requests per IP per 15-minute window on `/register`, `/login`, `/forgot-password`.

---

## Known Gaps / Future Work

| Gap | Impact | Suggested Fix |
|-----|--------|---------------|
| No pagination on affiliate's prospects list (shows first 10) | Low — new program | Add offset/total UI when `total > 10` |
| Admin can see prospect count but no drill-down list per affiliate | Medium | Add `/affiliates/admin/:id/prospects` route + admin detail page |
| `AFFILIATE_SUPPORT_EMAIL` shown as hardcoded `affiliates@coherencedaddy.com` on pending screen | Low | Could expose via `/me` response or public config endpoint |
| No affiliate-set commission rate UI | Low | Currently set in DB only; admin could set per-affiliate via status API extension |
| No test for Monday digest fire in CI | Low | Mock cron trigger in integration test |
