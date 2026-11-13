/**
 * Lets a contact be added to a campaign again (client items 39 and 40).
 *
 * GHL workflows start on "tag added", and a tag that is already on the contact
 * cannot be added again. Before the app adds a campaign tag, this resets the
 * contact for that campaign:
 *   1. still in the campaign (has the active tag) → remove it from the
 *      campaign's workflows, so it restarts instead of running twice;
 *   2. remove the active and finished tags;
 *   3. reset the quote fields the Custom-Link drips wait on, so they wait
 *      for the new quote instead of passing on the old one.
 * The caller then adds the active tag, which starts the campaign again.
 */

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";
const WORKFLOW_CACHE_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;

/** The Custom-Link drips treat the text "null" as "not filled in yet". */
const EMPTY_QUOTE_VALUE = "null";
const QUOTE_FIELDS = ["quote_slug", "subtotal", "total cost"];

export type CampaignDefinition = {
  activeTag: string;
  finishedTag?: string;
  /** Workflow names as created by the HomeFlow snapshot. */
  workflowNames: string[];
  resetQuoteFields: boolean;
};

export const CAMPAIGNS: Record<string, CampaignDefinition> = {
  "new lead (via homeflow)": {
    activeTag: "new lead (via homeflow)",
    finishedTag: "new lead finished",
    workflowNames: [
      "1. HomeFlow: Follow-Up Router",
      "HomeFlow: Follow-Up Lite Drip Campaign",
      "HomeFlow: Follow-Up S&G-Link Drip Campaign",
      "HomeFlow: Follow-Up Custom-Link Drip Campaign",
    ],
    resetQuoteFields: true,
  },
  "homeflow: inactive customer": {
    activeTag: "homeflow: inactive customer",
    finishedTag: "homeflow: inactive customer finished",
    workflowNames: [
      "1. HomeFlow: Reactivation Router",
      "HomeFlow: Reactivation Campaigns (Lite)",
      "HomeFlow: Reactivation Custom-Link Drip Campaign",
    ],
    resetQuoteFields: true,
  },
  "add-on-campaign": {
    activeTag: "add-on-campaign",
    finishedTag: "add-on-campaign finished",
    workflowNames: ["Add-On Services Drip"],
    resetQuoteFields: false,
  },
  "quick-send": {
    activeTag: "quick-send",
    workflowNames: ["Mass SMS Notification to List"],
    resetQuoteFields: false,
  },
};

export function getCampaignForTag(tag: string | undefined): CampaignDefinition | undefined {
  if (!tag) return undefined;
  return CAMPAIGNS[tag.trim().toLowerCase()];
}

/** Workflow names are matched loosely: case, spacing and punctuation are ignored. */
export function normalizeWorkflowName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export type CampaignResetDeps = {
  getAccessToken: (locationId: string) => Promise<string>;
  removeTag: (locationId: string, contactId: string, tag: string) => Promise<unknown>;
  getCustomFieldId: (locationId: string, fieldName: string) => Promise<string | null>;
  fetchImpl?: typeof fetch;
};

export type CampaignResetResult = {
  wasActive: boolean;
  wasFinished: boolean;
  removedFromWorkflows: string[];
  workflowsNotFound: string[];
  quoteFieldsReset: boolean;
};

type WorkflowSummary = { id: string; name: string };
const workflowCache = new Map<string, { at: number; workflows: WorkflowSummary[] }>();

export function clearWorkflowCache(): void {
  workflowCache.clear();
}

async function ghlFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit
): Promise<Response> {
  let response: Response | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    response = await fetchImpl(url, init);
    if (response.status !== 429 || attempt === MAX_ATTEMPTS) return response;
    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 10_000)
      : 1000 * attempt;
    await response.text().catch(() => "");
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  return response as Response;
}

function headers(accessToken: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    Version: GHL_API_VERSION,
  };
}

async function getContactTags(
  fetchImpl: typeof fetch,
  accessToken: string,
  contactId: string
): Promise<string[]> {
  const response = await ghlFetch(
    fetchImpl,
    `${GHL_BASE_URL}/contacts/${encodeURIComponent(contactId)}`,
    { method: "GET", headers: headers(accessToken) }
  );
  if (!response.ok) {
    throw new Error(`GET contact failed: ${response.status}`);
  }
  const data = (await response.json()) as Record<string, any>;
  const contact = data.contact ?? data;
  return Array.isArray(contact.tags)
    ? contact.tags.map((t: unknown) => String(typeof t === "string" ? t : (t as any)?.name ?? "").trim().toLowerCase())
    : [];
}

async function listWorkflows(
  fetchImpl: typeof fetch,
  accessToken: string,
  locationId: string
): Promise<WorkflowSummary[]> {
  const cached = workflowCache.get(locationId);
  if (cached && Date.now() - cached.at < WORKFLOW_CACHE_MS) return cached.workflows;

  const response = await ghlFetch(
    fetchImpl,
    `${GHL_BASE_URL}/workflows/?locationId=${encodeURIComponent(locationId)}`,
    { method: "GET", headers: headers(accessToken) }
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const hint = response.status === 401 || response.status === 403
      ? " (the app needs the workflows.readonly scope)"
      : "";
    throw new Error(`List workflows failed: ${response.status}${hint} ${body.slice(0, 200)}`);
  }
  const data = (await response.json()) as Record<string, any>;
  const workflows: WorkflowSummary[] = (Array.isArray(data.workflows) ? data.workflows : [])
    .filter((w: any) => w?.id && w?.name)
    .map((w: any) => ({ id: String(w.id), name: String(w.name) }));
  workflowCache.set(locationId, { at: Date.now(), workflows });
  return workflows;
}

async function removeFromCampaignWorkflows(
  fetchImpl: typeof fetch,
  accessToken: string,
  locationId: string,
  contactId: string,
  campaign: CampaignDefinition
): Promise<{ removed: string[]; notFound: string[] }> {
  const workflows = await listWorkflows(fetchImpl, accessToken, locationId);
  const byName = new Map(workflows.map(w => [normalizeWorkflowName(w.name), w]));
  const removed: string[] = [];
  const notFound: string[] = [];

  for (const name of campaign.workflowNames) {
    const workflow = byName.get(normalizeWorkflowName(name));
    if (!workflow) {
      notFound.push(name);
      continue;
    }
    const response = await ghlFetch(
      fetchImpl,
      `${GHL_BASE_URL}/contacts/${encodeURIComponent(contactId)}/workflow/${encodeURIComponent(workflow.id)}`,
      { method: "DELETE", headers: headers(accessToken) }
    );
    // A contact that is not in this workflow is fine; nothing to remove.
    if (response.ok) removed.push(workflow.name);
    else await response.text().catch(() => "");
  }
  return { removed, notFound };
}

async function resetQuoteFields(
  fetchImpl: typeof fetch,
  accessToken: string,
  locationId: string,
  contactId: string,
  deps: CampaignResetDeps
): Promise<boolean> {
  const fields: Array<{ id: string; field_value: string }> = [];
  for (const name of QUOTE_FIELDS) {
    const id = await deps.getCustomFieldId(locationId, name);
    if (id) fields.push({ id, field_value: EMPTY_QUOTE_VALUE });
  }
  if (!fields.length) return false;
  const response = await ghlFetch(
    fetchImpl,
    `${GHL_BASE_URL}/contacts/${encodeURIComponent(contactId)}`,
    { method: "PUT", headers: headers(accessToken), body: JSON.stringify({ customFields: fields }) }
  );
  if (!response.ok) {
    await response.text().catch(() => "");
    return false;
  }
  return true;
}

/**
 * Prepare a contact so that adding `activeTag` starts the campaign again.
 * Never throws: a failed step is logged, and the caller still adds the tag.
 */
export async function resetContactForCampaign(
  locationId: string,
  contactId: string,
  activeTag: string,
  deps: CampaignResetDeps
): Promise<CampaignResetResult | null> {
  const campaign = getCampaignForTag(activeTag);
  if (!campaign) return null;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const result: CampaignResetResult = {
    wasActive: false,
    wasFinished: false,
    removedFromWorkflows: [],
    workflowsNotFound: [],
    quoteFieldsReset: false,
  };

  try {
    const accessToken = await deps.getAccessToken(locationId);
    const tags = await getContactTags(fetchImpl, accessToken, contactId);
    result.wasActive = tags.includes(campaign.activeTag);
    result.wasFinished = !!campaign.finishedTag && tags.includes(campaign.finishedTag);

    // A new contact, or one that was never in this campaign: nothing to reset.
    if (!result.wasActive && !result.wasFinished) return result;

    if (result.wasActive) {
      try {
        const { removed, notFound } = await removeFromCampaignWorkflows(
          fetchImpl, accessToken, locationId, contactId, campaign
        );
        result.removedFromWorkflows = removed;
        result.workflowsNotFound = notFound;
      } catch (error) {
        console.warn("[Campaign reset] could not remove contact from workflows", {
          locationId, contactId, campaign: campaign.activeTag,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (campaign.resetQuoteFields) {
      result.quoteFieldsReset = await resetQuoteFields(fetchImpl, accessToken, locationId, contactId, deps);
    }

    for (const tag of [campaign.activeTag, campaign.finishedTag]) {
      if (!tag || !tags.includes(tag)) continue;
      try {
        await deps.removeTag(locationId, contactId, tag);
      } catch (error) {
        console.warn("[Campaign reset] could not remove tag", {
          locationId, contactId, tag,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    console.info("[Campaign reset] contact reset for campaign", {
      locationId, contactId, campaign: campaign.activeTag, ...result,
    });
  } catch (error) {
    console.warn("[Campaign reset] reset skipped", {
      locationId, contactId, campaign: campaign.activeTag,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return result;
}
