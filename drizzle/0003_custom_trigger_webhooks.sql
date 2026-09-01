CREATE TABLE IF NOT EXISTS "custom_trigger_webhooks" (
  "id" serial PRIMARY KEY NOT NULL,
  "locationId" varchar(128) NOT NULL,
  "companyId" varchar(128),
  "tokenHash" varchar(64) NOT NULL,
  "tokenCiphertext" text NOT NULL,
  "tokenPreview" varchar(32) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "lastReceivedAt" timestamp,
  "lastDeliveryAt" timestamp,
  "lastDeliveryStatus" varchar(32),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "custom_trigger_webhooks_locationId_unique" UNIQUE("locationId"),
  CONSTRAINT "custom_trigger_webhooks_tokenHash_unique" UNIQUE("tokenHash")
);

CREATE INDEX IF NOT EXISTS "custom_trigger_webhooks_location_active_idx"
  ON "custom_trigger_webhooks" ("locationId", "active");

CREATE TABLE IF NOT EXISTS "custom_trigger_bindings" (
  "id" serial PRIMARY KEY NOT NULL,
  "locationId" varchar(128) NOT NULL,
  "companyId" varchar(128),
  "workflowId" varchar(128) NOT NULL,
  "triggerId" varchar(128),
  "triggerKey" varchar(128) NOT NULL,
  "triggerVersion" varchar(64),
  "targetUrl" text,
  "filtersJson" text,
  "active" boolean DEFAULT true NOT NULL,
  "lastEventType" varchar(32),
  "lastEventAt" timestamp,
  "lastDeliveryAt" timestamp,
  "lastDeliveryStatus" varchar(32),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "custom_trigger_bindings_location_workflow_trigger_uidx"
  ON "custom_trigger_bindings" ("locationId", "workflowId", "triggerKey");

CREATE INDEX IF NOT EXISTS "custom_trigger_bindings_location_active_idx"
  ON "custom_trigger_bindings" ("locationId", "active");
