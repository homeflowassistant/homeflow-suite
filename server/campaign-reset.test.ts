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
    expect(result).toMatchObject({ wasActive: false, wasFinished: true, removedFromWorkflows: [] });
    expect(calls.some(c => c.url.includes("/workflow/"))).toBe(false);
    expect(deps.removeTag).toHaveBeenCalledWith(LOC, CONTACT, "new lead finished");
    const put = calls.find(c => c.method === "PUT");
    expect(put?.body.customFields).toEqual([
      { id: "field-quote_slug", field_value: "null" },
      { id: "field-subtotal", field_value: "null" },
      { id: "field-total cost", field_value: "null" },
    ]);
  });

  it("40.2: a contact still in Follow-Up is removed from its workflows, then the tag is cleared", async () => {
    const { calls, deps } = fakeGhl(["new lead (via homeflow)"]);
    const result = await resetContactForCampaign(LOC, CONTACT, "New Lead (via HomeFlow)", deps);
    expect(result?.wasActive).toBe(true);
    expect(result?.removedFromWorkflows).toHaveLength(4);
    const removedIds = calls.filter(c => c.method === "DELETE").map(c => c.url.split("/workflow/")[1]);
    expect(removedIds).toEqual(["wf-router", "wf-lite", "wf-sg", "wf-custom"]);
    expect(deps.removeTag).toHaveBeenCalledWith(LOC, CONTACT, "new lead (via homeflow)");
  });

  it("reports campaign workflows that this sub-account does not have", async () => {
    const { deps } = fakeGhl(["homeflow: inactive customer"]);
    const result = await resetContactForCampaign(LOC, CONTACT, "homeflow: inactive customer", deps);
    expect(result?.removedFromWorkflows).toEqual(["1. HomeFlow: Reactivation Router"]);
    expect(result?.workflowsNotFound).toEqual([
      "HomeFlow: Reactivation Campaigns (Lite)",
      "HomeFlow: Reactivation Custom-Link Drip Campaign",
    ]);
  });

  it("Add-On and Quick Send do not touch the quote fields", async () => {
    const { calls, deps } = fakeGhl(["add-on-campaign"]);
    await resetContactForCampaign(LOC, CONTACT, "add-on-campaign", deps);
    expect(calls.some(c => c.method === "PUT")).toBe(false);
    expect(calls.filter(c => c.method === "DELETE").map(c => c.url)).toEqual([
      expect.stringContaining("/workflow/wf-addon"),
    ]);
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
