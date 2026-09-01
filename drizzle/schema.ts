import {
  bigint,
  boolean,
  index,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Core user table backing auth flow.
 */
export const userRoleEnum = pgEnum("role", ["user", "admin"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * GHL OAuth Installations table.
 * Stores OAuth tokens for each GHL sub-account (location) that installs the app.
 * One row per locationId — tokens are refreshed automatically before expiry.
 */
export const ghlInstallations = pgTable("ghl_installations", {
  id: serial("id").primaryKey(),
  /** GHL Location ID (sub-account) */
  locationId: varchar("locationId", { length: 128 }).notNull().unique(),
  /** GHL Company ID (agency) */
  companyId: varchar("companyId", { length: 128 }),
  /** OAuth access token */
  accessToken: text("accessToken").notNull(),
  /** OAuth refresh token */
  refreshToken: text("refreshToken").notNull(),
  /** Token expiry timestamp in milliseconds */
  expiresAt: bigint("expiresAt", { mode: "number" }).notNull(),
  /** Granted scopes */
  scopes: text("scopes"),
  /** GHL user ID who installed */
  userId: varchar("userId", { length: 128 }),
  /** DEPRECATED: Workflow ID (no longer used; contacts are tagged instead) */
  workflowId: varchar("workflowId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type GHLInstallation = typeof ghlInstallations.$inferSelect;
export type InsertGHLInstallation = typeof ghlInstallations.$inferInsert;

/**
 * Zapier connections per GHL location.
 * Stores hashed keys for validation and raw keys for user copying.
 */
export const zapierConnections = pgTable("zapier_connections", {
  id: serial("id").primaryKey(),
  locationId: varchar("locationId", { length: 255 }).notNull(),
  connectionKeyHash: varchar("connectionKeyHash", { length: 255 }).notNull().unique(),
  connectionKeyPreview: varchar("connectionKeyPreview", { length: 255 }).notNull(),
  connectionKeyRaw: text("connectionKeyRaw"), // Raw key for copying (stored for user convenience)
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  rotatedAt: timestamp("rotatedAt"),
  revokedAt: timestamp("revokedAt"),
  lastUsedAt: timestamp("lastUsedAt"),
});

export type ZapierConnection = typeof zapierConnections.$inferSelect;
export type InsertZapierConnection = typeof zapierConnections.$inferInsert;

/**
 * One public webhook endpoint per installed GHL location. The raw token is
 * encrypted at rest; lookup uses the HMAC hash so the URL token is never
 * compared or stored as plaintext in the database.
 */
export const customTriggerWebhooks = pgTable(
  "custom_trigger_webhooks",
  {
    id: serial("id").primaryKey(),
    locationId: varchar("locationId", { length: 128 }).notNull().unique(),
    companyId: varchar("companyId", { length: 128 }),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
    tokenCiphertext: text("tokenCiphertext").notNull(),
    tokenPreview: varchar("tokenPreview", { length: 32 }).notNull(),
    active: boolean("active").default(true).notNull(),
    lastReceivedAt: timestamp("lastReceivedAt"),
    lastDeliveryAt: timestamp("lastDeliveryAt"),
    lastDeliveryStatus: varchar("lastDeliveryStatus", { length: 32 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    locationActiveIdx: index("custom_trigger_webhooks_location_active_idx").on(
      table.locationId,
      table.active
    ),
  })
);

export type CustomTriggerWebhook = typeof customTriggerWebhooks.$inferSelect;
export type InsertCustomTriggerWebhook = typeof customTriggerWebhooks.$inferInsert;

/**
 * HighLevel sends one binding event for each workflow that uses the published
 * Marketplace custom trigger. A location can therefore have multiple target
 * URLs while exposing one stable public HomeFlow URL to external senders.
 */
export const customTriggerBindings = pgTable(
  "custom_trigger_bindings",
  {
    id: serial("id").primaryKey(),
    locationId: varchar("locationId", { length: 128 }).notNull(),
    companyId: varchar("companyId", { length: 128 }),
    workflowId: varchar("workflowId", { length: 128 }).notNull(),
    triggerId: varchar("triggerId", { length: 128 }),
    triggerKey: varchar("triggerKey", { length: 128 }).notNull(),
    triggerVersion: varchar("triggerVersion", { length: 64 }),
    targetUrl: text("targetUrl"),
    filtersJson: text("filtersJson"),
    active: boolean("active").default(true).notNull(),
    lastEventType: varchar("lastEventType", { length: 32 }),
    lastEventAt: timestamp("lastEventAt"),
    lastDeliveryAt: timestamp("lastDeliveryAt"),
    lastDeliveryStatus: varchar("lastDeliveryStatus", { length: 32 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => ({
    locationWorkflowTriggerUnique: uniqueIndex(
      "custom_trigger_bindings_location_workflow_trigger_uidx"
    ).on(table.locationId, table.workflowId, table.triggerKey),
    locationActiveIdx: index("custom_trigger_bindings_location_active_idx").on(
      table.locationId,
      table.active
    ),
  })
);

export type CustomTriggerBinding = typeof customTriggerBindings.$inferSelect;
export type InsertCustomTriggerBinding = typeof customTriggerBindings.$inferInsert;
