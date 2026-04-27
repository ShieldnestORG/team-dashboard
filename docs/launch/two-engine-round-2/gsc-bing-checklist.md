# Google Search Console + Bing Webmaster Submission Checklist

Goal: get both live tutorials manually inspected and indexed. Sitemap submission alone takes days; URL Inspection forces the crawler now.

## URLs to submit

1. `https://coherencedaddy.com/tutorials/use-ollama-to-enhance-claude`
2. `https://coherencedaddy.com/tutorials/give-obsidian-a-memory`

(The second tutorial was confirmed live by the previous agent. If `give-obsidian-a-memory` 404s on submission day, drop it from this list and only submit the first.)

---

## Google Search Console — URL Inspection

**Prereq:** the `coherencedaddy.com` property is verified in GSC under the operator's Google account. If not, that's a separate setup task (verify via DNS TXT record or `<meta>` tag in `<head>` — the storefront already exposes the latter via `app/layout.tsx`).

### Steps (per URL)

1. Go to https://search.google.com/search-console.
2. Select the `coherencedaddy.com` property from the top-left dropdown.
3. Paste the full URL into the **top URL bar** (the "Inspect any URL in https://coherencedaddy.com" field). Press Enter.
4. **Expected screen:** "URL is on Google" or "URL is not on Google" — both show a status panel with crawl status, indexing status, and a `TEST LIVE URL` button.
5. Click **TEST LIVE URL** (top-right). Wait ~30s.
6. **Expected screen:** "URL is available to Google" with a green check, plus a **REQUEST INDEXING** button on the right.
7. Click **REQUEST INDEXING**. Wait ~1 minute. Confirmation toast: "Indexing requested — URL added to a priority crawl queue."
8. Repeat for the second URL.

### What to do if it fails

- **"URL is not available to Google"** → click "View tested page" → check "More info" tab. Likely causes: robots.txt blocking (check `/robots.txt`), `noindex` meta tag, or a 4xx/5xx response. Fix on the storefront side, redeploy, then retry.
- **"Quota exceeded"** → GSC limits to roughly **10–12 indexing requests per day** per property. If hit, wait 24h. Submitting only 2 URLs you should never see this — but if a future agent expands the list, batch.
- **"Couldn't fetch"** → CDN cold cache or temporary timeout. Retry after 5 minutes. If it persists, check the storefront's Vercel deployment status.
- **"URL is unknown to Google"** but live test passes → just keep "Request indexing" — that's normal for new URLs.

---

## Bing Webmaster Tools — URL Submission

**Prereq:** `coherencedaddy.com` site is added in Bing Webmaster Tools, verified via meta tag, XML file, or CNAME. If not added, do that first (Bing → Sites → Add a site).

### Steps (per URL)

1. Go to https://www.bing.com/webmasters.
2. Select `coherencedaddy.com` from the site picker.
3. In the left nav, click **URL Submission**.
4. **Expected screen:** "Submit URLs" panel showing your daily/monthly quota counters (typically 10/day, 50/month for new properties; up to 10,000/day for established ones).
5. Click **Submit URLs**. A textarea opens.
6. Paste both full URLs, one per line:
   ```
   https://coherencedaddy.com/tutorials/use-ollama-to-enhance-claude
   https://coherencedaddy.com/tutorials/give-obsidian-a-memory
   ```
7. Click **Submit**. Confirmation: "URLs submitted successfully."
8. Verify on the URL Submission page — the URLs should appear in the recent-submissions table with status `Submitted`.

### What to do if it fails

- **"Daily quota exceeded"** → Bing's quotas are stricter than Google's for new sites. Wait 24h.
- **"URL not on your domain"** → re-check site verification in Bing Webmaster (Sites → coherencedaddy.com → Site Verification). The storefront should already serve the verification meta tag; if not, add it back.
- **"URL not found / 404"** → confirm the URL loads in an incognito browser. If it loads but Bing claims 404, force a Vercel redeploy and retry — Bing's edge can stale-cache.
- **Generic timeout / 500** → Bing Webmaster is occasionally flaky. Retry in 30 min before escalating.

---

## After submission

- **Don't expect instant results.** Google priority crawl typically lands within 24-72h. Bing within 48h.
- **Track indexing status.** Re-inspect each URL in GSC 3 days later. If still "Discovered — currently not indexed," that's a content quality signal, not a technical one.
- **Sitemap sanity check.** Confirm `https://coherencedaddy.com/sitemap.xml` (or wherever the storefront's sitemap lives) lists both tutorial URLs. If missing, that's a separate fix on the storefront side.

## Do NOT

- Do not submit the same URL twice in a 24h window — Google flags it as spam signal on the property level.
- Do not submit the GitHub repo URL — GSC only accepts URLs on properties you own.
- Do not submit `https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude` to Bing under `coherencedaddy.com` — Bing rejects cross-domain submissions.
