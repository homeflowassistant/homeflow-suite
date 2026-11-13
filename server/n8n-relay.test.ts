import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./_core/env.js";
import {
  chooseForwardTarget,
  isGhlWorkflowWebhookPayload,
  n8nRelayUrl,
  relayToN8n,
} from "./services/n8n-relay-service.js";

const LOC = "XzzLQ42sqJR43o30CP34";

// Shape of a GHL workflow "Webhook" action: standard data + customData.
const ghlCreateQuote = {
  contact_id: "c1",
  first_name: "Pat",
  location: { id: LOC, name: "HomeFlow Assistant (Development)" },
  workflow: { id: "wf1", name: "New Lead" },
  customData: { action: "create quote", quote_title: "Your Quote" },
};

describe("GHL workflow webhook detection", () => {
  it("routes a GHL workflow webhook for this sub-account to n8n", () => {
    expect(isGhlWorkflowWebhookPayload(ghlCreateQuote, LOC)).toBe(true);
    expect(chooseForwardTarget(ghlCreateQuote, LOC)).toBe("n8n");
  });

  it("keeps n8n / Sweep & Go / Zapier posts on the GHL custom-trigger route", () => {
    expect(chooseForwardTarget({ event: "client_created", data: {} }, LOC)).toBe("ghl");
    expect(chooseForwardTarget({ action: "set quote pricing", locationId: LOC }, LOC)).toBe("ghl");
  });

  it("does not treat another sub-account's workflow payload as its own", () => {
    const other = { ...ghlCreateQuote, location: { id: "OTHER" } };
    expect(chooseForwardTarget(other, LOC)).toBe("ghl");
  });

  it("honours an explicit ?forward override", () => {
    expect(chooseForwardTarget({ any: 1 }, LOC, "n8n")).toBe("n8n");
    expect(chooseForwardTarget(ghlCreateQuote, LOC, ["GHL"])).toBe("ghl");
    expect(chooseForwardTarget(ghlCreateQuote, LOC, "nonsense")).toBe("n8n");
  });
});

describe("relayToN8n", () => {
  const TEST_URL = "https://n8n.example.test/webhook/quote-router";
  const original = ENV.ghlWorkflowN8nWebhookUrl;
  afterEach(() => {
    ENV.ghlWorkflowN8nWebhookUrl = original;
  });

  it("posts the payload with the sub-account's locationId to the n8n webhook", async () => {
    ENV.ghlWorkflowN8nWebhookUrl = TEST_URL;
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const result = await relayToN8n(LOC, "co1", ghlCreateQuote, fetchMock as never);

    expect(result).toEqual({ ok: true, status: 200, locationId: LOC });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(n8nRelayUrl());
    expect(url).toBe(TEST_URL);
    expect((init.headers as Record<string, string>)["x-location-id"]).toBe(LOC);
    const sent = JSON.parse(init.body as string);
    expect(sent.customData.action).toBe("create quote");
    expect(sent.locationId).toBe(LOC);
    expect(sent.homeflow).toMatchObject({ locationId: LOC, companyId: "co1" });
  });

  it("does not call anything when the n8n URL is not configured", async () => {
    ENV.ghlWorkflowN8nWebhookUrl = "";
    const fetchMock = vi.fn();
    const result = await relayToN8n(LOC, null, ghlCreateQuote, fetchMock as never);
    expect(result).toEqual({ ok: false, status: 0, locationId: LOC });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports failure when n8n rejects or is unreachable", async () => {
    ENV.ghlWorkflowN8nWebhookUrl = TEST_URL;
    const rejected = await relayToN8n(LOC, null, {}, (async () =>
      new Response("no", { status: 404 })) as never);
    expect(rejected).toEqual({ ok: false, status: 404, locationId: LOC, reply: "no" });

    const down = await relayToN8n(LOC, null, {}, (async () => {
      throw new Error("ECONNREFUSED");
    }) as never);
    expect(down).toEqual({ ok: false, status: 0, locationId: LOC });
  });
});

describe("redactSecrets", () => {
  it("masks secret-looking keys at any depth and keeps everything else", async () => {
    const { redactSecrets } = await import("./services/n8n-relay-service.js");
    const out = redactSecrets({
      email: "a@b.c",
      customData: { sg_authorization_key: "abcdef", quote_title: "Hi" },
      headers: { Authorization: "Bearer x" },
    }) as any;
    expect(out.email).toBe("a@b.c");
    expect(out.customData.quote_title).toBe("Hi");
    expect(out.customData.sg_authorization_key).toBe("[redacted 6 chars]");
    expect(out.headers.Authorization).toBe("[redacted 8 chars]");
  });
});
