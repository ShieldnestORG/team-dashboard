ALTER TABLE "partner_companies" ADD COLUMN "is_paying" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "partner_companies" ADD COLUMN "converted_at" TIMESTAMPTZ;
