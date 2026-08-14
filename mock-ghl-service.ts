// Mock replacement for server/ghl-service used by the LOCAL test server.
// Keeps the same exported names the n8n routes depend on, but never
// touches the database or GoHighLevel — everything returns deterministic
// fake data. The S&G worker and Sweep & Go API calls are mocked by
// patching globalThis.fetch below.

export const GHL_BASE_URL = "https://services.leadconnectorhq.com";

const originalFetch = globalThis.fetch;
(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = String(
    typeof input === "string" ? input : ((input as Request).url ?? "")
  );

  // Mock the S&G encryption worker (same host as prod worker)
  if (url.includes("workers.dev") && url.includes("homeflowassistant")) {
    const body = JSON.parse(init?.body ?? "{}");
    return new Response(
      JSON.stringify({
        encrypted_key:
          "mock-encrypted-" + String(body.api_key ?? "key").slice(0, 6),
        iv: "000000000000000000000000",
        tag: "11111111111111111111111111111111",
        ciphertext: "222222222222",
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  // Mock the GoHighLevel API (used by search_contact_by_email)
  if (url.includes("services.leadconnectorhq.com")) {
    if (url.includes("/contacts/search")) {
      const body = JSON.parse(init?.body ?? "{}");
      const email = body?.filters?.[0]?.value ?? "";
      if (email === "test@example.com") {
        return new Response(
          JSON.stringify({
            contacts: [{ id: "CONTACT_MOCK_1", email, name: "Mock Contact" }],
            meta: { pageLimit: 100, currentPage: 1, totalPages: 1, total: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          contacts: [],
          meta: { pageLimit: 100, currentPage: 1, totalPages: 0, total: 0 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  // Mock the Sweep & Go client search API
  if (url.includes("sweepandgo.com")) {
    const body = JSON.parse(init?.body ?? "{}");
    if (body.email === "unknown@example.com") {
      return new Response("Not Found", { status: 404 });
    }
    return new Response(
      JSON.stringify({
        clients: [
          {
            id: 42,
            email: body.email,
            first_name: "Mock",
            last_name: "Client",
          },
        ],
        client: { id: 42, email: body.email, name: "Mock S&G Client" },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  return originalFetch(input, init);
};

export async function getInstallation(locationId: string) {
  if (locationId === "LOC_INSTALLED") {
    return {
      locationId,
      expiresAt: Date.now() + 3600_000,
      accessToken: "mock-token",
    };
  }
  return null;
}

export async function getValidAccessToken(_locationId: string) {
  return "mock-access-token";
}

export async function fetchAllCustomValues(
  _locationId: string,
  _token: string
) {
  return [
    { name: "sg_authorization_key_access_token", value: "mock-sg-key-123" },
    { name: "ai_agent_initial_message", value: "existing-value" },
  ];
}

export async function getLocationCustomValueMap(
  locationId: string,
  token: string
) {
  const values = await fetchAllCustomValues(locationId, token);
  return values.reduce<Record<string, string>>((acc, v) => {
    acc[String(v.name)] = String(v.value ?? "");
    return acc;
  }, {});
}

export async function updateExistingCustomValuesOnly(
  _locationId: string,
  _updates: Record<string, string>
) {
  return undefined;
}

export async function upsertGhlCustomValue(
  _locationId: string,
  name: string,
  value: string
) {
  return { id: "new-id", name, value };
}

export async function findCustomValueId(
  _locationId: string,
  _token: string,
  _name: string
) {
  return "custom-value-id-1";
}

export async function getCustomFieldIdByName(
  _locationId: string,
  _token: string,
  _name: string
) {
  return "custom-field-id-1";
}

export async function processContact(_locationId: string, _contact: any) {
  return { success: true, contact_id: "CONTACT_MOCK_1" };
}

export async function addTagToContact(
  _locationId: string,
  _contactId: string,
  _tagName: string
) {
  return { success: true };
}

export async function removeTagFromContact(
  _locationId: string,
  _contactId: string,
  _tagName: string
) {
  return { success: true };
}

export async function uploadToGhlMedia(
  _locationId: string,
  _token: string,
  _file: any
) {
  return { url: "https://mock-media.example.com/file" };
}
