import { describe, expect, it } from "vitest";
import {
  describeStaffOverlap,
  pickStaffCandidate,
  resolveStaffContactForSendWith,
  staffOverlapNotice,
  syncStaffContactWith,
  type StaffContactApi,
  type StaffContactRecord,
} from "./staff-contact-service.js";
import {
  filterStaffContacts,
  isHiddenStaffContact,
  normalizeContact,
} from "../routers/contacts.js";

const TEAM = { email: "team@example.com", phone: "(801) 808-6639" };
const TEAM_E164 = "+18018086639";

/** In-memory GHL used to exercise every staff-contact case. */
function fakeGhl(initial: StaffContactRecord[]) {
  const contacts = new Map<string, StaffContactRecord>(
    initial.map(contact => [String(contact.id), { tags: [], ...contact }])
  );
  const state = { created: 0, updates: [] as Array<[string, Record<string, unknown>]> };
  let nextId = 1;
  const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "").slice(-10);

  const api: StaffContactApi = {
    async getContact(id) {
      const contact = contacts.get(id);
      return contact ? { ...contact } : null;
    },
    async searchContacts(text) {
      const needle = text.toLowerCase();
      return Array.from(contacts.values()).filter(contact => {
        const name = `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.toLowerCase();
        return (
          name.includes(needle) ||
          String(contact.email ?? "").toLowerCase() === needle ||
          (digits(needle).length === 10 && digits(contact.phone) === digits(needle))
        );
      });
    },
    async findByTag(tag) {
      return Array.from(contacts.values()).filter(contact =>
        ((contact.tags as string[]) ?? []).includes(tag)
      );
    },
    async findDuplicateByPhone() {
      return null;
    },
    async createContact(payload) {
      const owner = Array.from(contacts.values()).find(
        contact => digits(contact.phone) === digits(payload.phone)
      );
      if (owner) return { duplicateOf: String(owner.id) };
      const id = `new${nextId++}`;
      contacts.set(id, { id, ...payload });
      state.created += 1;
      return { id };
    },
    async updateContact(id, payload) {
      const contact = contacts.get(id);
      if (!contact) return false;
      // Like GHL: a phone already owned by another contact is rejected.
      const taken = Array.from(contacts.values()).some(
        other => other.id !== id && payload.phone && digits(other.phone) === digits(payload.phone)
      );
      if (taken) return false;
      state.updates.push([id, payload]);
      Object.assign(contact, payload);
      return true;
    },
    async addTag(id, tag) {
      const contact = contacts.get(id)!;
      contact.tags = [...((contact.tags as string[]) ?? []), tag];
    },
    async removeTag(id, tag) {
      const contact = contacts.get(id)!;
      contact.tags = ((contact.tags as string[]) ?? []).filter(t => t !== tag);
    },
  };
  return { api, contacts, state };
}

const tagsOf = (contact: StaffContactRecord | undefined) =>
  (contact?.tags as string[]) ?? [];

const staffTagged = (contacts: Map<string, StaffContactRecord>) =>
  Array.from(contacts.values()).filter(contact => tagsOf(contact).includes("staff"));

describe("syncStaffContactWith", () => {
  it("case 1: no staff tag anywhere → creates one tagged Staff contact from the team values", async () => {
    const { api, contacts, state } = fakeGhl([]);
    const result = await syncStaffContactWith(api, TEAM);
    expect(result.created).toBe(true);
    expect(state.created).toBe(1);
    const staff = contacts.get(result.contactId)!;
    expect(staff.firstName).toBe("Staff");
    expect(staff.email).toBe(TEAM.email);
    expect(staff.phone).toBe(TEAM_E164);
    expect(staffTagged(contacts).map(c => c.id)).toEqual([result.contactId]);
  });

  it("case 2: the team phone/email already belongs to a contact → tags it, keeps its name", async () => {
    const { api, contacts, state } = fakeGhl([
      { id: "owner", firstName: "Brent", lastName: "Winterton", email: TEAM.email, phone: "8018086639" },
    ]);
    const result = await syncStaffContactWith(api, TEAM);
    expect(result.contactId).toBe("owner");
    expect(result.adopted).toBe(true);
    expect(state.created).toBe(0);
    expect(contacts.get("owner")!.firstName).toBe("Brent");
    expect(staffTagged(contacts).map(c => c.id)).toEqual(["owner"]);
  });

  it("case 3: saving again with the same values changes nothing and creates nothing", async () => {
    const { api, contacts, state } = fakeGhl([
      { id: "s1", firstName: "Brent", email: TEAM.email, phone: TEAM_E164, tags: ["staff", "homeflow: inactive customer"] },
    ]);
    const result = await syncStaffContactWith(api, TEAM);
    expect(result.contactId).toBe("s1");
    expect(state.created).toBe(0);
    expect(state.updates).toHaveLength(0);
    expect(contacts.get("s1")!.firstName).toBe("Brent");
  });

  it("case 4: restores the team phone when a test add-contact changed it", async () => {
    const { api, contacts } = fakeGhl([
      { id: "s1", firstName: "Brent", email: TEAM.email, phone: "+15550001111", tags: ["staff"] },
    ]);
    const result = await syncStaffContactWith(api, TEAM);
    expect(result.contactId).toBe("s1");
    expect(result.restored).toBe(true);
    expect(contacts.get("s1")!.phone).toBe(TEAM_E164);
  });

  it("case 6: turns SMS DND back off on the staff contact", async () => {
    const { api, contacts } = fakeGhl([
      { id: "s1", firstName: "Staff", email: TEAM.email, phone: TEAM_E164, dnd: true, tags: ["staff"] },
    ]);
    const result = await syncStaffContactWith(api, TEAM);
    expect(result.restored).toBe(true);
    expect(contacts.get("s1")!.dnd).toBe(false);
  });

  it("case 7: new team email and phone update the same tagged contact, no new contact", async () => {
    const { api, contacts, state } = fakeGhl([
      { id: "s1", firstName: "Staff", email: "old@example.com", phone: "+15550001111", tags: ["staff"] },
    ]);
    const result = await syncStaffContactWith(api, { email: "new@example.com", phone: "801-808-6639" });
    expect(result.contactId).toBe("s1");
    expect(state.created).toBe(0);
    expect(contacts.get("s1")!.phone).toBe(TEAM_E164);
    expect(contacts.get("s1")!.email).toBe("new@example.com");
    expect(staffTagged(contacts).map(c => c.id)).toEqual(["s1"]);
  });

  it("case 8: new team phone already owned by another contact → the tag moves there", async () => {
    const { api, contacts, state } = fakeGhl([
      { id: "old", firstName: "Staff", phone: "+15550001111", tags: ["staff"] },
      { id: "owner", firstName: "Brent", phone: TEAM_E164 },
    ]);
    const result = await syncStaffContactWith(api, TEAM);
    expect(result.contactId).toBe("owner");
    expect(result.adopted).toBe(true);
    expect(state.created).toBe(0);
    expect(staffTagged(contacts).map(c => c.id)).toEqual(["owner"]);
    expect(result.untaggedIds).toEqual(["old"]);
  });

  it("case 9: the tagged contact was deleted → a new one is created", async () => {
    const { api, contacts } = fakeGhl([]);
    const first = await syncStaffContactWith(api, TEAM);
    contacts.delete(first.contactId);
    const second = await syncStaffContactWith(api, TEAM);
    expect(second.created).toBe(true);
    expect(staffTagged(contacts).map(c => c.id)).toEqual([second.contactId]);
  });

  it("case 10: several contacts tagged staff → keeps the oldest, untags the rest", async () => {
    const { api, contacts, state } = fakeGhl([
      { id: "newer", firstName: "Jane", phone: "+15550002222", tags: ["staff"], dateAdded: "2026-03-01" },
      { id: "oldest", firstName: "Staff", phone: "+15550003333", tags: ["staff"], dateAdded: "2026-01-01" },
      { id: "mid", firstName: "Bob", phone: "+15550004444", tags: ["staff", "vip"], dateAdded: "2026-02-01" },
    ]);
    const result = await syncStaffContactWith(api, TEAM);
    expect(result.contactId).toBe("oldest");
    expect(state.created).toBe(0);
    expect(contacts.get("oldest")!.phone).toBe(TEAM_E164);
    expect(staffTagged(contacts).map(c => c.id)).toEqual(["oldest"]);
    expect(result.untaggedIds.sort()).toEqual(["mid", "newer"]);
    // Untagged contacts are kept with their other tags.
    expect(tagsOf(contacts.get("mid"))).toEqual(["vip"]);
  });

  it("case 12: requires a team phone", async () => {
    const { api } = fakeGhl([]);
    await expect(syncStaffContactWith(api, { email: "a@b.com", phone: "" })).rejects.toMatchObject({
      code: "STAFF_PHONE_REQUIRED",
    });
  });
});

describe("pickStaffCandidate (case 11)", () => {
  it("prefers the staff-tagged contact, then the oldest", () => {
    expect(
      pickStaffCandidate([
        { id: "a", dateAdded: "2026-01-01" },
        { id: "b", dateAdded: "2026-03-01", tags: ["staff"] },
      ])?.id
    ).toBe("b");
    expect(
      pickStaffCandidate([
        { id: "late", dateAdded: "2026-03-01" },
        { id: "early", dateAdded: "2026-01-01" },
      ])?.id
    ).toBe("early");
  });
});

describe("resolveStaffContactForSendWith", () => {
  it("sends to the one tagged contact when its phone matches and SMS is allowed", async () => {
    const { api, state } = fakeGhl([
      { id: "s1", firstName: "Staff", phone: TEAM_E164, tags: ["staff"] },
    ]);
    const contact = await resolveStaffContactForSendWith(api, TEAM);
    expect(contact.id).toBe("s1");
    expect(state.updates).toHaveLength(0);
  });

  it("creates the staff contact on first send when nothing is tagged", async () => {
    const { api, contacts } = fakeGhl([]);
    const contact = await resolveStaffContactForSendWith(api, TEAM);
    expect(contact.phone).toBe(TEAM_E164);
    expect(staffTagged(contacts)).toHaveLength(1);
  });

  it("re-syncs before sending when the phone was changed (case 4)", async () => {
    const { api } = fakeGhl([
      { id: "s1", firstName: "Brent", phone: "+15550001111", tags: ["staff"] },
    ]);
    const contact = await resolveStaffContactForSendWith(api, TEAM);
    expect(contact.id).toBe("s1");
    expect(contact.phone).toBe(TEAM_E164);
  });

  it("cleans up to one tagged contact before sending when several have the tag", async () => {
    const { api, contacts } = fakeGhl([
      { id: "a", phone: TEAM_E164, tags: ["staff"], dateAdded: "2026-01-01" },
      { id: "b", phone: "+15550002222", tags: ["staff"], dateAdded: "2026-02-01" },
    ]);
    const contact = await resolveStaffContactForSendWith(api, TEAM);
    expect(contact.id).toBe("a");
    expect(staffTagged(contacts).map(c => c.id)).toEqual(["a"]);
  });

  it("fails clearly when no team phone is saved (case 12)", async () => {
    const { api } = fakeGhl([]);
    await expect(
      resolveStaffContactForSendWith(api, { email: "", phone: "" })
    ).rejects.toMatchObject({ code: "STAFF_PHONE_CUSTOM_VALUE_REQUIRED" });
  });
});

describe("Add Contact / CSV staff notices", () => {
  it("classifies how a new contact overlaps the team values", () => {
    expect(describeStaffOverlap({ email: "TEAM@example.com", phone: "+18018086639" }, TEAM)).toBe("both");
    expect(describeStaffOverlap({ email: "team@example.com", phone: "5551112222" }, TEAM)).toBe("email_only");
    expect(describeStaffOverlap({ email: "x@y.com", phone: "8018086639" }, TEAM)).toBe("phone_only");
    expect(describeStaffOverlap({ email: "x@y.com", phone: "5551112222" }, TEAM)).toBe("none");
  });

  it("warns about DND and mismatched phone, stays quiet otherwise", () => {
    expect(staffOverlapNotice("none", true)).toBeNull();
    expect(staffOverlapNotice("both", true)).toMatch(/DND/);
    expect(staffOverlapNotice("email_only", false)).toMatch(/phone is different/);
    expect(staffOverlapNotice("both", false)).toMatch(/Staff badge/);
  });
});

describe("Contacts list visibility", () => {
  const staffOnly = normalizeContact({ id: "s", tags: ["staff"] });
  const staffTesting = normalizeContact({ id: "t", tags: ["staff", "homeflow: inactive customer"] });
  const regular = normalizeContact({ id: "r", tags: ["new lead (via homeflow)"] });

  it("hides the staff contact until it joins a campaign", () => {
    expect(isHiddenStaffContact(staffOnly)).toBe(true);
    expect(isHiddenStaffContact(staffTesting)).toBe(false);
    expect(filterStaffContacts([staffOnly, staffTesting, regular]).map(c => c.id)).toEqual(["t", "r"]);
  });

  it("flags staff contacts for the red badge", () => {
    expect(staffTesting.isStaff).toBe(true);
    expect(regular.isStaff).toBe(false);
  });
});
