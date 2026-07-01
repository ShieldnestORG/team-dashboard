CREATE TABLE "university_voice_meter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"seconds_used" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "university_voice_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"granted_seconds" integer NOT NULL,
	"actual_seconds" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "university_voice_reservations_status_ck" CHECK ("university_voice_reservations"."status" IN ('open', 'settled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "university_voice_meter_member_period_uq" ON "university_voice_meter" USING btree ("member_id","period_start");--> statement-breakpoint
CREATE INDEX "university_voice_reservations_member_period_idx" ON "university_voice_reservations" USING btree ("member_id","period_start");
