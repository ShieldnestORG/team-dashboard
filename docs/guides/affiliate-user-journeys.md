# Affiliate System — User Journey Flows

Eight journeys covering the full affiliate lifecycle: registration, login, password recovery, new client submission, prospect management, admin oversight, and email notification touchpoints.

---

## 1. Affiliate Registration

A new person discovers the program and applies.

```mermaid
flowchart TD
    A([Visit affiliates.coherencedaddy.com]) --> B[Landing page\nMarketing copy + benefit cards]
    B --> C[Click 'Create Account' tab]
    C --> D[Fill in: Name, Email, Password]
    D --> E[Submit registration]
    E --> F{Email already\nregistered?}
    F -- Yes --> G[Show error:\n'Email already registered']
    G --> D
    F -- No --> H[Account created\nstatus = pending]
    H --> I[Show success:\n'Application submitted!\nWe'll review and notify you.']
    H --> J[📧 Admin receives email:\nNew affiliate application]
    I --> K([Affiliate waits for approval\nApplied date shown on pending screen])
    J --> L([Admin sees pending count\nin team dashboard Affiliates page])
```

---

## 2. Affiliate Login & Status Routing

Returning affiliate authenticates and is routed by account status.

```mermaid
flowchart TD
    A([Visit affiliates.coherencedaddy.com]) --> B[Enter email + password]
    B --> C[Submit login]
    C --> D{Credentials\nvalid?}
    D -- No --> E[Show error: 'Invalid credentials']
    E --> B
    D -- Yes --> F{Account\nstatus?}
    F -- suspended --> G[403: 'Account suspended'\nNo token issued]
    F -- pending --> H[Token issued → /dashboard]
    H --> I[Holding page:\nApplied date · 'Under review'\nContact email shown]
    F -- active --> J[Token issued → /dashboard]
    J --> K([Full dashboard:\nTwo action buttons + prospect list])
```

---

## 3. Password Recovery

Affiliate who forgot their password self-recovers without admin intervention.

```mermaid
flowchart TD
    A([Affiliate on login page]) --> B[Click 'Forgot password?']
    B --> C[/reset-password page\nEmail input form]
    C --> D[Enter email + submit]
    D --> E[Always shows:\n'Check your email'\nwhether email exists or not]
    E --> F{Email found\nin DB?}
    F -- No --> G[No action — silent]
    F -- Yes --> H[Generate raw token\nStore SHA-256 hash\n1-hour expiry]
    H --> I[📧 Send reset email\nwith link: /reset-password?token=...]
    I --> J[Affiliate clicks link]
    J --> K[/reset-password?token=...\nNew password form]
    K --> L[Enter + confirm password\nmin 8 chars]
    L --> M{Token valid\n& not expired?}
    M -- No --> N[Error: 'Invalid or\nexpired reset link']
    M -- Yes --> O[Password updated\nToken nulled out]
    O --> P[Show: 'Password updated'\nBack to login link]
    P --> Q([Affiliate logs in\nwith new password])
```

---

## 4. New Client Submission

Active affiliate submits a local business — returns in under 1 second, pipeline runs in the background.

```mermaid
flowchart TD
    A([Affiliate on dashboard]) --> B[Click 'New Client' button]
    B --> C[Modal opens:\nURL input field]
    C --> D[Enter client website URL]
    D --> E[Click 'Lock it In']
    E --> F[POST /api/affiliates/prospects\nInstant: parse hostname as name\nInsert row with affiliate_id\nonboardingStatus = 'none']
    F --> G[< 1 second response\nReturn slug]
    G --> H[Redirect to /prospects/:slug]
    H --> I[Prospect detail page\nStatus: 'Queued']

    F --> J[Fire-and-forget:\nrunPartnerOnboarding]

    subgraph BackgroundPipeline["Background Pipeline (async, ~60s)"]
        J --> K[Scrape website via Firecrawl\nStatus → 'Scanning']
        K --> L[AI extraction via Ollama:\nName, industry, services,\nkeywords, brand colors, contact]
        L --> M[Competitor search via Firecrawl]
        M --> N[Summarize top 3 competitors\nvia Ollama]
        N --> O[Update partner_companies\nonboardingStatus → 'complete']
    end

    I --> P[Page polls every 6s]
    P --> Q{Status?}
    Q -- not complete --> R['Updating automatically...'\nanimated indicator]
    R --> P
    Q -- complete --> S[All 4 tabs populated\nCompetitor cards visible]
    Q -- failed --> T[Error state\nAffiliate can re-submit URL]
```

---

## 5. Prospect Detail — Affiliate Perspective

How an affiliate explores and enriches a submitted prospect over time.

```mermaid
flowchart TD
    A([Affiliate opens /prospects/:slug]) --> B[Load prospect data]
    B --> C[Header: name + status badge\n'Updating automatically...' if pending]

    C --> D{Active tab}

    D --> E[Overview]
    D --> F[Competitors]
    D --> G[Notes]
    D --> H[Updates]

    E --> E1[Business name, website link,\nindustry, location,\ndescription, services tags\nOnboarding status description]

    F --> F1{onboardingStatus\n= complete?}
    F1 -- No --> F2['Competitor analysis still\nbeing generated...'\nEmpty state]
    F1 -- Yes --> F3[3 competitor cards:\nName · clickable URL · summary]

    G --> G1['Your Notes' textarea\nRelationship, visit history,\nyour private context]
    G --> G2['Store Notes' textarea\nShared with CD team:\nWhat the owner wants/needs]
    G1 & G2 --> G3[Save Notes button\nShows unsaved indicator]
    G3 --> G4['Saved!' flash confirmation]

    H --> H1[Editable fields:\nName, Location, Website]
    H1 --> H2[Save Changes → PUT /prospects/:slug]
    H2 --> H3[Profile corrected in DB]
    H --> H4[Onboarding status description\nExplains current phase]
```

---

## 6. Admin — Affiliate Management

How the Coherence Daddy team reviews, approves, and manages affiliates.

```mermaid
flowchart TD
    A([Admin logs into team dashboard]) --> B[Navigate to Affiliates\nin sidebar]
    B --> C[AffiliatesAdmin page loads\nTable: name, email, status, commission,\nprospect count, applied date, actions]
    C --> D[Summary stats:\nN total · N pending · N active · N suspended]

    D --> E{Admin action}

    E -- Approve pending --> F[Click 'Approve'\nPUT /api/affiliates/admin/:id/status active]
    F --> G[Optimistic UI: badge → green Active]
    G --> H[📧 Affiliate receives\n'You're approved' email\nLink to dashboard]
    H --> I([Affiliate can now log in\nand submit clients])

    E -- Suspend active --> J[Click 'Suspend'\nPUT /api/affiliates/admin/:id/status suspended]
    J --> K[Badge → red Suspended\nAffiliate blocked on next request]

    E -- Reinstate --> L[Click 'Reinstate'\nstatus → active]

    E -- Review partners --> M[Navigate to Partners page]
    M --> N[Referred partners show\namber 'via Name' badge]
    N --> O[Click partner → PartnerDetail\nOverview shows 'Referred by: Name']
```

---

## 7. Email Notification Touchpoints

All automated emails in the affiliate system.

```mermaid
flowchart LR
    subgraph Affiliate["Affiliate receives"]
        E1[✉ affiliate-approved\n'You're in — welcome'\nLink to dashboard]
        E2[✉ affiliate-reset-password\n'Reset your password'\n1-hour link]
    end

    subgraph Admin["Admin receives"]
        E3[✉ affiliate-application\n'New application from [Name]'\nLink to /affiliates page]
    end

    subgraph Triggers["What triggers each"]
        T1[POST /register] --> E3
        T2[PUT /admin/:id/status → active] --> E1
        T3[POST /forgot-password\nwhen email found] --> E2
    end

    style Affiliate fill:#f0fdf4,stroke:#86efac
    style Admin fill:#eff6ff,stroke:#93c5fd
    style Triggers fill:#fefce8,stroke:#fde047
```

---

## 8. Full Lifecycle Summary

End-to-end from discovery to active affiliate generating real leads.

```mermaid
flowchart TD
    A([Person visits\naffiliate landing page]) --> B[Registers]
    B --> C[Admin gets email notification]
    C --> D[Admin approves in dashboard]
    D --> E[Affiliate gets approval email]
    E --> F[Affiliate logs in → active dashboard]
    F --> G[Affiliate visits local business]
    G --> H[Clicks 'New Client']
    H --> I[Enters business URL\n< 1 second response]
    I --> J[Prospect created with affiliate_id]
    J --> K[Background pipeline runs\n~60 seconds]
    K --> L[Affiliate views full profile:\nbusiness info, competitors, notes]
    L --> M[Affiliate adds notes\nfrom their visit]
    M --> N[CD team sees prospect\nin Partners list with 'via Name' badge]
    N --> O[CD team reaches out\nto sign them up]
    O --> P{Business subscribes?}
    P -- Yes --> Q[Partner status → active\nAffiliate earns commission %\nof monthly_fee]
    P -- No --> R[Prospect stays in pipeline\nAffiliate can follow up]
```

---

## Summary Table

| Journey | Entry Point | Key Outcome | What's Automated |
|---------|-------------|-------------|-----------------|
| Registration | Landing → Create Account | Account pending | Admin notified by email |
| Login | Landing → Log In | Routed by status | Holding page for pending |
| Password Recovery | Login → Forgot password | Self-service reset | Reset email with 1hr token |
| New Client | Dashboard → New Client | Prospect created < 1s | Full AI pipeline in background |
| Prospect Detail | `/prospects/:slug` | Enriched profile | 6s polling until complete |
| Admin Management | Dashboard → Affiliates | Approve/suspend | Approval email to affiliate |
| Email Touchpoints | System events | Timely notifications | 3 templates fully wired |
| Full Lifecycle | Discovery → Commission | Revenue for both sides | Entire pipeline automated |
