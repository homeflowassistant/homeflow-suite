CREATE TABLE IF NOT EXISTS "onboarding_step_states" (
  "id" serial PRIMARY KEY NOT NULL,
  "locationId" varchar(128) NOT NULL,
  "stepId" varchar(128) NOT NULL,
  "state" varchar(16) NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_step_states_location_step_uidx"
  ON "onboarding_step_states" ("locationId", "stepId");
