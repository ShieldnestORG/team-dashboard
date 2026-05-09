-- 0108_llms_txt_generator.sql
-- llms.txt + agents.json generator service.
--
-- Standalone product surface (entry-point for the GEO-tactics roadmap row
-- "(a) email + portal download"). One row per generation request:
-- crawl a customer-supplied domain's sitemap, summarize each page, emit
-- llms.txt + llms-full.txt + agents.json. Output is fetched via tokenized
-- public URL until the customer portal lands; portal will resolve by
-- account_id once Worker A consolidates auth.
--
-- Pricing: $19 one-time per generation, free with any $49+/mo bundle.
-- Stripe webhook handler creates one llms_txt_jobs row on checkout.
--
-- Worker B (this PR) only ships the data + service + routes layer; the
-- portal "my generations" view is Worker A's surface. account_id is
-- nullable so unauthenticated public-form requests still work.

CREATE TABLE IF NOT EXISTS llms_txt_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID,
  domain TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','crawling','generating','complete','failed')),
  input_sitemap_url TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error TEXT
);

CREATE INDEX IF NOT EXISTS llms_txt_jobs_status_idx ON llms_txt_jobs (status);
CREATE INDEX IF NOT EXISTS llms_txt_jobs_account_idx ON llms_txt_jobs (account_id);
CREATE INDEX IF NOT EXISTS llms_txt_jobs_domain_idx ON llms_txt_jobs (domain);

CREATE TABLE IF NOT EXISTS llms_txt_outputs (
  job_id UUID PRIMARY KEY REFERENCES llms_txt_jobs(id) ON DELETE CASCADE,
  llms_txt TEXT NOT NULL,
  llms_full_txt TEXT,
  agents_json TEXT,
  page_count INTEGER NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE llms_txt_jobs IS
  'Generation requests for the llms.txt + agents.json product. account_id NULL = anonymous public-form request.';
COMMENT ON TABLE llms_txt_outputs IS
  'One row per completed job. Body served via /api/llms-txt/jobs/:id/llms.txt etc.';
