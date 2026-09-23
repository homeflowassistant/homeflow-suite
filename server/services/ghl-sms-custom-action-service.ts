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

function asActionText(value: unknown, depth = 0): string {
  const direct = asText(value);
  if (direct) return direct;
  if (!value || typeof value !== "object" || depth > 3) return "";

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = asActionText(item, depth + 1);
      if (nested) return nested;
    }
    return "";
  }

  const record = value as Record<string, unknown>;
  for (const key of [
    "value",
    "selectedValue",
    "selected_value",
    "selectedOption",
    "selected_option",
    "customValue",
    "custom_value",
    "customValueId",
    "custom_value_id",
    "fieldValue",
    "field_value",
    "reference",
    "token",
    "path",
    "key",
    "fieldKey",
    "id",
    "_id",
    "displayValue",
    "text",
    "label",
    "name",
    "content",
    "input",
    "payload",
  ]) {
    const nested = asActionText(record[key], depth + 1);
    if (nested) return nested;
  }
  return "";
}

function getAliasedText(
  data: Record<string, unknown>,
  aliases: string[]
): string {
  const normalizedAliases = new Set(
    aliases.map(alias => alias.toLowerCase().replace(/[^a-z0-9]/g, ""))
  );

  for (const alias of aliases) {
    const direct = asActionText(data[alias]);
    if (direct) return direct;
  }

  for (const [key, value] of Object.entries(data)) {
    if (
      normalizedAliases.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))
    ) {
      const text = asActionText(value);
      if (text) return text;
    }
  }

  const findNested = (value: unknown, depth: number): string => {
    if (!value || typeof value !== "object" || depth > 5) return "";
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = findNested(item, depth + 1);
        if (nested) return nested;
      }
      return "";
    }

    const record = value as Record<string, unknown>;
    const fieldReference = asText(record.reference) || asText(record.field) || asText(record.name);
    if (normalizedAliases.has(fieldReference.toLowerCase().replace(/[^a-z0-9]/g, ""))) {
      for (const valueKey of ["value", "selectedValue", "selected", "input", "data"]) {
        const fieldValue = asActionText(record[valueKey]);
        if (fieldValue) return fieldValue;
      }
    }

    for (const [key, nestedValue] of Object.entries(record)) {
      // Never use the workflow contact object itself as an explicit recipient
      // override. Its values belong to merge fields/fallback delivery.
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (["contact", "workflowcontact", "workflowcontactdata"].includes(normalizedKey)) {
        continue;
      }
      if (normalizedAliases.has(normalizedKey)) {
        const text = asActionText(nestedValue);
        if (text) return text;
      }
      const nested = findNested(nestedValue, depth + 1);
      if (nested) return nested;
    }
    return "";
  };

  return findNested(data, 0);
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

  // The Custom Value picker can preserve a folder/display path in the
  // reference, such as:
  // {{custom_values.Alerts and Notifications.send_team_notification_email}}
  // while the API may expose only the leaf key or display name. Match the
  // final path segment against all known Custom Value identifiers.
  const extractedKey = extractTokenKey(key);
  const leafKey = extractedKey.split(/[.>\/]+/).map(part => part.trim()).filter(Boolean).at(-1) ?? extractedKey;
  const normalizedLeaf = normalizeTokenKey(leafKey);
  if (normalizedLeaf) {
    for (const customValue of customValues) {
      const identifiers = [customValue.key, customValue.fieldKey, customValue.name]
        .map(asText)
        .filter(Boolean);
      if (identifiers.some(identifier => normalizeTokenKey(identifier) === normalizedLeaf)) {
        const value = customValue.value;
        return value === undefined || value === null ? "" : String(value);
      }
    }
  }

  const requestedId = extractedKey.trim();
  if (requestedId) {
    const byId = customValues.find(customValue =>
      [customValue.id, customValue._id]
        .map(asText)
        .some(identifier => identifier === requestedId)
    );
    if (byId) {
      const value = byId.value;
      return value === undefined || value === null ? "" : String(value);
    }
  }

  return undefined;
}

function resolveRecipientValue(
  value: string | undefined,
  customValues: Record<string, unknown>[]
): string | undefined {
  let resolved = asText(value);
  if (!resolved) return undefined;

  // A workflow action field mapped to a GHL Custom Value can arrive as the
  // literal token, for example {{custom_values.recipient_email}}. Resolve
  // that token from the location's current Custom Values before attempting
  // the contact lookup. Follow a short chain in case the stored value is
  // itself another custom-value token.
  for (let pass = 0; pass < MAX_RENDER_PASSES; pass += 1) {
    const match = resolved.match(/^\{\{\s*custom_values\.([^}]+?)\s*\}\}$/i);
    if (!match?.[1]) break;
    const next = getCustomValue(customValues, match[1]);
    if (next === undefined) {
      throw new GhlSmsActionError(
        "CUSTOM_VALUE_NOT_FOUND",
        `Recipient Custom Value '${match[1].trim()}' was not found for this location.`,
        422
      );
    }
    if (next === resolved) return undefined;
    resolved = asText(next);
    if (!resolved) return undefined;
  }

  // Some workflow versions persist the selected Custom Value as its key
  // rather than preserving the {{custom_values.*}} wrapper. Accept that form
  // as well, while leaving ordinary email addresses and phone numbers alone.
  const directCustomValue = getCustomValue(customValues, resolved);
  if (directCustomValue !== undefined && directCustomValue !== resolved) {
    return asText(directCustomValue) || undefined;
  }

  if (/custom\s*values?/i.test(resolved)) {
    throw new GhlSmsActionError(
      "CUSTOM_VALUE_NOT_FOUND",
      `Recipient Custom Value '${resolved}' was not found for this location.`,
      422
    );
  }

  return resolved || undefined;
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

  // HighLevel's lookup endpoint requires exactly one of email or phone. Do
  // not send both in one request; look up by email first and enforce the
  // phone match locally. If that does not find the pair, try the inverse
  // lookup as a compatibility fallback for locations that index the values
  // differently.
  const emailCandidates = (await lookup(
    new URLSearchParams({ locationId, email: normalizedEmail, limit: "20" })
  )).filter(contact =>
    getContactEmail(contact) === normalizedEmail &&
    normalizePhoneForComparison(contact.phone) === expectedPhone
  );

  const candidates = emailCandidates.length > 0
    ? emailCandidates
    : (await lookup(new URLSearchParams({ locationId, phone: normalizedPhone, limit: "20" })))
        .filter(contact =>
          getContactEmail(contact) === normalizedEmail &&
          normalizePhoneForComparison(contact.phone) === expectedPhone
        );

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
  const customValues = await getLocationCustomValues(locationId);
  const resolvedInput: ActionInput = {
    ...input,
    contactEmail: resolveRecipientValue(input.contactEmail, customValues),
    contactPhone: resolveRecipientValue(input.contactPhone, customValues),
  };
  const { recipientContact, mergeContact } = await resolveContacts(
    locationId,
    resolvedInput,
    workflowContactId
  );
  console.log("[GHL SMS Action][CONTACT_RESOLVED]", {
    recipientContactId: getContactId(recipientContact).slice(-6),
    mergeContactId: getContactId(mergeContact).slice(-6),
    recipientPhoneProvided: Boolean(asText(recipientContact.phone)),
    recipientEmailProvided: Boolean(getContactEmail(recipientContact)),
    mergeContactEmailProvided: Boolean(getContactEmail(mergeContact)),
  });
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
    asActionText(data.messageCustomValueKey) ||
    asActionText(data.customValueKey) ||
    asActionText(data.custom_value_key) ||
    asActionText(data.messageKey) ||
    asActionText(data.savedMessage);
  const messageCustomValueKey =
    explicitKey ||
    Object.values(data)
      .map(asActionText)
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
    contactId: getAliasedText(data, [
      "contactId",
      "contact_id",
      "contactID",
      "recipientContactId",
      "recipient_contact_id",
    ]) || undefined,
    // These are explicit action inputs. Do not read data.contact.email or
    // data.contact.phone here: those fields represent the workflow contact
    // and must remain the merge-field source/fallback recipient, not become
    // an accidental recipient override.
    contactPhone: getAliasedText(data, [
      "contactPhone",
      "contact_phone",
      "Contact Phone",
      "Phone",
      "contactPhoneId",
      "contact_phone_id",
      "contactPhoneCustomValue",
      "contact_phone_custom_value",
      "contactPhoneCustomValueId",
      "contact_phone_custom_value_id",
      "recipientPhone",
      "recipient_phone",
      "targetPhone",
      "target_phone",
      "toPhone",
      "to_phone",
      "phoneNumber",
      "phone_number",
      "phone",
    ]) || undefined,
    contactEmail: getAliasedText(data, [
      "contactEmail",
      "contact_email",
      "Contact Email",
      "contactEmailId",
      "contact_email_id",
      "contactEmailCustomValue",
      "contact_email_custom_value",
      "contactEmailCustomValueId",
      "contact_email_custom_value_id",
      "recipientEmail",
      "recipient_email",
      "targetEmail",
      "target_email",
      "toEmail",
      "to_email",
      "emailAddress",
      "email_address",
      "email",
    ]) || undefined,
    fromNumber: asActionText(data.fromNumber) || undefined,
  };
}

function extractCustomValueKey(value: string): string {
  const match = value.match(/^\{\{\s*custom_values\.([^}]+?)\s*\}\}$/i);
  return match?.[1]?.trim() ?? value.trim();
}

export type { ActionEnvelope, ActionInput };
