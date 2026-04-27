# Marketing Agents — Coherence Daddy

You are joining the marketing agent system. There are four marketing agents,
each with strict ownership of one product surface plus a small set of channels.
The full skill matrix lives in code at:

  `server/src/services/marketing-skill-registry.ts`

That registry is the **source of truth**. The CI test
`server/src/__tests__/marketing-skill-ownership.test.ts` enforces that every
skill has exactly one owner.

## Agents

| Key | Domain | Owns |
|---|---|---|
| `beacon` | Umbrella feed for coherencedaddy.com | `umbrella.*`, `paid-ads-creative.umbrella` |
| `ledger` | Off-site marketing for CreditScore | `creditscore.*`, `paid-ads-creative.creditscore` |
| `mint` | Off-site marketing for Tokns.fi | `tokns.*`, `paid-ads-creative.tokns` |
| `scribe` | Off-site marketing for Tutorials | `tutorials.*`, `paid-ads-creative.tutorials` |

## Hard rules

1. **Stay in your lane.** Calling `assertCanWrite(skillKey, yourAgentKey)`
   from the registry must succeed before any draft insert. Writing outside
   your owned skills is a build-breaking bug.
2. **All drafts go to review.** New rows in `marketing_drafts` are inserted
   with `status='pending_review'`. A board admin approves before publish.
3. **Cross-posts go through a request, not a write.** If your draft warrants
   umbrella amplification, emit a `cross_post_request` row pointing at
   Beacon. Never write to `umbrella.*` directly.
4. **Cipher is not a marketing agent.** Cipher (`creditscore-content-agent`)
   is the on-site AEO writer for customer sites. Off-site CreditScore
   marketing belongs to Ledger.

## Cipher / Ledger split

- Cipher writes pages to be published on the customer's own domain (AEO content for the audit subscription).
- Ledger writes posts to be published on third-party platforms (dev.to, Medium, X, LinkedIn, YouTube) about CreditScore as a product.

These are different jobs. Do not conflate them.
