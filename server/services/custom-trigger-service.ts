import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "crypto";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "../db.js";
import { ENV } from "../_core/env.js";
import { ensureGhlCustomValue, getValidAccessToken } from "../ghl-service.js";
import {
  customTriggerBindings,
  customTriggerWebhooks,
  type CustomTriggerBinding,
} from "../../drizzle/schema.js";

const TOKEN_PREFIX = "hfwh_";
const TOKEN_BYTES = 32;
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const ENCRYPTION_KEY_LENGTH = 32;
const TARGET_HOST = "services.leadconnectorhq.com";
const TARGET_PATH_PREFIX = "/workflows-marketplace/triggers/execute/";
const DELIVERY_TIMEOUT_MS = 10_000;
const INTEGRATION_WEBHOOK_CUSTOM_VALUE = "homeflow_webhook";

export type CustomTriggerEventType = "CREATED" | "UPDATED" | "DELETED";

export type CustomTriggerSubscriptionPayload = {
  triggerData?: {
    id?: unknown;
    key?: unknown;
    filters?: unknown;
    eventType?: unknown;
    targetUrl?: unknown;
  };
  meta?: {
    key?: unknown;
    version?: unknown;
  };
  extras?: {
    locationId?: unknown;
    workflowId?: unknown;
    companyId?: unknown;
  };
};

export class CustomTriggerHttpError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "CustomTriggerHttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requireDb() {
  return getDb().then(db => {
    if (!db) {
      throw new CustomTriggerHttpError(
        503,
        "DATABASE_NOT_CONFIGURED",
        "The HomeFlow database is not available."
      );
    }
    return db;
  });
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function encryptionKey(): Buffer {
  const secret = ENV.cookieSecret.trim();
  if (!secret) {
    throw new CustomTriggerHttpError(
      500,
      "WEBHOOK_ENCRYPTION_NOT_CONFIGURED",
      "JWT_SECRET must be configured before webhook URLs can be stored."
    );
  }

  return createHash("sha256")
    .update(`homeflow-custom-trigger:${secret}`)
    .digest()
    .subarray(0, ENCRYPTION_KEY_LENGTH);
}

function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64url"), authTag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decryptToken(encoded: string): string {
  const [ivEncoded, authTagEncoded, ciphertextEncoded] = encoded.split(".");
  if (!ivEncoded || !authTagEncoded || !ciphertextEncoded) {
    throw new CustomTriggerHttpError(500, "WEBHOOK_TOKEN_CORRUPT", "Stored webhook token is invalid.");
  }

  try {
    const decipher = createDecipheriv(
      ENCRYPTION_ALGORITHM,
      encryptionKey(),
      Buffer.from(ivEncoded, "base64url")
    );
    decipher.setAuthTag(Buffer.from(authTagEncoded, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new CustomTriggerHttpError(500, "WEBHOOK_TOKEN_CORRUPT", "Stored webhook token could not be decrypted.");
  }
}

export function generateCustomTriggerToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

export function hashCustomTriggerToken(token: string): string {
  const secret = ENV.cookieSecret.trim();
  if (!secret) {
    throw new CustomTriggerHttpError(
      500,
      "WEBHOOK_HASH_NOT_CONFIGURED",
      "JWT_SECRET must be configured before webhook URLs can be generated."
    );
  }
  return createHmac("sha256", secret).update(`homeflow-custom-trigger:${token}`).digest("hex");
}

function webhookBaseUrl(): string {
  const configured = ENV.customTriggerWebhookBaseUrl.trim().replace(/\/+$/, "");
  if (!configured) {
    throw new CustomTriggerHttpError(
      500,
      "WEBHOOK_BASE_URL_NOT_CONFIGURED",
      "CUSTOM_TRIGGER_WEBHOOK_BASE_URL or APP_DOMAIN must be configured."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new CustomTriggerHttpError(500, "WEBHOOK_BASE_URL_INVALID", "The custom-trigger webhook base URL is invalid.");
  }

  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new CustomTriggerHttpError(500, "WEBHOOK_BASE_URL_INSECURE", "The public custom-trigger webhook base URL must use HTTPS.");
  }

  return configured;
}

export function buildCustomTriggerWebhookUrl(token: string): string {
  return `${webhookBaseUrl()}/webhooks/${encodeURIComponent(token)}`;
}

/**
 * Keep the existing HomeFlow integration-page custom value synchronized with
 * the generated URL. The custom value is expected to be included in the
 * snapshot; the create-or-update helper also repairs locations where the value
 * is missing from the snapshot.
 */
export async function syncIntegrationWebhookCustomValue(
  locationId: string,
  webhookUrl: string
): Promise<void> {
  try {
    const result = await ensureGhlCustomValue(
      locationId,
      INTEGRATION_WEBHOOK_CUSTOM_VALUE,
      webhookUrl
    );
    if (result.id === "create_failed") {
      console.warn("[Custom Trigger] homeflow_webhook custom value could not be created; URL remains available through the backend API", { locationId });
      return;
    }
    console.info("[Custom Trigger] homeflow_webhook custom value synchronized", { locationId });
  } catch (error) {
    // The backend-generated URL remains authoritative. A temporary GHL custom
    // value failure must not prevent the integration page from loading.
    console.error("[Custom Trigger] failed to synchronize homeflow_webhook custom value", {
      locationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function isHighLevelTriggerTargetUrl(value: unknown): value is string {
  const targetUrl = normalizeText(value);
  if (!targetUrl) return false;

  try {
    const parsed = new URL(targetUrl);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === TARGET_HOST &&
      parsed.pathname.startsWith(TARGET_PATH_PREFIX) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

function tokenPreview(token: string): string {
  return `${token.slice(0, 9)}…${token.slice(-6)}`;
}

export async function ensureCustomTriggerWebhook(locationId: string, companyId?: string): Promise<{
  locationId: string;
  companyId: string | null;
  webhookUrl: string;
  tokenPreview: string;
  active: boolean;
  createdAt: Date;
}> {
  const normalizedLocationId = normalizeText(locationId);
  if (!normalizedLocationId) {
    throw new CustomTriggerHttpError(400, "LOCATION_ID_REQUIRED", "locationId is required.");
  }

  const db = await requireDb();
  const existing = await db
    .select()
    .from(customTriggerWebhooks)
    .where(eq(customTriggerWebhooks.locationId, normalizedLocationId))
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    const existingWebhookUrl = buildCustomTriggerWebhookUrl(decryptToken(row.tokenCiphertext));
    await syncIntegrationWebhookCustomValue(normalizedLocationId, existingWebhookUrl);
    if (companyId && row.companyId !== companyId) {
      await db
        .update(customTriggerWebhooks)
        .set({ companyId, updatedAt: new Date() })
        .where(eq(customTriggerWebhooks.id, row.id));
    }
    return {
      locationId: row.locationId,
      companyId: companyId || row.companyId || null,
      webhookUrl: existingWebhookUrl,
      tokenPreview: row.tokenPreview,
      active: row.active,
      createdAt: row.createdAt,
    };
  }

  const token = generateCustomTriggerToken();
  const now = new Date();
  const [created] = await db
    .insert(customTriggerWebhooks)
    .values({
      locationId: normalizedLocationId,
      companyId: companyId || null,
      tokenHash: hashCustomTriggerToken(token),
      tokenCiphertext: encryptToken(token),
      tokenPreview: tokenPreview(token),
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: customTriggerWebhooks.locationId })
    .returning();

  if (created) {
    const createdWebhookUrl = buildCustomTriggerWebhookUrl(token);
    await syncIntegrationWebhookCustomValue(normalizedLocationId, createdWebhookUrl);
    console.info("[Custom Trigger] public webhook generated", { locationId: normalizedLocationId });
    return {
      locationId: created.locationId,
      companyId: created.companyId || null,
      webhookUrl: createdWebhookUrl,
      tokenPreview: created.tokenPreview,
      active: created.active,
      createdAt: created.createdAt,
    };
  }

  // Another request won the race. Return the already-created URL rather than
  // exposing a token that was never persisted.
  const concurrent = await db
    .select()
    .from(customTriggerWebhooks)
    .where(eq(customTriggerWebhooks.locationId, normalizedLocationId))
    .limit(1);
  if (!concurrent.length) {
    throw new CustomTriggerHttpError(500, "WEBHOOK_PROVISIONING_FAILED", "Unable to provision the location webhook URL.");
  }
  const row = concurrent[0];
  const concurrentWebhookUrl = buildCustomTriggerWebhookUrl(decryptToken(row.tokenCiphertext));
  await syncIntegrationWebhookCustomValue(normalizedLocationId, concurrentWebhookUrl);
  return {
    locationId: row.locationId,
    companyId: row.companyId || null,
    webhookUrl: concurrentWebhookUrl,
    tokenPreview: row.tokenPreview,
    active: row.active,
    createdAt: row.createdAt,
  };
}

export async function getCustomTriggerWebhookForLocation(locationId: string) {
  const ensured = await ensureCustomTriggerWebhook(locationId);
  const db = await requireDb();
  const bindings = await db
    .select({
      id: customTriggerBindings.id,
      workflowId: customTriggerBindings.workflowId,
      triggerId: customTriggerBindings.triggerId,
      triggerKey: customTriggerBindings.triggerKey,
      triggerVersion: customTriggerBindings.triggerVersion,
      targetUrl: customTriggerBindings.targetUrl,
      filtersJson: customTriggerBindings.filtersJson,
      active: customTriggerBindings.active,
      lastEventType: customTriggerBindings.lastEventType,
      lastEventAt: customTriggerBindings.lastEventAt,
      lastDeliveryAt: customTriggerBindings.lastDeliveryAt,
      lastDeliveryStatus: customTriggerBindings.lastDeliveryStatus,
      createdAt: customTriggerBindings.createdAt,
      updatedAt: customTriggerBindings.updatedAt,
    })
    .from(customTriggerBindings)
    .where(and(eq(customTriggerBindings.locationId, locationId), eq(customTriggerBindings.active, true)))
    .orderBy(desc(customTriggerBindings.updatedAt));

  return {
    ...ensured,
    status: bindings.length > 0 ? "ready" : "waiting_for_workflow",
    bindingCount: bindings.length,
    bindings,
  } as const;
}

export async function recordCustomTriggerSubscription(
  payload: CustomTriggerSubscriptionPayload
): Promise<{ eventType: CustomTriggerEventType; locationId: string; workflowId: string; targetUrl: string | null }> {
  const triggerData = payload.triggerData || {};
  const extras = payload.extras || {};
  const meta = payload.meta || {};
  const locationId = normalizeText(extras.locationId);
  const workflowId = normalizeText(extras.workflowId);
  const triggerKey = normalizeText(meta.key) || normalizeText(triggerData.key);
  const eventType = normalizeText(triggerData.eventType)?.toUpperCase() as CustomTriggerEventType | undefined;
  const targetUrl = normalizeText(triggerData.targetUrl) || null;

  if (!locationId || !workflowId || !triggerKey) {
    throw new CustomTriggerHttpError(400, "INVALID_SUBSCRIPTION_PAYLOAD", "Subscription payload must include locationId, workflowId, and trigger key.");
  }
  if (!eventType || !["CREATED", "UPDATED", "DELETED"].includes(eventType)) {
    throw new CustomTriggerHttpError(400, "INVALID_SUBSCRIPTION_EVENT", "Subscription eventType must be CREATED, UPDATED, or DELETED.");
  }
  if (eventType !== "DELETED" && !targetUrl) {
    throw new CustomTriggerHttpError(400, "TARGET_URL_REQUIRED", "CREATED and UPDATED subscription events must include targetUrl.");
  }
  if (targetUrl && !isHighLevelTriggerTargetUrl(targetUrl)) {
    throw new CustomTriggerHttpError(400, "INVALID_TARGET_URL", "targetUrl is not a valid HighLevel Marketplace trigger execution URL.");
  }

  const db = await requireDb();
  await ensureCustomTriggerWebhook(locationId, normalizeText(extras.companyId));

  const now = new Date();
  const filters = Array.isArray(triggerData.filters) ? triggerData.filters : [];
  const existing = await db
    .select({ id: customTriggerBindings.id })
    .from(customTriggerBindings)
    .where(
      and(
        eq(customTriggerBindings.locationId, locationId),
        eq(customTriggerBindings.workflowId, workflowId),
        eq(customTriggerBindings.triggerKey, triggerKey)
      )
    )
    .limit(1);

  const values = {
    locationId,
    companyId: normalizeText(extras.companyId) || null,
    workflowId,
    triggerId: normalizeText(triggerData.id) || null,
    triggerKey,
    triggerVersion: normalizeText(meta.version) || null,
    targetUrl,
    filtersJson: JSON.stringify(filters),
    active: eventType !== "DELETED",
    lastEventType: eventType,
    lastEventAt: now,
    updatedAt: now,
  };

  if (existing.length > 0) {
    await db.update(customTriggerBindings).set(values).where(eq(customTriggerBindings.id, existing[0].id));
  } else {
    await db.insert(customTriggerBindings).values({ ...values, createdAt: now });
  }

  console.info("[Custom Trigger] subscription binding updated", {
    eventType,
    locationId,
    workflowId,
    triggerKey,
  });

  return { eventType, locationId, workflowId, targetUrl };
}

async function resolveWebhookToken(rawToken: string) {
  const normalizedToken = normalizeText(rawToken);
  if (!normalizedToken || normalizedToken.length < TOKEN_PREFIX.length + 20) {
    throw new CustomTriggerHttpError(404, "WEBHOOK_NOT_FOUND", "Webhook endpoint not found.");
  }

  const db = await requireDb();
  const rows = await db
    .select()
    .from(customTriggerWebhooks)
    .where(and(eq(customTriggerWebhooks.tokenHash, hashCustomTriggerToken(normalizedToken)), eq(customTriggerWebhooks.active, true)))
    .limit(1);

  if (!rows.length) {
    throw new CustomTriggerHttpError(404, "WEBHOOK_NOT_FOUND", "Webhook endpoint not found.");
  }
  return rows[0];
}

function deliveryHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    Version: "2021-07-28",
    "User-Agent": "HomeFlow-CustomTrigger/1.0",
  };
}

export async function deliverCustomTriggerPayload(rawToken: string, payload: unknown): Promise<{
  locationId: string;
  delivered: number;
  failed: number;
  bindingCount: number;
}> {
  const webhook = await resolveWebhookToken(rawToken);
  const db = await requireDb();
  const bindings = await db
    .select()
    .from(customTriggerBindings)
    .where(
      and(
        eq(customTriggerBindings.locationId, webhook.locationId),
        eq(customTriggerBindings.active, true),
        isNotNull(customTriggerBindings.targetUrl)
      )
    )
    .orderBy(desc(customTriggerBindings.updatedAt));

  const receivedAt = new Date();
  await db
    .update(customTriggerWebhooks)
    .set({ lastReceivedAt: receivedAt, updatedAt: receivedAt })
    .where(eq(customTriggerWebhooks.id, webhook.id));

  if (!bindings.length) {
    throw new CustomTriggerHttpError(409, "NO_ACTIVE_TRIGGER_BINDING", "The webhook URL is valid, but no active HighLevel workflow is currently bound to this custom trigger.");
  }

  let accessToken: string;
  try {
    // HighLevel's generated Marketplace trigger execution URL requires the
    // installed location's OAuth token for server-to-server delivery.
    accessToken = await getValidAccessToken(webhook.locationId);
  } catch {
    throw new CustomTriggerHttpError(
      401,
      "LOCATION_AUTHENTICATION_FAILED",
      "The HighLevel location connection is missing or expired. Reconnect the HomeFlow app before sending webhook payloads."
    );
  }

  const deliveryPayload = payload && typeof payload === "object" ? payload : { data: payload };
  const results = await Promise.all(
    bindings.map(async binding => {
      const targetUrl = binding.targetUrl as string;
      try {
        const response = await fetch(targetUrl, {
          method: "POST",
          headers: deliveryHeaders(accessToken),
          body: JSON.stringify(deliveryPayload),
          signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        });
        const ok = response.ok;
        await db
          .update(customTriggerBindings)
          .set({
            lastDeliveryAt: new Date(),
            lastDeliveryStatus: ok ? "success" : `http_${response.status}`,
            updatedAt: new Date(),
          })
          .where(eq(customTriggerBindings.id, binding.id));
        if (!ok) {
          console.warn("[Custom Trigger] HighLevel target rejected payload", {
            locationId: webhook.locationId,
            workflowId: binding.workflowId,
            status: response.status,
          });
        }
        return ok;
      } catch (error) {
        await db
          .update(customTriggerBindings)
          .set({ lastDeliveryAt: new Date(), lastDeliveryStatus: "error", updatedAt: new Date() })
          .where(eq(customTriggerBindings.id, binding.id));
        console.error("[Custom Trigger] HighLevel target delivery failed", {
          locationId: webhook.locationId,
          workflowId: binding.workflowId,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    })
  );

  const delivered = results.filter(Boolean).length;
  const failed = results.length - delivered;
  await db
    .update(customTriggerWebhooks)
    .set({ lastDeliveryAt: new Date(), lastDeliveryStatus: failed === 0 ? "success" : "partial_failure", updatedAt: new Date() })
    .where(eq(customTriggerWebhooks.id, webhook.id));

  return { locationId: webhook.locationId, delivered, failed, bindingCount: bindings.length };
}

export async function rotateCustomTriggerWebhook(locationId: string) {
  const db = await requireDb();
  const current = await db
    .select()
    .from(customTriggerWebhooks)
    .where(eq(customTriggerWebhooks.locationId, locationId))
    .limit(1);

  if (!current.length) return ensureCustomTriggerWebhook(locationId);

  const token = generateCustomTriggerToken();
  const now = new Date();
  const [updated] = await db
    .update(customTriggerWebhooks)
    .set({
      tokenHash: hashCustomTriggerToken(token),
      tokenCiphertext: encryptToken(token),
      tokenPreview: tokenPreview(token),
      active: true,
      lastReceivedAt: null,
      lastDeliveryAt: null,
      lastDeliveryStatus: null,
      updatedAt: now,
    })
    .where(eq(customTriggerWebhooks.id, current[0].id))
    .returning();

  const rotatedWebhookUrl = buildCustomTriggerWebhookUrl(token);
  await syncIntegrationWebhookCustomValue(locationId, rotatedWebhookUrl);
  console.warn("[Custom Trigger] public webhook rotated", { locationId });
  return {
    locationId: updated.locationId,
    companyId: updated.companyId || null,
    webhookUrl: rotatedWebhookUrl,
    tokenPreview: updated.tokenPreview,
    active: updated.active,
    createdAt: updated.createdAt,
  };
}

export function serializeBinding(binding: CustomTriggerBinding) {
  return {
    ...binding,
    filters: binding.filtersJson ? safeJsonParse(binding.filtersJson) : [],
    filtersJson: undefined,
    createdAt: binding.createdAt.toISOString(),
    updatedAt: binding.updatedAt.toISOString(),
    lastEventAt: binding.lastEventAt?.toISOString() || null,
    lastDeliveryAt: binding.lastDeliveryAt?.toISOString() || null,
  };
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}
