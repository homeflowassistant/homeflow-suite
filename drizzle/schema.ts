import { bigint, pgEnum, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

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
