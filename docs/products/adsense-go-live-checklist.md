# AdSense Go-Live Checklist

Triggered when Google emails "Your AdSense account is ready." Keep this
checklist updated whenever slot configs change so the day-of flip is a
five-minute task, not archaeology.

**Status:** Pending approval (submitted 2026-04-22).

---

## Pre-approval hygiene (do NOT do before approval)

- [ ] **Do not** add any new `<AdSenseUnit>` placements — one existing unit
      in the tools footer is enough while in review.
- [ ] **Do not** flip any `AD_SLOT_CONFIG` entries to include `'adsense'`
      yet; reviewers can crawl the live site and flag "ads served before
      approval".
- [ ] **Do not** run Media.net, Ezoic, Propeller, or any other network on
      `*.coherencedaddy.com` until AdSense is approved.

## Approval-day flip (T+0)

- [ ] Confirm the approval email lists the **account** as approved (vs.
      "needs more content").
- [ ] Generate or locate AdSense **slot IDs** for each placement you want
      to enable. One slot ID per `SlotId` in
      `coherencedaddy-landing/lib/ad-slots.ts`.
- [ ] Edit `coherencedaddy-landing/lib/ad-slots.ts`:
      ```ts
      header:       { providers: ['adsense', 'house'], adsenseSlot: '<ID>', ... }
      'in-article-1': { providers: ['adsense', 'house'], adsenseSlot: '<ID>', ... }
      'in-article-2': { providers: ['adsense', 'house'], adsenseSlot: '<ID>', ... }
      sidebar:      { providers: ['adsense', 'house'], adsenseSlot: '<ID>', ... }
      footer:       { providers: ['adsense', 'house'], adsenseSlot: '<ID>', ... }
      ```
      AdSense fills first; house ads serve no-fill impressions.
- [ ] Deploy coherencedaddy-landing to Vercel. Confirm no build errors.
- [ ] Lighthouse run on a tool page and a blog post:
      - CLS stays at 0 (reservation works with AdSense too).
      - No "Ads not in HTTPS" warnings.

## T+1 day

- [ ] AdSense dashboard shows impression counts for every enabled slot.
      If any slot is 0 after 24h, check that `adsenseSlot` ID matches.
- [ ] Spot-check three subdomains (`coherencedaddy.com`,
      `directory.coherencedaddy.com`, `shop.coherencedaddy.com`) — ads
      render and click through cleanly.
- [ ] Check team-dashboard `/house-ads` admin for continued house-ad
      impressions on the no-fill fallback. Ratio of house:adsense
      impressions is your effective fill rate.

## T+7 days

- [ ] Review AdSense policy center: no violations.
- [ ] RPM per slot — kill slots under $0.20 RPM; redirect their
      placements to house ads only.
- [ ] Compare house-ad click-through revenue vs. AdSense RPM. If
      house ads beat AdSense in a slot, reorder providers to
      `['house', 'adsense']` for that slot.

## T+30 days

- [ ] If average site traffic > 10k sessions/month, apply to
      **Mediavine Journey** or **Ezoic** as a second network; they can
      run alongside AdSense but never stacked in the same slot.
- [ ] Review ad density: confirm no page has >3 ads, no two ads are
      adjacent without ≥300 words of content between them.
- [ ] Re-audit exclusion pages: `/privacy`, `/terms`, `/login`,
      404, form-result pages, any post <300 words. Confirm no ads
      serve there.
- [ ] Start affiliate program applications (Amazon Associates, SaaS
      tools in niche) for in-article contextual replacements where
      AdSense RPM is weak.

## Guardrails (ongoing)

- [ ] Never click your own ads — even on dev. The `<AdSlot>` component
      already suppresses house-ad clicks in non-prod, but AdSense
      clicks during dev **can terminate the account**. Use an ad-blocker
      on the dev domain.
- [ ] Every new ad slot must have a `reserveClass` min-height — CLS = 0
      is not optional.
- [ ] Every new placement must be labeled "Advertisement" (already
      handled inside `<AdSlot>`; don't strip the label).
- [ ] Any new external ad network (Media.net, Infolinks, etc.)
      requires a new entry in `SlotProvider` type + `AdSlot` component
      — don't inject scripts outside the slot system.

---

## Related files

- `coherencedaddy-landing/lib/ad-slots.ts` — provider chain config.
- `coherencedaddy-landing/components/AdSlot.tsx` — rendering + fetch chain.
- `coherencedaddy-landing/components/AdSenseUnit.tsx` — AdSense-specific renderer; called by `AdSlot` when provider is `'adsense'`.
- `team-dashboard/server/src/routes/house-ads.ts` — house-ad backend.
- `team-dashboard/ui/src/pages/HouseAdsAdmin.tsx` — admin CRUD.
- `team-dashboard/docs/products/house-ads.md` — authoritative spec.
