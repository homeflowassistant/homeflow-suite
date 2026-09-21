import {
  getCustomValueMap,
  getLocationCustomValues,
  getValidAccessToken,
} from "../ghl-service.js";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "v3";
const MAX_RENDER_PASSES = 5;

export const SMS_CUSTOM_VALUE_KEYS = new Set([
  "autoreplynewleadmessage",
  "autoreplynewcustomermessage",
  "teamnotificationnewleadmessage",
  "teamnotificationnewcustomermessage",
  "customfailedpaymentmessage",
  "customskippedjobmessage",
  "customsubscriptionpausedunpausedmessage",
  "accountunpausedmessage",
]);

export class GhlSmsActionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = "GhlSmsActionError";
  }
}

type ContactRecord = Record<string, unknown>;

type ActionInput = {
  messageCustomValueKey: string;
  contactId?: string;
  contactPhone?: string;
  contactEmail?: string;
  fromNumber?: string;
};

type ActionEnvelope = {
  data?: Record<string, unknown>;
  extras?: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getContactId(contact: ContactRecord): string {
  return asText(contact.id);
}

function getContactEmail(contact: ContactRecord): string {
  return asText(contact.email).toLowerCase();
}

function getContactName(contact: ContactRecord): string {
  return (
    asText(contact.name) ||
    [asText(contact.firstName), asText(contact.lastName)].filter(Boolean).join(" ")
  );
}

function getContactFieldValue(contact: ContactRecord, key: string): string | undefined {
  const normalizedKey = normalizeTokenKey(key);
  if (normalizedKey === "name" || normalizedKey === "fullname") {
    return getContactName(contact) || undefined;
  }

  const directValue = contact[key];
  if (directValue !== undefined && directValue !== null) return String(directValue);

  for (const [contactKey, contactValue] of Object.entries(contact)) {
    if (normalizeTokenKey(contactKey) === normalizedKey) {
      if (contactValue !== undefined && contactValue !== null && typeof contactValue !== "object") {
        return String(contactValue);
      }
    }
  }

  const customFields = Array.isArray(contact.customFields)
    ? contact.customFields
    : [];

  for (const field of customFields) {
    if (!field || typeof field !== "object") continue;
    const record = field as Record<string, unknown>;
    const candidates = [record.key, record.fieldKey, record.id, record.name]
      .map(asText)
      .filter(Boolean)
      .map(normalizeTokenKey);
    if (candidates.includes(normalizedKey)) {
      const value = record.fieldValue ?? record.value;
      return value === undefined || value === null ? "" : String(value);
    }
  }

  return undefined;
}

function extractTokenKey(token: string): string {
  const customValueMatch = token.match(/^\{\{\s*custom_values\.([^}]+?)\s*\}\}$/i);
  if (customValueMatch?.[1]) return customValueMatch[1].trim();

  const contactMatch = token.match(/^\{\{\s*contact\.([^}]+?)\s*\}\}$/i);
  if (contactMatch?.[1]) return `contact.${contactMatch[1].trim()}`;

  const locationMatch = token.match(/^\{\{\s*location\.([^}]+?)\s*\}\}$/i);
  if (locationMatch?.[1]) return `location.${locationMatch[1].trim()}`;

  return token.replace(/^\{\{\s*|\s*\}\}$/g, "").trim();
}

function normalizeTokenKey(value: string): string {
  return extractTokenKey(value)
    .toLowerCase()
    .replace(/^custom_values\./, "")
    .replace(/[^a-z0-9]/g, "");
}

function getCustomValue(
  customValues: Record<string, unknown>[],
  key: string
): string | undefined {
  const map = getCustomValueMap(customValues);
  const candidates = [key, extractTokenKey(key), `custom_values.${extractTokenKey(key)}`];

  for (const candidate of candidates) {
    const direct = map.get(candidate);
    if (direct) return direct.value;
    const normalized = normalizeTokenKey(candidate);
    const normalizedEntry = map.get(normalized);
    if (normalizedEntry) return normalizedEntry.value;
  }

  return undefined;
}

function decodeStoredLineBreaks(value: string): string {
  return value
    .replace(/\\r\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\n/g, "\n");
}

function getLocationValue(location: ContactRecord, key: string, locationId: string): string | undefined {
  if (key === "id" || key === "location_id") return locationId;
  return getContactFieldValue(location, key);
}

export function renderSmsMessage(
  template: string,
  options: {
    contact: ContactRecord;
    locationId: string;
    location?: ContactRecord;
    customValues: Record<string, unknown>[];
  }
): string {
  let rendered = template;
  const unresolved = new Set<string>();

  for (let pass = 0; pass < MAX_RENDER_PASSES; pass += 1) {
    let changed = false;
    rendered = rendered.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_whole, rawToken: string) => {
      const token = `{{${rawToken}}}`;
      const sourceToken = rawToken.trim();
      const normalizedLower = sourceToken.toLowerCase();
      let value: string | undefined;

      if (normalizedLower.startsWith("custom_values.")) {
        value = getCustomValue(
          options.customValues,
          sourceToken.slice("custom_values.".length).trim()
        );
      } else if (normalizedLower.startsWith("contact.")) {
        value = getContactFieldValue(
          options.contact,
          sourceToken.slice("contact.".length).trim()
        );
      } else if (normalizedLower.startsWith("location.")) {
        value = getLocationValue(
          options.location ?? {},
          sourceToken.slice("location.".length).trim(),
          options.locationId
        );
      } else {
        value = getContactFieldValue(options.contact, sourceToken);
      }

      if (value === undefined) {
        unresolved.add(token);
        return token;
      }

      changed = true;
      return value;
    });

    if (!changed) break;
  }

  const remainingTokens = rendered.match(/\{\{\s*[^{}]+?\s*\}\}/g) ?? [];
  for (const token of remainingTokens) unresolved.add(token);
  if (unresolved.size > 0) {
    throw new GhlSmsActionError(
      "UNRESOLVED_MERGE_FIELD",
      `Unable to resolve SMS merge field(s): ${Array.from(unresolved).join(", ")}`,
      422
    );
  }

  return decodeStoredLineBreaks(rendered);
}

async function ghlJson<T>(
  locationId: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const accessToken = await getValidAccessToken(locationId);
  const response = await fetch(`${GHL_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_API_VERSION,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new GhlSmsActionError(
      "GHL_API_ERROR",
      `HighLevel API request failed: ${response.status} ${body}`,
      502
    );
  }

  return (await response.json()) as T;
}

async function getContactById(locationId: string, contactId: string): Promise<ContactRecord> {
  console.log("[GHL SMS Action][CONTACT_LOOKUP_ID]", {
    locationId: locationId.slice(-6),
    contactId: contactId.slice(-6),
  });
  const response = await ghlJson<{ contact?: ContactRecord } | ContactRecord>(
    locationId,
    `/contacts/${encodeURIComponent(contactId)}`
  );
  const contact =
    response && typeof response === "object" && "contact" in response
      ? response.contact
      : response;

  if (
    !contact ||
    typeof contact !== "object" ||
    !getContactId(contact as ContactRecord)
  ) {
    throw new GhlSmsActionError("CONTACT_NOT_FOUND", `Contact '${contactId}' was not found.`, 404);
  }
  return contact as ContactRecord;
}

async function getContactByEmail(locationId: string, email: string): Promise<ContactRecord> {
  console.log("[GHL SMS Action][CONTACT_LOOKUP_EMAIL]", {
    locationId: locationId.slice(-6),
    emailProvided: Boolean(email),
  });
  const query = new URLSearchParams({ locationId, email, limit: "20" });
  const response = await ghlJson<{ contacts?: ContactRecord[] }>(
    locationId,
    `/contacts/lookup?${query.toString()}`
  );
  const contacts = Array.isArray(response.contacts) ? response.contacts : [];

  if (contacts.length === 0) {
    throw new GhlSmsActionError("CONTACT_NOT_FOUND", `No contact was found for '${email}'.`, 404);
  }
  if (contacts.length > 1) {
    throw new GhlSmsActionError(
      "MULTIPLE_CONTACTS_FOUND",
      `More than one contact matched '${email}'. Use a Contact ID instead.`,
      409
    );
  }
  return getContactById(locationId, getContactId(contacts[0]));
}

function normalizePhoneForLookup(phone: string): string {
  const compact = phone.trim().replace(/[\s().-]/g, "");
  const normalized = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;

  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new GhlSmsActionError(
      "INVALID_PHONE",
      "Phone must be in E.164 format, for example +14155552671.",
      400
    );
  }

  return normalized;
}

async function getContactByPhone(locationId: string, phone: string): Promise<ContactRecord> {
  const normalizedPhone = normalizePhoneForLookup(phone);
  console.log("[GHL SMS Action][CONTACT_LOOKUP_PHONE]", {
    locationId: locationId.slice(-6),
    phoneSuffix: normalizedPhone.slice(-4),
  });
  const query = new URLSearchParams({
    locationId,
    phone: normalizedPhone,
    limit: "20",
  });
  const response = await ghlJson<{ contacts?: ContactRecord[] }>(
    locationId,
    `/contacts/lookup?${query.toString()}`
  );
  const contacts = Array.isArray(response.contacts) ? response.contacts : [];

  if (contacts.length === 0) {
    throw new GhlSmsActionError(
      "CONTACT_NOT_FOUND",
      `No contact was found for phone '${normalizedPhone}'.`,
      404
    );
  }
  if (contacts.length > 1) {
    throw new GhlSmsActionError(
      "MULTIPLE_CONTACTS_FOUND",
      `More than one contact matched phone '${normalizedPhone}'. Use a Contact ID instead.`,
      409
    );
  }

  return getContactById(locationId, getContactId(contacts[0]));
}

function normalizePhoneForComparison(phone: unknown): string {
  return String(phone ?? "").replace(/\D/g, "");
}

async function getContactByEmailAndPhone(
  locationId: string,
  email: string,
  phone: string
): Promise<ContactRecord> {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPhone = normalizePhoneForLookup(phone);
  const expectedPhone = normalizePhoneForComparison(normalizedPhone);

  console.log("[GHL SMS Action][CONTACT_LOOKUP_EMAIL_PHONE]", {
    locationId: locationId.slice(-6),
    emailProvided: Boolean(normalizedEmail),
    phoneSuffix: normalizedPhone.slice(-4),
  });

  const lookup = async (query: URLSearchParams) => {
    const response = await ghlJson<{ contacts?: ContactRecord[] }>(
      locationId,
      `/contacts/lookup?${query.toString()}`
    );
    return Array.isArray(response.contacts) ? response.contacts : [];
  };

  const contacts = await lookup(
    new URLSearchParams({
      locationId,
      email: normalizedEmail,
      phone: normalizedPhone,
      limit: "20",
    })
  );
  const exactMatches = contacts.filter(contact =>
    getContactEmail(contact) === normalizedEmail &&
    normalizePhoneForComparison(contact.phone) === expectedPhone
  );

  // Some HighLevel locations interpret lookup parameters as either/or, so
  // retry with email alone and still enforce an exact phone match locally.
  const candidates = exactMatches.length > 0
    ? exactMatches
    : (await lookup(new URLSearchParams({ locationId, email: normalizedEmail, limit: "20" })))
        .filter(contact => normalizePhoneForComparison(contact.phone) === expectedPhone);

  if (candidates.length === 1) {
    return getContactById(locationId, getContactId(candidates[0]));
  }
  if (candidates.length > 1) {
    throw new GhlSmsActionError(
      "MULTIPLE_CONTACTS_FOUND",
      `More than one contact matched '${normalizedEmail}' and '${normalizedPhone}'. Use a Contact ID instead.`,
      409
    );
  }

  throw new GhlSmsActionError(
    "CONTACT_NOT_FOUND",
    `No contact matched both '${normalizedEmail}' and '${normalizedPhone}'.`,
    404
  );
}

async function getLocationRecord(locationId: string): Promise<ContactRecord> {
  const response = await ghlJson<ContactRecord | { location?: ContactRecord }>(
    locationId,
    `/locations/${encodeURIComponent(locationId)}`
  );
  if (response && typeof response === "object" && "location" in response) {
    return (response.location ?? {}) as ContactRecord;
  }
  return response as ContactRecord;
}

type ResolvedContacts = {
  recipientContact: ContactRecord;
  mergeContact: ContactRecord;
};

async function resolveContacts(
  locationId: string,
  input: ActionInput,
  workflowContactId: string
): Promise<ResolvedContacts> {
  const configuredContactId = asText(input.contactId);
  const workflowId = asText(workflowContactId);
  const phone = asText(input.contactPhone);
  const email = asText(input.contactEmail).toLowerCase();

  if (!configuredContactId && !workflowId && !phone && !email) {
    throw new GhlSmsActionError(
      "CONTACT_IDENTIFIER_REQUIRED",
      "Provide contactId, contactPhone, contactEmail, or a workflow contact ID.",
      400
    );
  }

  // Explicit email/phone values identify a delivery-recipient override. When
  // both are supplied, require them to match the same GHL contact. If neither
  // is supplied, use the workflow contact directly.
  const recipientContact = phone && email
    ? await getContactByEmailAndPhone(locationId, email, phone)
    : phone
      ? await getContactByPhone(locationId, phone)
      : email
        ? await getContactByEmail(locationId, email)
        : await getContactById(locationId, configuredContactId || workflowId);

  // Merge fields describe the contact that entered the workflow, not the
  // separately selected SMS recipient. With no workflow ID, the direct
  // recipient is also the merge-field source.
  const mergeContact = workflowId
    ? getContactId(recipientContact) === workflowId
      ? recipientContact
      : await getContactById(locationId, workflowId)
    : recipientContact;

  return { recipientContact, mergeContact };
}

export async function getSmsCustomValueOptions(locationId: string) {
  const customValues = await getLocationCustomValues(locationId);
  return customValues
    .map(value => {
      const key = asText(value.key) || asText(value.fieldKey);
      const normalizedKey = normalizeTokenKey(key);
      if (!key || !SMS_CUSTOM_VALUE_KEYS.has(normalizedKey)) return null;
      return {
        label: asText(value.name) || key,
        value: extractTokenKey(key),
      };
    })
    .filter((value): value is { label: string; value: string } => value !== null);
}

export async function sendSavedSms(
  locationId: string,
  input: ActionInput,
  workflowContactId: string
) {
  console.log("[GHL SMS Action][SERVICE_START]", {
    locationId: locationId.slice(-6),
    customValueKey: input.messageCustomValueKey,
    contactIdProvided: Boolean(input.contactId),
    contactPhoneProvided: Boolean(input.contactPhone),
    contactEmailProvided: Boolean(input.contactEmail),
    workflowContactIdProvided: Boolean(workflowContactId),
  });
  const { recipientContact, mergeContact } = await resolveContacts(
    locationId,
    input,
    workflowContactId
  );
  console.log("[GHL SMS Action][CONTACT_RESOLVED]", {
    recipientContactId: getContactId(recipientContact).slice(-6),
    mergeContactId: getContactId(mergeContact).slice(-6),
    recipientPhoneProvided: Boolean(asText(recipientContact.phone)),
    recipientEmailProvided: Boolean(getContactEmail(recipientContact)),
    mergeContactEmailProvided: Boolean(getContactEmail(mergeContact)),
  });
  const customValues = await getLocationCustomValues(locationId);
  const template = getCustomValue(customValues, input.messageCustomValueKey);

  if (template === undefined) {
    console.warn("[GHL SMS Action][CUSTOM_VALUE_NOT_FOUND]", {
      locationId: locationId.slice(-6),
      customValueKey: input.messageCustomValueKey,
    });
    throw new GhlSmsActionError(
      "CUSTOM_VALUE_NOT_FOUND",
      `Custom Value '${input.messageCustomValueKey}' was not found.`,
      404
    );
  }
  if (template.trim() === "") {
    console.warn("[GHL SMS Action][CUSTOM_VALUE_EMPTY]", {
      locationId: locationId.slice(-6),
      customValueKey: input.messageCustomValueKey,
    });
    throw new GhlSmsActionError(
      "CUSTOM_VALUE_EMPTY",
      `Custom Value '${input.messageCustomValueKey}' is empty.`,
      422
    );
  }

  const location = /\{\{\s*location\./i.test(template)
    ? await getLocationRecord(locationId)
    : undefined;

  const message = renderSmsMessage(template, {
    contact: mergeContact,
    locationId,
    location,
    customValues,
  });
  console.log("[GHL SMS Action][MESSAGE_RENDERED]", {
    locationId: locationId.slice(-6),
    recipientContactId: getContactId(recipientContact).slice(-6),
    mergeContactId: getContactId(mergeContact).slice(-6),
    messageLength: message.length,
    lineCount: message.split("\n").length,
  });

  const body: Record<string, unknown> = {
    type: "SMS",
    contactId: getContactId(recipientContact),
    status: "pending",
    message,
  };
  if (asText(input.fromNumber)) body.fromNumber = asText(input.fromNumber);

  let response: {
    conversationId?: string;
    messageId?: string;
    messageIds?: string[];
    msg?: string;
  };
  try {
    response = await ghlJson<{
      conversationId?: string;
      messageId?: string;
      messageIds?: string[];
      msg?: string;
    }>(locationId, "/conversations/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error("[GHL SMS Action][GHL_SEND_FAILED]", {
      locationId: locationId.slice(-6),
      recipientContactId: getContactId(recipientContact).slice(-6),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  return {
    success: true,
    channel: "SMS",
    contactId: getContactId(recipientContact),
    contactPhone: asText(recipientContact.phone) || undefined,
    contactEmail: getContactEmail(recipientContact) || undefined,
    conversationId: response.conversationId,
    messageId: response.messageId,
    messageIds: response.messageIds,
    customValueKey: input.messageCustomValueKey,
  };
}

export function parseSmsActionInput(data: Record<string, unknown>): ActionInput {
  const explicitKey =
    asText(data.messageCustomValueKey) ||
    asText(data.customValueKey) ||
    asText(data.custom_value_key) ||
    asText(data.messageKey) ||
    asText(data.savedMessage);
  const messageCustomValueKey =
    explicitKey ||
    Object.values(data)
      .map(asText)
      .map(value => extractCustomValueKey(value))
      .find(value => SMS_CUSTOM_VALUE_KEYS.has(normalizeTokenKey(value))) ||
    "";
  if (!messageCustomValueKey) {
    throw new GhlSmsActionError(
      "INVALID_ACTION_PAYLOAD",
      "messageCustomValueKey is required.",
      400
    );
  }

  return {
    messageCustomValueKey,
    contactId: asText(data.contactId) || undefined,
    contactPhone:
      asText(data.contactPhone) ||
      asText(data.phone) ||
      asText(data.contact_phone) ||
      undefined,
    contactEmail: asText(data.contactEmail) || undefined,
    fromNumber: asText(data.fromNumber) || undefined,
  };
}

function extractCustomValueKey(value: string): string {
  const match = value.match(/^\{\{\s*custom_values\.([^}]+?)\s*\}\}$/i);
  return match?.[1]?.trim() ?? value.trim();
}

export type { ActionEnvelope, ActionInput };
