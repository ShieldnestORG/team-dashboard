-- City Business Leads — staging table for local businesses found via topic search.
-- One row per found business per (company, city, topic). Soft-references
-- city_intelligence via city_slug (text, not FK) so leads can be collected
-- for cities not yet in the intelligence table. Leads can be promoted to
-- partner_companies by the admin via the city collector UI.

CREATE TABLE city_business_leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  city_slug       TEXT NOT NULL,
  topic           TEXT NOT NULL,
  name            TEXT NOT NULL,
  website         TEXT,
  phone           TEXT,
  address         TEXT,
  category        TEXT,
  rating          NUMERIC(3,1),
  review_count    INT,
  source          TEXT NOT NULL,
  source_url      TEXT,
  raw_snippet     TEXT,
  lead_status     TEXT NOT NULL DEFAULT 'new',
  partner_id      UUID REFERENCES partner_companies(id) ON DELETE SET NULL,
  found_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actioned_at     TIMESTAMPTZ,
  notes           TEXT
);

CREATE INDEX city_business_leads_company_city_idx
  ON city_business_leads (company_id, city_slug);

CREATE INDEX city_business_leads_topic_idx
  ON city_business_leads (company_id, topic);

CREATE INDEX city_business_leads_status_idx
  ON city_business_leads (lead_status);
