CREATE TABLE IF NOT EXISTS "zapier_connections" (
  "id" serial PRIMARY KEY NOT NULL,
  "locationId" varchar(255) NOT NULL,
  "connectionKeyHash" varchar(255) NOT NULL,
  "connectionKeyPreview" varchar(255) NOT NULL,
  "connectionKeyRaw" text,
  "active" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "rotatedAt" timestamp,
  "revokedAt" timestamp,
  "lastUsedAt" timestamp,
  CONSTRAINT "zapier_connections_connectionKeyHash_unique" UNIQUE("connectionKeyHash")
);

CREATE INDEX IF NOT EXISTS "zapier_connections_location_active_idx"
  ON "zapier_connections" ("locationId", "active");
