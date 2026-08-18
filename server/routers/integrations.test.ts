import { describe, it, expect } from "vitest";
import { INTEGRATION_CV_KEYS, integrationsSchema } from "./integrations";

describe("Integrations Router Schema & Key Mappings", () => {
  it("defines exact GHL custom value keys matching user specification", () => {
    expect(INTEGRATION_CV_KEYS.webhookUrl).toBe("homeflow_webhook");
    expect(INTEGRATION_CV_KEYS.accessToken).toBe("sg_authorization_key_access_token");
  });

  it("validates input schema correctly", () => {
    const valid = integrationsSchema.safeParse({
      locationId: "loc_123",
      webhookUrl: "https://n8n.n8nserver.online/webhook/test",
      accessToken: "secret_api_key_123",
    });
    expect(valid.success).toBe(true);

    const invalid = integrationsSchema.safeParse({
      locationId: "",
      webhookUrl: "",
      accessToken: "",
    });
    expect(invalid.success).toBe(false);
  });
});
