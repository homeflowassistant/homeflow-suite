import { beforeAll, describe, expect, it } from "vitest";

type ServiceModule = typeof import("./custom-trigger-service.js");
let service: ServiceModule;

beforeAll(async () => {
  process.env.JWT_SECRET = "custom-trigger-test-secret";
  service = await import("./custom-trigger-service.js");
});

describe("Custom trigger webhook primitives", () => {
  it("generates high-entropy, prefixed tokens", () => {
    const first = service.generateCustomTriggerToken();
    const second = service.generateCustomTriggerToken();

    expect(first).toMatch(/^hfwh_[A-Za-z0-9_-]{40,}$/);
    expect(second).toMatch(/^hfwh_[A-Za-z0-9_-]{40,}$/);
    expect(second).not.toBe(first);
    expect(service.hashCustomTriggerToken(first)).toHaveLength(64);
    expect(service.hashCustomTriggerToken(first)).not.toBe(first);
  });

  it("builds a public URL without exposing the location id", () => {
    const url = service.buildCustomTriggerWebhookUrl("hfwh_test-token");

    expect(url).toMatch(/\/webhooks\/hfwh_test-token$/);
    expect(url).not.toContain("locationId");
  });

  it("accepts only HTTPS HighLevel trigger execution URLs", () => {
    expect(
      service.isHighLevelTriggerTargetUrl(
        "https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/app/trigger"
      )
    ).toBe(true);
    expect(service.isHighLevelTriggerTargetUrl("https://example.com/webhooks/target")).toBe(false);
    expect(
      service.isHighLevelTriggerTargetUrl(
        "https://services.leadconnectorhq.com/contacts/search"
      )
    ).toBe(false);
    expect(
      service.isHighLevelTriggerTargetUrl(
        "http://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/app/trigger"
      )
    ).toBe(false);
  });
});
