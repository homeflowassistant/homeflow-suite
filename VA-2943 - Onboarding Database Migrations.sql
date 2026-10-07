-- VA-2943 - HomeFlow onboarding database migrations
-- Run this script once against the HomeFlow PostgreSQL database.

CREATE TABLE IF NOT EXISTS "onboarding_step_states" (
  "id" serial PRIMARY KEY NOT NULL,
  "locationId" varchar(128) NOT NULL,
  "stepId" varchar(128) NOT NULL,
  "state" varchar(16) NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_step_states_location_step_uidx"
  ON "onboarding_step_states" ("locationId", "stepId");

ALTER TABLE "onboarding_step_states"
  ADD COLUMN IF NOT EXISTS "completedCount" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "totalCount" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "missingRequirementsJson" text,
  ADD COLUMN IF NOT EXISTS "lastReason" text,
  ADD COLUMN IF NOT EXISTS "checkedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "completedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "skippedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "reviewed" boolean DEFAULT false NOT NULL;
