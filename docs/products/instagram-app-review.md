# Instagram Auto-Posting — Setup & Meta App Review Checklist

This doc captures the **prerequisites, env wiring, and Meta App Review submission** for the
team-dashboard Instagram publishers (`instagram_feed`, `instagram_reels`).

## Account prerequisites

Before any code path will work, the IG account must satisfy ALL of:

- [ ] IG account is **Professional → Business** (NOT Creator).
      `IG app → Settings → Account → Switch to Professional Account → Business`.
      Reversible. Takes ~30 seconds on the phone.
- [ ] IG account is **connected to a Facebook Page** (the Page is the
      authentication anchor; the IG account hangs off it).
      `IG app → Edit Profile → Page → Connect or Create`.
- [ ] You have **admin access** to that Facebook Page.

> Without these three, `instagram_business_account` will be `null` when we
> query `/me/accounts` and the publishers will fail with "User not found
> for this Instagram Business account".

## Facebook App setup (developers.facebook.com)

- [ ] Create a Meta App at https://developers.facebook.com/apps (Type: Business)
- [ ] Add **Instagram Graph API** product
- [ ] Add **Facebook Login** product (used to obtain the page token)
- [ ] Note the App ID + App Secret (do **not** put App Secret in env — we only
      ship the long-lived page token)
- [ ] In **App Roles → Roles**, add `nestd@pm.me` as Administrator (or whoever
      will run the test posts in Dev Mode)

## Obtaining `INSTAGRAM_ACCESS_TOKEN`

The cleanest path uses Graph API Explorer:

1. https://developers.facebook.com/tools/explorer/
2. Select your app → **User Token** → grant scopes:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `pages_read_engagement`
3. Click "Generate Access Token" → approve in the IG/FB popup
4. Take the **short-lived user token** and exchange for a **long-lived user token**:
   ```
   GET https://graph.facebook.com/v21.0/oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id={app-id}
     &client_secret={app-secret}
     &fb_exchange_token={short-lived-user-token}
   ```
5. With the long-lived **user** token, list Pages and grab the Page token:
   ```
   GET https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account
   ```
6. **The Page access token** (from step 5) becomes `INSTAGRAM_ACCESS_TOKEN`.
   Page tokens derived from a long-lived user token are themselves long-lived
   (~60 days, refreshable).
7. The `instagram_business_account.id` from step 5 becomes `INSTAGRAM_BUSINESS_ACCOUNT_ID`.

## Token rotation

Page tokens expire after **~60 days**. Rotation is currently **manual**:

- Calendar reminder for day 55: re-run steps 4–5 with a fresh user token
- Update `.env` on VPS1 + local + Vercel (if used)
- Restart the team-dashboard server: `ssh root@31.220.61.12 'cd /opt/team-dashboard && docker compose restart server'`

Future work: automate refresh on cron (file follow-up issue when shipping this branch).

## Dev Mode vs. Live Mode

In **Dev Mode** the Graph API will only post to IG accounts owned by users with
an App Role on the Facebook App (Admin/Developer/Tester). This is sufficient
for testing posts to `@coherencedaddy` while we wait for app review.

To go **Live** (post to any connected IG Business account in the future),
the App must complete Meta App Review for `instagram_content_publish`.

## Meta App Review submission checklist

(Only needed when we want to publish on behalf of accounts other than our own —
i.e., agencies, partners, white-label deployments. For posting to our own
brand IGs, Dev Mode is permanent and sufficient.)

- [ ] **Privacy Policy URL** — public, mentions Instagram data handling.
      Likely lives at `coherencedaddy.com/privacy`.
- [ ] **Terms of Service URL**
- [ ] **Data Deletion URL or Instructions**
- [ ] **App Icon** — 1024×1024 PNG
- [ ] **App Category** — "Business and Pages"
- [ ] **Use Case Description** — 1–2 paragraphs of: who uses this, why they
      need to post to IG, how the data flows. Mention "internal admin only,
      not a public consumer-facing product".
- [ ] **Screencast** (60–120 seconds) demonstrating:
    1. Log into team-dashboard admin
    2. Connect IG account via "Connect Instagram" button
    3. Navigate to `/socials → Compose`
    4. Compose a post with image + caption
    5. Submit → show it appearing on Instagram
- [ ] **Test Account credentials** — Meta reviewer needs a working login.
      Provide a dedicated review-only admin account.
- [ ] Submit each requested permission separately (`instagram_content_publish`
      is the critical one; others are derived).

Typical review turnaround: **1–3 weeks**. Do not block the IG branch merge
on this — code lands, review proceeds in parallel, and we flip from Dev
to Live mode once approved.

## Per-publisher capability summary

| Publisher       | Drives                | Media   | Status              |
|-----------------|-----------------------|---------|---------------------|
| `instagram_feed`| socials queue (Compose)| image  | ✅ V1 (carousel ✓) |
| `instagram_reels`| reels pipeline       | video  | ✅ V1 (single Reel)|
| Stories         | —                     | —      | ❌ deferred         |
| Tagging users   | —                     | —      | ❌ deferred         |
| Location tags   | —                     | —      | ❌ deferred         |

## Troubleshooting

| Symptom                                                | Likely cause                                                  |
|--------------------------------------------------------|---------------------------------------------------------------|
| `(#100) Tried accessing nonexisting field`             | IG account not connected to FB Page, or token lacks `instagram_basic` |
| `(#190) Error validating access token`                 | Page token expired — rotate per "Token rotation" section      |
| `(#10) Application does not have permission`           | Missing `instagram_content_publish` — must be Business + reviewed (or admin in Dev Mode) |
| Container stuck in `IN_PROGRESS` past 5min             | Meta upstream slow; will time out and queue retries           |
| Container `ERROR` with `status` = "Media format..."    | Image too large (max 8MB), wrong aspect ratio, or unreachable URL |
| `(#2207042) Maximum 25 posts per day`                  | IG hard rate limit — terminal for the calendar day            |

## Reference

- Meta IG Content Publishing API: https://developers.facebook.com/docs/instagram-platform/content-publishing
- Graph API error codes: https://developers.facebook.com/docs/graph-api/guides/error-handling
- App Review submission: https://developers.facebook.com/docs/app-review
