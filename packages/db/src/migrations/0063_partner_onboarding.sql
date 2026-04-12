-- Partner onboarding pipeline + Trusted Companies directory
ALTER TABLE partner_companies ADD COLUMN onboarding_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE partner_companies ADD COLUMN onboarding_error TEXT;
ALTER TABLE partner_companies ADD COLUMN onboarding_completed_at TIMESTAMPTZ;
ALTER TABLE partner_companies ADD COLUMN featured BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE partner_companies ADD COLUMN featured_order INTEGER;
ALTER TABLE partner_companies ADD COLUMN tagline TEXT;
