import { ENV } from "../_core/env.js";

/**
 * GHL workflow "Webhook" actions post to {{custom_values.homeflow_webhook}},
 * which is the sub-account's unique /webhooks/<token> URL. Those payloads are
 * relayed to the shared n8n workflow with the sub-account's locationId added,
 * so n8n never needs a per-account URL and the n8n address stays private.
 */

const RELAY_TIMEOUT_MS = 15_000;

export type ForwardTarget = "n8n" | "ghl";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * The n8n webhook has no authentication of its own, so its URL is a secret:
 * it is read only from GHL_WORKFLOW_N8N_WEBHOOK_URL and never committed.
 */
export function n8nRelayUrl(): string {
  return ENV.ghlWorkflowN8nWebhookUrl.trim();
}

/**
 * A GHL workflow Webhook action always sends its "standard data", which
 * includes `workflow.id` and `location.id`. Requiring the location to match
 * the URL's own sub-account keeps n8n / Sweep & Go / Zapier posts (which
 * start GHL custom-trigger workflows) on their existing route, and stops a
 * GHL workflow from looping back into GHL workflows.
 */
export function isGhlWorkflowWebhookPayload(
  body: unknown,
  locationId: string
): boolean {
  if (!isRecord(body)) return false;
  const workflow = isRecord(body.workflow) ? body.workflow : undefined;
  const location = isRecord(body.location) ? body.location : undefined;
  return Boolean(
    text(workflow?.id) && text(location?.id) === locationId
  );
}

/** `?forward=n8n|ghl` forces a route; otherwise the payload decides. */
export function chooseForwardTarget(
  body: unknown,
  locationId: string,
  override?: unknown
): ForwardTarget {
  const forced = text(Array.isArray(override) ? override[0] : override)?.toLowerCase();
  if (forced === "n8n" || forced === "ghl") return forced;
  return isGhlWorkflowWebhookPayload(body, locationId) ? "n8n" : "ghl";
}

export type N8nRelayResult = {
  ok: boolean;
  status: number;
  locationId: string;
};

export async function relayToN8n(
  locationId: string,
  companyId: string | null,
  body: unknown,
  fetchImpl: typeof fetch = fetch
): Promise<N8nRelayResult> {
  const payload: JsonRecord = isRecord(body) ? { ...body } : { data: body };
  payload.homeflow = {
    locationId,
    companyId,
    source: "ghl_workflow_webhook",
    receivedAt: new Date().toISOString(),
  };
  // Top-level copy so n8n expressions can use {{$json.body.locationId}}.
  if (payload.locationId === undefined) payload.locationId = locationId;

  const url = n8nRelayUrl();
  if (!url) {
    console.error(
      "[n8n relay] GHL_WORKFLOW_N8N_WEBHOOK_URL is not set; payload not forwarded",
      { locationId }
    );
    return { ok: false, status: 0, locationId };
  }

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-location-id": locationId,
        "User-Agent": "HomeFlow-N8nRelay/1.0",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error("[n8n relay] n8n rejected the payload", {
        locationId,
        status: response.status,
      });
    } else {
      console.info("[n8n relay] payload forwarded", {
        locationId,
        status: response.status,
      });
    }
    return { ok: response.ok, status: response.status, locationId };
  } catch (error) {
    console.error("[n8n relay] n8n request failed", {
      locationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, status: 0, locationId };
  }
}
