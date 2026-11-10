/**
 * Single "Staff" contact per sub-account.
 *
 * GHL can only text a contact, so team notifications need one contact that
 * holds the team phone (send_team_notification_phone) and team email. Rules:
 *
 * - Its contact ID is remembered in the homeflow_staff_contact_id custom
 *   value, so we always update the same contact instead of searching by name.
 * - GHL keeps one contact per email/phone, so when the owner uses their own
 *   details for the team values, the owner's contact IS the staff contact. We
 *   never overwrite a real name; "Staff" is only used when the contact has no
 *   name at all.
 * - The team phone from the custom value is the source of truth. Before a
 *   staff SMS we check the contact still has that phone and SMS is not on DND,
 *   and restore both if a test add-contact changed them.
 * - Only one contact keeps the `staff` tag; older duplicates lose the tag
 *   (they are never deleted).
 */
import {
  addTagToContact,
  getLocationCustomValueMap,
  getValidAccessToken,
  removeTagFromContact,
  saveGhlCustomValues,
} from "../ghl-service.js";
import { phoneMatchKey, samePhone, toE164Phone } from "../helpers/phone.js";

export const STAFF_CONTACT_TAG = "staff";
export const STAFF_CONTACT_ID_KEY = "homeflow_staff_contact_id";
export const TEAM_EMAIL_KEY = "send_team_notification_email";
export const TEAM_PHONE_KEY = "send_team_notification_phone";
const STAFF_DEFAULT_NAME = "Staff";
const STAFF_SOURCE = "HomeFlow Alerts & Notifications";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

export type StaffContactRecord = Record<string, unknown>;

export class StaffContactError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 422
  ) {
    super(message);
    this.name = "StaffContactError";
  }
}

/** The GHL calls this service needs; replaced with a fake in tests. */
export interface StaffContactApi {
  getContact(id: string): Promise<StaffContactRecord | null>;
  searchContacts(text: string): Promise<StaffContactRecord[]>;
  findDuplicateByPhone(phone: string): Promise<StaffContactRecord | null>;
  createContact(
    payload: Record<string, unknown>
  ): Promise<{ id: string } | { duplicateOf: string }>;
  updateContact(id: string, payload: Record<string, unknown>): Promise<boolean>;
  addTag(id: string, tag: string): Promise<void>;
  removeTag(id: string, tag: string): Promise<void>;
  readStoredId(): Promise<string>;
  storeId(id: string): Promise<void>;
}

export type StaffSyncResult = {
  contactId: string;
  created: boolean;
  /** An existing contact (e.g. the owner's own) became the staff contact. */
  adopted: boolean;
  /** Phone/email/DND were changed back to the team values. */
  restored: boolean;
  /** Older contacts whose `staff` tag was removed. */
  untaggedIds: string[];
};

// ─── Contact helpers ─────────────────────────────────────────────────

export function contactId(contact: StaffContactRecord | null | undefined): string {
  const id = contact?.id ?? contact?._id;
  return typeof id === "string" ? id : "";
}

export function contactTags(contact: StaffContactRecord): string[] {
  return Array.isArray(contact.tags)
    ? contact.tags.map(tag =>
        String(
          typeof tag === "string"
            ? tag
            : (tag as Record<string, unknown>)?.name ?? ""
        )
          .trim()
          .toLowerCase()
      )
    : [];
}

export function hasStaffTag(contact: StaffContactRecord): boolean {
  return contactTags(contact).includes(STAFF_CONTACT_TAG);
}

function contactEmail(contact: StaffContactRecord): string {
  return String(contact.email ?? "").trim().toLowerCase();
}

function hasName(contact: StaffContactRecord): boolean {
  return [contact.firstName, contact.lastName, contact.name].some(
    value => typeof value === "string" && value.trim() !== ""
  );
}

export function isSmsDnd(contact: StaffContactRecord): boolean {
  if (contact.dnd === true) return true;
  const settings = contact.dndSettings as
    | Record<string, { status?: unknown } | undefined>
    | undefined;
  const sms = settings?.SMS ?? settings?.sms;
  return String(sms?.status ?? "").toLowerCase() === "active";
}

/**
 * Pick one contact out of several with the same phone: prefer the one
 * already tagged staff, then the oldest.
 */
export function pickStaffCandidate(
  candidates: StaffContactRecord[]
): StaffContactRecord | null {
  if (candidates.length === 0) return null;
  const tagged = candidates.filter(hasStaffTag);
  const pool = tagged.length > 0 ? tagged : candidates;
  return [...pool].sort((a, b) => {
    const left = Date.parse(String(a.dateAdded ?? "")) || 0;
    const right = Date.parse(String(b.dateAdded ?? "")) || 0;
    return left - right;
  })[0];
}

async function findByPhone(
  api: StaffContactApi,
  phone: string
): Promise<StaffContactRecord | null> {
  const key = phoneMatchKey(phone);
  if (!key) return null;
  const seen = new Map<string, StaffContactRecord>();
  for (const text of [toE164Phone(phone), key]) {
    for (const contact of await api.searchContacts(text)) {
      if (samePhone(contact.phone, phone) && contactId(contact)) {
        seen.set(contactId(contact), contact);
      }
    }
    if (seen.size > 0) break;
  }
  if (seen.size === 0) {
    const duplicate = await api.findDuplicateByPhone(toE164Phone(phone));
    if (duplicate && contactId(duplicate)) return duplicate;
  }
  return pickStaffCandidate(Array.from(seen.values()));
}

async function findByEmail(
  api: StaffContactApi,
  email: string
): Promise<StaffContactRecord | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  const matches = (await api.searchContacts(target)).filter(
    contact => contactEmail(contact) === target && contactId(contact)
  );
  return pickStaffCandidate(matches);
}

/** Changes needed so the contact matches the team values. */
function teamValueChanges(
  contact: StaffContactRecord,
  email: string,
  phone: string
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (phone && !samePhone(contact.phone, phone)) changes.phone = phone;
  if (email && contactEmail(contact) !== email.toLowerCase()) {
    changes.email = email;
  }
  if (!hasName(contact)) changes.firstName = STAFF_DEFAULT_NAME;
  return changes;
}

async function clearSmsDnd(
  api: StaffContactApi,
  contact: StaffContactRecord
): Promise<boolean> {
  if (!isSmsDnd(contact)) return false;
  return api.updateContact(contactId(contact), {
    dnd: false,
    dndSettings: { SMS: { status: "inactive" } },
  });
}

/** Remove the staff tag from any other contact that still has it. */
async function untagOtherStaffContacts(
  api: StaffContactApi,
  keepId: string,
  extraIds: string[]
): Promise<string[]> {
  const others = new Map<string, StaffContactRecord>();
  try {
    for (const contact of await api.searchContacts(STAFF_DEFAULT_NAME)) {
      if (contactId(contact) && hasStaffTag(contact)) {
        others.set(contactId(contact), contact);
      }
    }
  } catch (error) {
    console.warn("[Staff Contact] could not search older staff contacts", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  for (const id of extraIds) if (id) others.set(id, { id });

  const removed: string[] = [];
  for (const id of Array.from(others.keys())) {
    if (id === keepId) continue;
    try {
      await api.removeTag(id, STAFF_CONTACT_TAG);
      removed.push(id);
    } catch (error) {
      console.warn("[Staff Contact] could not remove staff tag", {
        contactId: id.slice(-6),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return removed;
}

// ─── Main sync ───────────────────────────────────────────────────────

/**
 * Make sure exactly one contact holds the team phone/email, is tagged staff,
 * is not on SMS DND, and is remembered by ID. Used by the Alerts save and,
 * when needed, right before a staff SMS.
 */
export async function syncStaffContactWith(
  api: StaffContactApi,
  team: { email: string; phone: string }
): Promise<StaffSyncResult> {
  const email = team.email.trim();
  const phone = team.phone.trim() ? toE164Phone(team.phone) : "";
  if (!phone) {
    throw new StaffContactError(
      "STAFF_PHONE_REQUIRED",
      "Enter the team notification phone on Alerts & Notifications before sending staff texts."
    );
  }

  const result: StaffSyncResult = {
    contactId: "",
    created: false,
    adopted: false,
    restored: false,
    untaggedIds: [],
  };

  const storedId = (await api.readStoredId()).trim();
  let contact = storedId ? await api.getContact(storedId) : null;
  const previousId = contactId(contact);

  // The team phone already belongs to another contact (case 8): that
  // contact becomes the staff contact instead of creating a duplicate.
  if (contact && !samePhone(contact.phone, phone)) {
    const owner = await findByPhone(api, phone);
    if (owner && contactId(owner) !== previousId) {
      contact = owner;
      result.adopted = true;
    }
  }

  if (!contact) {
    contact = (await findByPhone(api, phone)) ?? (await findByEmail(api, email));
    if (contact) result.adopted = true;
  }

  if (!contact) {
    const created = await api.createContact({
      firstName: STAFF_DEFAULT_NAME,
      email: email || undefined,
      phone,
      dnd: false,
      source: STAFF_SOURCE,
      tags: [STAFF_CONTACT_TAG],
    });
    if ("duplicateOf" in created) {
      contact = await api.getContact(created.duplicateOf);
      if (!contact) {
        throw new StaffContactError(
          "STAFF_CONTACT_UNAVAILABLE",
          "The staff contact could not be created or found in HighLevel.",
          502
        );
      }
      result.adopted = true;
    } else {
      result.contactId = created.id;
      result.created = true;
    }
  }

  if (contact) {
    result.contactId = contactId(contact);
    const changes = teamValueChanges(contact, email, phone);
    if (Object.keys(changes).length > 0) {
      let ok = await api.updateContact(result.contactId, changes);
      if (!ok && changes.email) {
        // The team email may belong to a different contact; the phone is
        // what matters for texts, so retry without it.
        const { email: _ignored, ...withoutEmail } = changes;
        ok =
          Object.keys(withoutEmail).length === 0 ||
          (await api.updateContact(result.contactId, withoutEmail));
      }
      if (!ok) {
        throw new StaffContactError(
          "STAFF_CONTACT_UPDATE_FAILED",
          "The staff contact could not be updated with the team notification phone.",
          502
        );
      }
      if (changes.phone || changes.email) result.restored = !result.adopted;
    }
    if (await clearSmsDnd(api, contact)) result.restored = true;
    if (!hasStaffTag(contact)) await api.addTag(result.contactId, STAFF_CONTACT_TAG);
  }

  if (result.contactId !== storedId) await api.storeId(result.contactId);

  result.untaggedIds = await untagOtherStaffContacts(
    api,
    result.contactId,
    previousId && previousId !== result.contactId ? [previousId] : []
  );
  return result;
}

/**
 * Return the contact a staff SMS should go to. Uses the remembered contact
 * when it still has the team phone and SMS is allowed; otherwise re-syncs.
 */
export async function resolveStaffContactForSendWith(
  api: StaffContactApi,
  team: { email: string; phone: string }
): Promise<StaffContactRecord> {
  const phone = team.phone.trim();
  if (!phone) {
    throw new StaffContactError(
      "STAFF_PHONE_CUSTOM_VALUE_REQUIRED",
      "The send_team_notification_phone Custom Value is required when Send To is Staff."
    );
  }
  const storedId = (await api.readStoredId()).trim();
  const stored = storedId ? await api.getContact(storedId) : null;
  if (stored && samePhone(stored.phone, phone) && !isSmsDnd(stored)) {
    return stored;
  }

  const synced = await syncStaffContactWith(api, team);
  console.log("[Staff Contact] re-synced before staff SMS", {
    contactId: synced.contactId.slice(-6),
    created: synced.created,
    adopted: synced.adopted,
    restored: synced.restored,
  });
  const contact = await api.getContact(synced.contactId);
  if (!contact) {
    throw new StaffContactError(
      "STAFF_CONTACT_UNAVAILABLE",
      "The staff contact could not be loaded from HighLevel.",
      502
    );
  }
  return contact;
}

// ─── GHL implementation ──────────────────────────────────────────────

async function ghlFetch(
  locationId: string,
  path: string,
  init: RequestInit = {},
  version = GHL_API_VERSION
): Promise<Response> {
  const accessToken = await getValidAccessToken(locationId);
  return fetch(`${GHL_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      Version: version,
      ...(init.headers ?? {}),
    },
  });
}

function unwrapContact(body: unknown): StaffContactRecord | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const contact =
    record.contact && typeof record.contact === "object"
      ? (record.contact as StaffContactRecord)
      : (record as StaffContactRecord);
  return contactId(contact) ? contact : null;
}

export function createGhlStaffContactApi(
  locationId: string,
  options: { storedId?: string } = {}
): StaffContactApi {
  let cachedStoredId = options.storedId;
  return {
    async getContact(id) {
      const response = await ghlFetch(
        locationId,
        `/contacts/${encodeURIComponent(id)}`
      );
      if (response.status === 404 || response.status === 400) return null;
      if (!response.ok) {
        throw new StaffContactError(
          "GHL_API_ERROR",
          `HighLevel contact lookup failed: ${response.status}`,
          502
        );
      }
      return unwrapContact(await response.json());
    },

    async searchContacts(text) {
      const response = await ghlFetch(locationId, "/contacts/search", {
        method: "POST",
        body: JSON.stringify({ locationId, searchText: text, page: 1, limit: 20 }),
      });
      if (!response.ok) return [];
      const body = (await response.json()) as {
        contacts?: StaffContactRecord[];
      };
      return Array.isArray(body.contacts) ? body.contacts : [];
    },

    async findDuplicateByPhone(phone) {
      const query = new URLSearchParams({ locationId, number: phone });
      const response = await ghlFetch(
        locationId,
        `/contacts/search/duplicate?${query.toString()}`
      );
      if (!response.ok) return null;
      return unwrapContact(await response.json());
    },

    async createContact(payload) {
      const response = await ghlFetch(locationId, "/contacts/", {
        method: "POST",
        body: JSON.stringify({ locationId, ...payload }),
      });
      const text = await response.text();
      let body: Record<string, unknown> = {};
      try {
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        /* non-JSON error body */
      }
      if (response.ok) {
        const created = unwrapContact(body);
        if (created) return { id: contactId(created) };
      }
      const meta = body.meta as Record<string, unknown> | undefined;
      const duplicateId =
        typeof meta?.contactId === "string" ? meta.contactId : "";
      if (duplicateId) return { duplicateOf: duplicateId };
      throw new StaffContactError(
        "STAFF_CONTACT_CREATE_FAILED",
        `The staff contact could not be created: ${response.status} ${text.slice(0, 300)}`,
        502
      );
    },

    async updateContact(id, payload) {
      const response = await ghlFetch(
        locationId,
        `/contacts/${encodeURIComponent(id)}`,
        { method: "PUT", body: JSON.stringify(payload) }
      );
      if (!response.ok) {
        console.warn("[Staff Contact] update rejected", {
          contactId: id.slice(-6),
          status: response.status,
          body: (await response.text()).slice(0, 300),
        });
      }
      return response.ok;
    },

    async addTag(id, tag) {
      await addTagToContact(locationId, id, tag);
    },

    async removeTag(id, tag) {
      await removeTagFromContact(locationId, id, tag);
    },

    async readStoredId() {
      if (cachedStoredId === undefined) {
        const values = await getLocationCustomValueMap(locationId);
        cachedStoredId = values.get(STAFF_CONTACT_ID_KEY)?.value ?? "";
      }
      return cachedStoredId;
    },

    async storeId(id) {
      const { failedKeys, missingKeys } = await saveGhlCustomValues(
        locationId,
        { [STAFF_CONTACT_ID_KEY]: id },
        { createMissing: true, exactMatchOnly: true }
      );
      if (failedKeys.length || missingKeys.length) {
        console.warn("[Staff Contact] could not store staff contact ID", {
          failedKeys,
          missingKeys,
        });
      } else {
        cachedStoredId = id;
      }
    },
  };
}

export function syncStaffContact(
  locationId: string,
  team: { email: string; phone: string }
): Promise<StaffSyncResult> {
  return syncStaffContactWith(createGhlStaffContactApi(locationId), team);
}

export function resolveStaffContactForSend(
  locationId: string,
  team: { email: string; phone: string; storedId?: string }
): Promise<StaffContactRecord> {
  return resolveStaffContactForSendWith(
    createGhlStaffContactApi(locationId, { storedId: team.storedId }),
    team
  );
}

/**
 * How a contact being added relates to the team notification values. Used by
 * Add Contact / CSV to warn before a test changes staff texts (cases 4–6).
 */
export type StaffOverlap =
  | "none"
  | "both"
  | "email_only"
  | "phone_only";

export function describeStaffOverlap(
  contact: { email?: string; phone?: string },
  team: { email: string; phone: string }
): StaffOverlap {
  const emailMatch =
    Boolean(team.email.trim()) &&
    (contact.email ?? "").trim().toLowerCase() === team.email.trim().toLowerCase();
  const phoneMatch = samePhone(contact.phone ?? "", team.phone);
  if (emailMatch && phoneMatch) return "both";
  if (emailMatch) return "email_only";
  if (phoneMatch) return "phone_only";
  return "none";
}

export function staffOverlapNotice(
  overlap: StaffOverlap,
  dnd: boolean
): string | null {
  if (overlap === "none") return null;
  if (dnd) {
    return "This contact is your team notification (Staff) contact. Adding it with DND on pauses staff texts until the next staff alert or Alerts save turns DND back off.";
  }
  if (overlap === "both") {
    return "This contact is also your team notification (Staff) contact. It was added and will show in Contacts with a red Staff badge.";
  }
  if (overlap === "email_only") {
    return "This email is your team notification email but the phone is different. GHL merges them into the Staff contact, so staff texts may go to this phone until the next staff alert or Alerts save restores the team phone.";
  }
  return "This phone is your team notification phone. The contact was merged into the Staff contact and will show in Contacts with a red Staff badge.";
}
