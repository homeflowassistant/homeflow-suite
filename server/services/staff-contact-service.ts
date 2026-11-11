/**
 * Single "Staff" contact per sub-account.
 *
 * GHL can only text a contact, so team texts need one contact that holds the
 * team phone (send_team_notification_phone). Only the phone is used: the
 * team email goes straight into the workflow's Internal Notification "custom
 * email" from its custom value and never needs a contact. Rules:
 *
 * - The `staff` tag is how we find it: there is no stored contact ID. Every
 *   sub-account keeps exactly one contact with that tag. If none has it, one
 *   named "Staff" is created with just the team phone (no email); a later
 *   team phone change updates that same contact. Any extra contact with the
 *   tag loses it.
 * - The staff contact's email is never written or cleared.
 * - GHL keeps one contact per phone, so when the team phone already belongs
 *   to a contact (e.g. the owner's own), that contact gets the tag. We never
 *   overwrite a real name; "Staff" is only used when the contact has no name.
 * - The team phone from the custom value is the source of truth. Before a
 *   staff SMS we check the contact still has that phone and SMS is not on DND,
 *   and restore both if a test add-contact changed them.
 * - Duplicates are never deleted, only untagged. The oldest tagged contact
 *   is kept.
 */
import {
  addTagToContact,
  getValidAccessToken,
  removeTagFromContact,
} from "../ghl-service.js";
import { phoneMatchKey, samePhone, toE164Phone } from "../helpers/phone.js";

export const STAFF_CONTACT_TAG = "staff";
export const TEAM_EMAIL_KEY = "send_team_notification_email";
export const TEAM_PHONE_KEY = "send_team_notification_phone";
const STAFF_DEFAULT_NAME = "Staff";
const STAFF_SOURCE = "HomeFlow Alerts & Notifications";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";
/** Same Version header the Contacts page search uses for POST /contacts/search. */
const GHL_SEARCH_VERSION = "v3";
const TAG_SEARCH_PAGE_LIMIT = 100;
const TAG_SEARCH_MAX_PAGES = 5;

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
  /** Every contact in the sub-account that has the given tag. */
  findByTag(tag: string): Promise<StaffContactRecord[]>;
  findDuplicateByPhone(phone: string): Promise<StaffContactRecord | null>;
  createContact(
    payload: Record<string, unknown>
  ): Promise<{ id: string } | { duplicateOf: string }>;
  updateContact(id: string, payload: Record<string, unknown>): Promise<boolean>;
  addTag(id: string, tag: string): Promise<void>;
  removeTag(id: string, tag: string): Promise<void>;
}

/** The only team value the staff contact needs. */
export type StaffTeamValues = { phone: string };

export type StaffSyncResult = {
  contactId: string;
  created: boolean;
  /** An existing contact (e.g. the owner's own) became the staff contact. */
  adopted: boolean;
  /** Phone/DND were changed back to the team values. */
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

/** Changes needed so the contact has the team phone (and a name). */
function teamValueChanges(
  contact: StaffContactRecord,
  phone: string
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (phone && !samePhone(contact.phone, phone)) changes.phone = phone;
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

/** Contacts that carry the staff tag (checked again locally). */
export async function findStaffTagged(
  api: StaffContactApi
): Promise<StaffContactRecord[]> {
  const byId = new Map<string, StaffContactRecord>();
  for (const contact of await api.findByTag(STAFF_CONTACT_TAG)) {
    if (contactId(contact) && hasStaffTag(contact)) {
      byId.set(contactId(contact), contact);
    }
  }
  return Array.from(byId.values());
}

/** The oldest staff-tagged contact: the one we keep. */
function oldestContact(contacts: StaffContactRecord[]): StaffContactRecord | null {
  return pickStaffCandidate(contacts);
}

/** Remove the staff tag from every contact except the one we keep. */
async function untagOtherStaffContacts(
  api: StaffContactApi,
  keepId: string,
  tagged: StaffContactRecord[]
): Promise<string[]> {
  const others = new Map<string, StaffContactRecord>();
  for (const contact of tagged) others.set(contactId(contact), contact);

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
 * Make sure exactly one contact has the `staff` tag, holds the team phone
 * and is not on SMS DND. Used by the Alerts save (when a team phone is set)
 * and, when needed, right before a staff SMS.
 *
 * 1. A contact already tagged staff (the oldest, if several) gets the phone.
 *    If another contact already owns that phone, the tag moves there.
 * 2. Otherwise a contact that already has the team phone is tagged
 *    (GHL keeps one contact per phone, so a second can't be made).
 * 3. Otherwise a new "Staff" contact is created with only the phone.
 * Every other contact with the tag loses it.
 */
export async function syncStaffContactWith(
  api: StaffContactApi,
  team: StaffTeamValues
): Promise<StaffSyncResult> {
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

  const tagged = await findStaffTagged(api);
  const keep = oldestContact(tagged);
  let contact = keep ? (await api.getContact(contactId(keep))) ?? keep : null;

  if (!contact) {
    contact = await findByPhone(api, phone);
    if (contact) result.adopted = true;
  }

  if (!contact) {
    const created = await api.createContact({
      firstName: STAFF_DEFAULT_NAME,
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
    const changes = teamValueChanges(contact, phone);
    if (Object.keys(changes).length > 0) {
      let ok = await api.updateContact(result.contactId, changes);
      if (!ok && changes.phone) {
        // GHL refused the phone because another contact already has it. Two
        // contacts can't share it, so that contact becomes the staff contact.
        const owner = await findByPhone(api, phone);
        if (owner && contactId(owner) !== result.contactId) {
          contact = owner;
          result.contactId = contactId(owner);
          result.adopted = true;
          const ownerChanges = teamValueChanges(owner, phone);
          if (Object.keys(ownerChanges).length > 0) {
            await api.updateContact(result.contactId, ownerChanges);
          }
          ok = true;
        }
      }
      if (!ok) {
        throw new StaffContactError(
          "STAFF_CONTACT_UPDATE_FAILED",
          "The staff contact could not be updated with the team notification phone.",
          502
        );
      }
      if (changes.phone && !result.adopted) result.restored = true;
    }
    if (await clearSmsDnd(api, contact)) result.restored = true;
    if (!hasStaffTag(contact)) await api.addTag(result.contactId, STAFF_CONTACT_TAG);
  }

  result.untaggedIds = await untagOtherStaffContacts(api, result.contactId, tagged);
  return result;
}

/**
 * Return the contact a staff SMS should go to. Uses the single staff-tagged
 * contact when it still has the team phone and SMS is allowed; otherwise
 * re-syncs first (no tag, several tagged, changed phone, or DND on).
 */
export async function resolveStaffContactForSendWith(
  api: StaffContactApi,
  team: StaffTeamValues
): Promise<StaffContactRecord> {
  const phone = team.phone.trim();
  if (!phone) {
    throw new StaffContactError(
      "STAFF_PHONE_CUSTOM_VALUE_REQUIRED",
      "The send_team_notification_phone Custom Value is required when Send To is Staff."
    );
  }
  const tagged = await findStaffTagged(api);
  if (tagged.length === 1) {
    const current = await api.getContact(contactId(tagged[0]));
    if (current && samePhone(current.phone, phone) && !isSmsDnd(current)) {
      return current;
    }
  }

  const synced = await syncStaffContactWith(api, team);
  console.log("[Staff Contact] re-synced before staff SMS", {
    contactId: synced.contactId.slice(-6),
    taggedBefore: tagged.length,
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

type SearchPage = { ok: boolean; contacts: StaffContactRecord[]; total: number };

/** One page of GHL's POST /contacts/search, in the format the Contacts page uses. */
async function searchPage(
  locationId: string,
  body: Record<string, unknown>
): Promise<SearchPage> {
  const response = await ghlFetch(
    locationId,
    "/contacts/search",
    { method: "POST", body: JSON.stringify({ locationId, ...body }) },
    GHL_SEARCH_VERSION
  );
  if (!response.ok) {
    console.warn("[Staff Contact] contact search rejected", {
      status: response.status,
      body: (await response.text()).slice(0, 300),
    });
    return { ok: false, contacts: [], total: 0 };
  }
  const data = (await response.json()) as {
    contacts?: StaffContactRecord[];
    total?: number;
    totalCount?: number;
  };
  const contacts = Array.isArray(data.contacts) ? data.contacts : [];
  const total = Number(data.total ?? data.totalCount) || contacts.length;
  return { ok: true, contacts, total };
}

export function createGhlStaffContactApi(locationId: string): StaffContactApi {
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
      // `limit`/`searchText` are not valid here (GHL answers 400), so this
      // uses `query` + `pageLimit` like the Contacts page.
      const page = await searchPage(locationId, { query: text, page: 1, pageLimit: 20 });
      return page.contacts;
    },

    async findByTag(tag) {
      // Try the tag filter shapes in turn; the first one GHL accepts is used
      // for every page.
      const filterShapes = [
        { field: "tags", operator: "eq", value: tag },
        { field: "tags", operator: "contains", value: [tag] },
      ];
      for (const filter of filterShapes) {
        const found: StaffContactRecord[] = [];
        let accepted = true;
        for (let page = 1; page <= TAG_SEARCH_MAX_PAGES; page += 1) {
          const result = await searchPage(locationId, {
            filters: [filter],
            sort: [{ field: "dateAdded", direction: "asc" }],
            page,
            pageLimit: TAG_SEARCH_PAGE_LIMIT,
          });
          if (!result.ok) {
            accepted = false;
            break;
          }
          found.push(...result.contacts);
          if (
            result.contacts.length < TAG_SEARCH_PAGE_LIMIT ||
            found.length >= result.total
          ) {
            break;
          }
        }
        if (accepted) return found;
      }
      throw new StaffContactError(
        "STAFF_TAG_SEARCH_FAILED",
        "HighLevel rejected the search for contacts tagged staff.",
        502
      );
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
  };
}

export function syncStaffContact(
  locationId: string,
  team: StaffTeamValues
): Promise<StaffSyncResult> {
  return syncStaffContactWith(createGhlStaffContactApi(locationId), team);
}

export function resolveStaffContactForSend(
  locationId: string,
  team: StaffTeamValues
): Promise<StaffContactRecord> {
  return resolveStaffContactForSendWith(createGhlStaffContactApi(locationId), team);
}

/**
 * Whether a contact being added uses the team notification phone, which makes
 * it the Staff contact. Used by Add Contact / CSV to warn before a test
 * changes staff texts. The team email plays no part: it is never put on the
 * staff contact.
 */
export type StaffOverlap = "none" | "phone";

export function describeStaffOverlap(
  contact: { phone?: string },
  team: StaffTeamValues
): StaffOverlap {
  return samePhone(contact.phone ?? "", team.phone) ? "phone" : "none";
}

export function staffOverlapNotice(
  overlap: StaffOverlap,
  dnd: boolean
): string | null {
  if (overlap === "none") return null;
  if (dnd) {
    return "This phone is your team notification (Staff) phone. Adding it with DND on pauses staff texts until the next staff alert or Alerts save turns DND back off.";
  }
  return "This phone is your team notification (Staff) phone, so this is the Staff contact. It will show in Contacts with a red Staff badge.";
}
