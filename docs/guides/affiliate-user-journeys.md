# Affiliate System — User Journey Flows

Ten journeys covering the full affiliate lifecycle: registration, login, password recovery, new client submission, failed re-submission, prospect management, admin oversight, email touchpoints, commission conversion, and the full end-to-end lifecycle.

---

## 1. Affiliate Registration

A new person discovers the program and applies.

```mermaid
flowchart TD
    A([Visit affiliates.coherencedaddy.com]) --> B[Landing page\nMarketing copy + benefit cards]
    B --> C[Click 'Create Account' tab]
    C --> D[Fill in: Name · Email · Password · Confirm Password]
    D --> E{Client-side validation}
    E -- Password < 8 chars --> D
    E -- Passwords don't match --> D
    E -- OK --> F[Submit registration]
    F --> G{Server checks}
    G -- Email already registered --> H[409: 'Email already registered']
    H --> D
    G -- Password < 8 chars --> I[400: 'Password must be at least 8 characters']
    I --> D
    G -- OK --> J[Account created\nstatus = pending]
    J --> K[Show success:\n'Application submitted!\nWe'll review and notify you.']
    J --> L[📧 Admin receives email:\nNew affiliate application]
    K --> M([Affiliate waits for approval\nApplied date shown on pending screen])
    L --> N([Admin sees pending count\nin team dashboard Affiliates page])
```

---

## 2. Affiliate Login & Status Routing

Returning affiliate authenticates and is routed by account status.

```mermaid
flowchart TD
    A([Visit affiliates.coherencedaddy.com]) --> B[Enter email + password]
    B --> C{Rate limit check\n10 req / 15 min per IP}
    C -- Exceeded --> D[429: 'Too many attempts'\nTry again in 15 minutes]
    C -- OK --> E[Submit login]
    E --> F{Credentials valid?}
    F -- No --> G[401: 'Invalid credentials']
    G --> B
    F -- Yes --> H{Account status?}
    H -- suspended --> I[403: 'Account suspended'\nNo token issued]
    H -- pending --> J[JWT issued → /dashboard]
    J --> K[Holding page:\nApplied date · 'Under review'\nContact email shown]
    H -- active --> L[JWT issued → /dashboard]
    L --> M([Full dashboard:\nStats + prospects table])
```

**Token:** HS256 JWT, 30-day TTL, signed with `AFFILIATE_JWT_SECRET`. Every authenticated request re-validates account status from DB — suspended affiliates are blocked instantly even with a valid token.

---

## 3. Password Recovery

Affiliate who forgot their password self-recovers without admin intervention.

```mermaid
flowchart TD
    A([Affiliate on login page]) --> B[Click 'Forgot password?']
    B --> C[/reset-password page\nEmail input form]
    C --> D[Enter email + submit]
    D --> E[Always shows:\n'Check your email'\nwhether email exists or not]
    E --> F{Email found in DB?}
    F -- No --> G[No action — silent]
    F -- Yes --> H[Generate raw token\nStore SHA-256 hash\n1-hour expiry]
    H --> I[📧 Send reset email\nwith link: /reset-password?token=...]
    I --> J[Affiliate clicks link]
    J --> K[/reset-password?token=...\nNew password form]
    K --> L[Enter + confirm password\nmin 8 chars]
    L --> M{Token valid & not expired?}
    M -- No --> N[400: 'Invalid or expired reset link']
    M -- Yes --> O[Password updated\nToken nulled out]
    O --> P[Show: 'Password updated'\nBack to login link]
    P --> Q([Affiliate logs in with new password])
```

---

## 4. New Client Submission

Active affiliate submits a local business — returns in under 1 second, AI pipeline runs in background.

```mermaid
flowchart TD
    A([Affiliate on dashboard]) --> B[Click 'New Client' button]
    B --> C[Modal opens: URL input field]
    C --> D[Enter client website URL]
    D --> E[Click 'Lock it In']
    E --> F{URL valid?\nhttps:// required}
    F -- Invalid --> G[400: 'Please enter a full URL\nincluding https://']
    G --> D
    F -- Valid --> H{Duplicate website\nin system?}
    H -- Yes, other affiliate --> I[409: 'This business is\nalready in our system']
    H -- No --> J[Insert partner_companies row\nonboardingStatus = 'none'\naffiliate_id = me]
    J --> K[< 1 second response\nReturn slug]
    K --> L[Redirect to /prospects/:slug]
    L --> M[Prospect detail page\nStatus: Queued]

    J --> N[Fire-and-forget:\nrunPartnerOnboarding]

    subgraph BackgroundPipeline["Background Pipeline (async, ~60s)"]
        N --> O[Scrape website via Firecrawl\nStatus → Scanning]
        O --> P[AI extraction via Ollama:\nName, industry, services,\nkeywords, brand colors, contact]
        P --> Q[Competitor search via Firecrawl]
        Q --> R[Summarize top 3 competitors\nvia Ollama]
        R --> S[onboardingStatus → complete]
    end

    M --> T[Page polls every 6s]
    T --> U{Status?}
    U -- not complete --> V['Updating automatically...'\nanimated indicator]
    V --> T
    U -- complete --> W[All 4 tabs populated\nCompetitor cards visible]
    U -- failed --> X[Failed badge shown\nAffiliate can re-submit]
```

---

## 5. Failed Prospect Re-submission

When onboarding fails (Firecrawl timeout, Ollama error, etc.), the affiliate can retry without getting a duplicate-URL block.

```mermaid
flowchart TD
    A([Affiliate on prospect detail\nonboardingStatus = failed]) --> B[Click 'New Client']
    B --> C[Enter same URL again]
    C --> D[POST /api/affiliates/prospects]
    D --> E{Duplicate URL check}
    E -- Same affiliate + status = failed --> F[Reset onboardingStatus → none\nonboardingError → null]
    F --> G[Re-trigger runPartnerOnboarding\nfire-and-forget]
    G --> H[200: resubmitted: true\nReturn same slug]
    H --> I[Redirect to /prospects/:slug\nStatus: Queued again]
    E -- Different affiliate owns it --> J[409: 'Already in our system']
    E -- Own prospect, not failed --> J
```

---

## 6. Prospect Detail — Affiliate Perspective

How an affiliate explores and enriches a submitted prospect.

```mermaid
flowchart TD
    A([Affiliate opens /prospects/:slug]) --> B[Load prospect data\nverify affiliateId matches]
    B --> C[Header: name + status badge\n'Updating automatically...' if in progress]

    C --> D{Active tab}

    D --> E[Overview]
    D --> F[Competitors]
    D --> G[Notes]
    D --> H[Updates]

    E --> E1[Business name · website link\nindustry · location · description\nservices tags · AI summary\nonboarding status description]

    F --> F1{onboardingStatus = complete?}
    F1 -- No --> F2['Competitor analysis still\nbeing generated...']
    F1 -- Yes --> F3[3 competitor cards:\nName · clickable URL · summary]

    G --> G1['Your Notes' textarea\nRelationship · visit history\nyour private context]
    G --> G2['Store Notes' textarea\nShared with CD team:\nWhat the owner wants/needs]
    G1 & G2 --> G3[Save Notes → unsaved indicator\n'Saved!' flash on success]

    H --> H1[Editable fields: Name · Location · Website]
    H1 --> H2[Save Changes → PUT /prospects/:slug\nURL validated server-side]
    H2 --> H3[Profile corrected in DB]
```

---

## 7. Admin — Affiliate Management

How the Coherence Daddy team reviews, approves, and manages affiliates.

```mermaid
flowchart TD
    A([Admin logs into team dashboard]) --> B[Navigate to Affiliates in sidebar]
    B --> C[AffiliatesAdmin page loads\nTable: name · email · status · commission\nprospects · converted · applied date · actions]
    C --> D[Summary stats:\nN total · N pending · N active · N suspended]

    D --> E{Admin action}

    E -- Approve pending --> F[Click 'Approve'\nPUT /api/affiliates/admin/:id/status active]
    F --> G[Optimistic UI: badge → green Active]
    G --> H[📧 Affiliate receives 'You're approved' email\nLink to dashboard]
    H --> I([Affiliate logs in · sees full dashboard])

    E -- Suspend active --> J[Click 'Suspend'\nstatus → suspended]
    J --> K[Badge → red Suspended\nAffiliate blocked on next API request]

    E -- Reinstate suspended --> L[Click 'Reinstate'\nstatus → active]

    E -- Track conversions --> M[Converted column\nshows green count of paying prospects]

    E -- Review partners --> N[Navigate to Partners page]
    N --> O[Referred partners show\namber 'via Name' badge]
    O --> P[Click partner → PartnerDetail\nOverview shows 'Referred by: Name']
```

---

## 8. Email Notification Touchpoints

All automated emails in the affiliate system.

```mermaid
flowchart LR
    subgraph AffiliateEmails["Affiliate receives"]
        E1[✉ affiliate-approved\n'You're in — welcome'\nLink to dashboard]
        E2[✉ affiliate-reset-password\n'Reset your password'\n1-hour link]
        E3[✉ affiliate-pending-digest\n'Still under review'\nMonday 10am if pending]
    end

    subgraph AdminEmails["Admin receives"]
        E4[✉ affiliate-application\n'New application from Name'\nLink to /affiliates page]
    end

    subgraph Triggers["What triggers each"]
        T1[POST /register] --> E4
        T2[PUT /admin/:id/status → active] --> E1
        T3[POST /forgot-password\nwhen email found] --> E2
        T4[affiliate:pending-digest cron\nMonday 10am weekly] --> E3
    end

    style AffiliateEmails fill:#f0fdf4,stroke:#86efac
    style AdminEmails fill:#eff6ff,stroke:#93c5fd
    style Triggers fill:#fefce8,stroke:#fde047
```

**Rate limits on auth endpoints:** 10 requests per IP per 15-minute window (shared across register, login, forgot-password). Returns 429 when exceeded.

---

## 9. Commission Conversion Tracking

How a prospect moves from submitted lead to confirmed paying partner.

```mermaid
flowchart TD
    A([Affiliate submits prospect URL]) --> B[partner_companies row\naffiliate_id set\nis_paying = false\nconverted_at = null]
    B --> C[CD team reaches out\nto the business]
    C --> D{Business subscribes?}
    D -- No --> E[Prospect stays in pipeline\nAffiliate can follow up / update notes]
    D -- Yes --> F[CD team sends Stripe checkout\nvia Partner Network flow]
    F --> G[Business completes checkout]
    G --> H[Stripe fires checkout.session.completed webhook]
    H --> I[directory-listings webhook handler\nsets is_paying = true\nconverted_at = now\nstatus = active\nsubscriptionStatus = active]
    I --> J[Affiliate dashboard shows:\nConverted count +1\nGreen 'Converted' badge on prospect\nEst. Earnings updated with this partner's monthly_fee × commission_rate]
    I --> K[Admin table shows:\nConverted count +1 for this affiliate]

    G --> L[invoice.payment_succeeded fires on renewal]
    L --> M[is_paying stays true\nconverted_at preserved\nperiod extended]
```

---

## 10. Full Lifecycle Summary

End-to-end from discovery to active affiliate generating real revenue.

```mermaid
flowchart TD
    A([Person visits\naffiliate landing page]) --> B[Registers with name · email · password]
    B --> C[Admin gets email notification]
    C --> D[Admin approves in dashboard\nOptimistic UI + approval email]
    D --> E[Affiliate gets approval email\nClicks link to dashboard]
    E --> F[Affiliate logs in → full dashboard\n10% commission shown · stats visible]
    F --> G[Affiliate visits local business in person]
    G --> H[Clicks 'New Client'\nEnters business URL]
    H --> I[Prospect created < 1 second\nRedirected to prospect detail]
    I --> J[Background AI pipeline runs\n~60 seconds: scrape → extract → competitors]
    J --> K[Affiliate views full profile:\nbusiness info · competitor analysis · notes tabs]
    K --> L[Affiliate adds notes from visit\nStore Notes visible to CD team]
    L --> M[CD team sees prospect in Partners list\nAmber 'via Name' badge]
    M --> N[CD team reaches out to business]
    N --> O{Business subscribes?}
    O -- Yes --> P[Stripe checkout completes\nis_paying = true · converted_at set]
    P --> Q[Affiliate sees green 'Converted' badge\nEst. Earnings updates with commission %]
    Q --> R[Recurring monthly: is_paying stays true\nPeriod renewed on each invoice]
    O -- No --> S[Prospect stays in pipeline\nAffiliate can follow up\nRe-submit if onboarding failed]
```

---

## Summary Table

| Journey | Entry Point | Key Outcome | What's Automated |
|---------|-------------|-------------|-----------------|
| Registration | Landing → Create Account | Account pending | Admin notified; confirm password + 8-char min enforced |
| Login | Landing → Log In | JWT issued, routed by status | Rate limiting; DB status check per request |
| Password Recovery | Login → Forgot password | Self-service reset | Reset email; SHA-256 token; 1hr expiry |
| New Client | Dashboard → New Client | Prospect created < 1s | Full AI pipeline in background |
| Failed Re-submission | Dashboard → New Client (same URL) | Onboarding re-triggered | Reset status, re-run pipeline |
| Prospect Detail | `/prospects/:slug` | Enriched profile | 6s polling until complete |
| Admin Management | Dashboard → Affiliates | Approve/suspend/track | Approval email; converted count column |
| Email Touchpoints | System events | Timely notifications | 4 templates; Monday pending digest cron |
| Conversion Tracking | Stripe webhook | `is_paying` flag set | `converted_at` stamped; earnings recalculated |
| Full Lifecycle | Discovery → Revenue | Both sides earn | Entire pipeline automated end-to-end |
