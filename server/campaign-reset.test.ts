import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearWorkflowCache,
  getCampaignForTag,
  normalizeWorkflowName,
  resetContactForCampaign,
} from "./services/campaign-reset-service.js";

const LOC = "loc1";
const CONTACT = "c1";

const WORKFLOWS = [
  { id: "wf-router", name: "1. HomeFlow: Follow-Up Router" },
  { id: "wf-lite", name: "HomeFlow: Follow-Up Lite Drip Campaign" },
  { id: "wf-sg", name: "HomeFlow: Follow-Up S&G-Link Drip Campaign" },
  { id: "wf-custom", name: "HomeFlow: Follow-Up Custom-Link Drip Campaign" },
  { id: "wf-react", name: "1. HomeFlow: Reactivation Router" },
  { id: "wf-addon", name: "Add-On Services Drip" },
];

function fakeGhl(tags: string[]) {
  const calls: Array<{ method: string; url: string; body?: any }> = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "GET" && url.endsWith(`/contacts/${CONTACT}`)) {
      return new Response(JSON.stringify({ contact: { id: CONTACT, tags } }), { status: 200 });
    }
    if (method === "GET" && url.includes("/workflows/")) {
      return new Response(JSON.stringify({ workflows: WORKFLOWS }), { status: 200 });
    }
    if (method === "DELETE" && url.includes("/workflow/")) {
      return new Response("{}", { status: 200 });
    }
    if (method === "PUT") return new Response("{}", { status: 200 });
    return new Response("not mocked", { status: 500 });
  });
  const deps = {
    getAccessToken: vi.fn(async () => "token"),
    removeTag: vi.fn(async () => ({ success: true })),
    getCustomFieldId: vi.fn(async (_loc: string, name: string) => `field-${name}`),
    fetchImpl: fetchImpl as unknown as typeof fetch,
  };
  return { calls, deps };
}

beforeEach(() => clearWorkflowCache());

describe("campaign reset before re-adding a contact", () => {
  it("does nothing extra for a new contact", async () => {
    const { calls, deps } = fakeGhl(["royal_review_personalizer"]);
    const result = await resetContactForCampaign(LOC, CONTACT, "new lead (via homeflow)", deps);
    expect(result).toMatchObject({ wasActive: false, wasFinished: false });
    expect(calls.map(c => c.method)).toEqual(["GET"]);
    expect(deps.removeTag).not.toHaveBeenCalled();
  });

  it("40.1: a contact that already finished gets its tags and quote fields reset", async () => {
    const { calls, deps } = fakeGhl(["new lead finished"]);
    const result = await resetContactForCampaign(LOC, CONTACT, "new lead (via homeflow)", deps);
    expect(result).toMatchObject({ skipped: false, wasActive: false, wasFinished: true, removedFromWorkflows: [] });
    expect(calls.some(c => c.url.includes("/workflow/"))).toBe(false);
    expect(deps.removeTag).toHaveBeenCalledWith(LOC, CONTACT, "new lead finished");
    const put = calls.find(c => c.method === "PUT");
    expect(put?.body.customFields).toEqual([
      { id: "field-quote_slug", field_value: "null" },
      { id: "field-subtotal", field_value: "null" },
      { id: "field-total cost", field_value: "null" },
    ]);
  });

  it("40.2: a contact still in Follow-Up is skipped, so it never gets the opening messages twice", async () => {
    const { calls, deps } = fakeGhl(["new lead (via homeflow)"]);
    const result = await resetContactForCampaign(LOC, CONTACT, "New Lead (via HomeFlow)", deps);
    expect(result).toMatchObject({ skipped: true, wasActive: true, removedFromWorkflows: [] });
    expect(calls.map(c => c.method)).toEqual(["GET"]);
    expect(deps.removeTag).not.toHaveBeenCalled();
  });

  it("Reactivation and Add-On also skip contacts still in the sequence", async () => {
    for (const tag of ["homeflow: inactive customer", "add-on-campaign"]) {
      const { calls, deps } = fakeGhl([tag]);
      const result = await resetContactForCampaign(LOC, CONTACT, tag, deps);
      expect(result?.skipped).toBe(true);
      expect(calls.some(c => c.method === "DELETE" || c.method === "PUT")).toBe(false);
    }
  });

  it("a contact with both tags counts as still in the sequence", async () => {
    const { deps } = fakeGhl(["new lead (via homeflow)", "new lead finished"]);
    expect((await resetContactForCampaign(LOC, CONTACT, "new lead (via homeflow)", deps))?.skipped).toBe(true);
  });

  it("Quick Send restarts a contact still in the queue instead of skipping it", async () => {
    const { calls, deps } = fakeGhl(["quick-send"]);
    const result = await resetContactForCampaign(LOC, CONTACT, "quick-send", deps);
    expect(result).toMatchObject({ skipped: false, wasActive: true });
    expect(calls.some(c => c.method === "PUT")).toBe(false);
    expect(deps.removeTag).toHaveBeenCalledWith(LOC, CONTACT, "quick-send");
  });

  it("Add-On after it finished is reset without touching the quote fields", async () => {
    const { calls, deps } = fakeGhl(["add-on-campaign finished"]);
    const result = await resetContactForCampaign(LOC, CONTACT, "add-on-campaign", deps);
    expect(result).toMatchObject({ skipped: false, wasFinished: true });
    expect(calls.some(c => c.method === "PUT")).toBe(false);
    expect(deps.removeTag).toHaveBeenCalledWith(LOC, CONTACT, "add-on-campaign finished");
  });

  it("never throws, so the tag is still added when GHL is unreachable", async () => {
    const deps = {
      getAccessToken: vi.fn(async () => "token"),
      removeTag: vi.fn(),
      getCustomFieldId: vi.fn(),
      fetchImpl: (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch,
    };
    await expect(resetContactForCampaign(LOC, CONTACT, "add-on-campaign", deps)).resolves.toMatchObject({ wasActive: false });
  });

  it("ignores tags that are not campaigns", async () => {
    const { deps } = fakeGhl([]);
    expect(await resetContactForCampaign(LOC, CONTACT, "staff", deps)).toBeNull();
    expect(getCampaignForTag("quick-send")?.workflowNames).toEqual(["Mass SMS Notification to List"]);
    expect(normalizeWorkflowName("HomeFlow: Follow-Up S&G-Link Drip Campaign")).toBe("homeflowfollowupsglinkdripcampaign");
  });
});
