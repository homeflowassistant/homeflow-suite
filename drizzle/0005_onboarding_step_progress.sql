ALTER TABLE "onboarding_step_states"
  ADD COLUMN IF NOT EXISTS "completedCount" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "totalCount" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "missingRequirementsJson" text,
  ADD COLUMN IF NOT EXISTS "lastReason" text,
  ADD COLUMN IF NOT EXISTS "checkedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "completedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "skippedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "reviewed" boolean DEFAULT false NOT NULL;
