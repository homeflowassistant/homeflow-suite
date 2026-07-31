import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link2, Save, Loader2, ChevronDown, Search, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import CSVUploadFlow from "@/components/CSVUploadFlow";
import "./QuickSendPage.css";

// ─── Merge Fields ────────────────────────────────────────────────────
const MERGE_FIELDS = [
  { name: "Contact ID", tag: "{{contact.id}}" },
  { name: "First Name", tag: "{{contact.first_name}}" },
  { name: "Last Name", tag: "{{contact.last_name}}" },
  { name: "Full Name", tag: "{{contact.name}}" },
  { name: "Email", tag: "{{contact.email}}" },
  { name: "Phone Number", tag: "{{contact.phone}}" },
  { name: "Address", tag: "{{contact.address1}}" },
  { name: "City", tag: "{{contact.city}}" },
  { name: "State", tag: "{{contact.state}}" },
  { name: "Country", tag: "{{contact.country}}" },
  { name: "Postal Code", tag: "{{contact.postal_code}}" },
  { name: "Company", tag: "{{contact.company_name}}" },
  { name: "Website", tag: "{{contact.website}}" },
  { name: "Birthday", tag: "{{contact.birthday}}" },
  { name: "Contact Owner", tag: "{{contact.contact_owner}}" },
  { name: "Tags", tag: "{{contact.tags}}" },
  { name: "Location Name", tag: "{{location.name}}" },
  { name: "Location Phone", tag: "{{location.phone}}" },
  { name: "Location Address", tag: "{{location.address}}" },
  { name: "Location City", tag: "{{location.city}}" },
  { name: "Location State", tag: "{{location.state}}" },
  { name: "Location Country", tag: "{{location.country}}" },
  { name: "Custom Field (by key)", tag: "{{custom_values.your_field_key}}" },
];

// ─── GHL Contact Type ────────────────────────────────────────────────
interface GHLContact {
  id: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────
function useLocationId() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("locationId") || "";
  }, []);
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

// ─── Merge Field Dropdown Component ──────────────────────────────────
function MergeFieldDropdown({
  onSelect,
  onClose,
}: {
  onSelect: (tag: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return MERGE_FIELDS;
    const q = query.toLowerCase();
    return MERGE_FIELDS.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.tag.toLowerCase().includes(q)
    );
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="qs-merge-dropdown">
      <input
        ref={inputRef}
        className="qs-merge-search"
        type="text"
        placeholder="Search fields..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && filtered.length > 0) {
            onSelect(filtered[0].tag);
          }
        }}
      />
      {filtered.length === 0 && (
        <div style={{ padding: "12px 14px", fontSize: 13, color: "#94a3b8" }}>
          No fields found
        </div>
      )}
      {filtered.map((field) => (
        <button
          key={field.tag}
          type="button"
          className="qs-merge-field-item"
          onClick={() => {
            onSelect(field.tag);
            onClose();
          }}
        >
          <span className="qs-merge-field-icon" />
          <span className="qs-merge-field-name">{field.name}</span>
          <span className="qs-merge-field-tag">{field.tag}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Tab Types ───────────────────────────────────────────────────────
type ModalTab = "contacts" | "csv";

// ─── Contact Selection Modal ─────────────────────────────────────────
function ContactSelectionModal({
  open,
  onClose,
  locationId,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  locationId: string;
  onConfirm: (contactIds: string[] | "all") => void;
}) {
  const [tab, setTab] = useState<ModalTab>("contacts");
  const [allContacts, setAllContacts] = useState<GHLContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);

  // tRPC query for fetching contacts
  const contactsQuery = trpc.quickSend.getContacts.useQuery(
    {
      locationId,
      search: searchQuery.trim() || undefined,
      page: 1,
      pageSize: searchQuery.trim() ? 50 : 100,
    },
    {
      enabled: open && !!locationId,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    }
  );

  // Loading state from query
  useEffect(() => {
    setLoading(contactsQuery.isLoading);
  }, [contactsQuery.isLoading]);

  // Update contacts from query result
  useEffect(() => {
    if (contactsQuery.data?.contacts) {
      setAllContacts(contactsQuery.data.contacts);
    }
  }, [contactsQuery.data]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set());
      setSelectAll(false);
      setSearchQuery("");
      setTab("contacts");
    }
  }, [open]);

  const toggleSelectAll = () => {
    setSelectAll(!selectAll);
    if (!selectAll) {
      setSelectedIds(new Set(allContacts.map((c) => c.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const toggleContact = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return allContacts;
    const q = searchQuery.toLowerCase();
    return allContacts.filter((c) => {
      const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ");
      return (
        fullName.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.phone?.includes(q)
      );
    });
  }, [allContacts, searchQuery]);

  const selectedCount = selectedIds.size;
  const isConfirmDisabled = selectedCount === 0 && !selectAll;

  // Handle close with Esc key
  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="qs-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="qs-modal-content qs-modal-content--large" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="qs-modal-header">
          <h3 className="qs-modal-title">Save & Send</h3>
          <p className="qs-modal-subtitle">
            Choose which contacts should receive this message. They will be tagged with "quick-send".
          </p>

          {/* Tab Switcher */}
          <div className="qs-modal-tabs">
            <button
              type="button"
              className={`qs-modal-tab ${tab === "contacts" ? "qs-modal-tab--active" : ""}`}
              onClick={() => setTab("contacts")}
            >
              <Users size={16} />
              Select Contacts
            </button>
            <button
              type="button"
              className={`qs-modal-tab ${tab === "csv" ? "qs-modal-tab--active" : ""}`}
              onClick={() => setTab("csv")}
            >
              <Upload size={16} />
              Upload CSV
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="qs-modal-body">
          {tab === "contacts" ? (
            <>
              {/* All Contacts Toggle */}
              <div
                className={`qs-all-contacts ${selectAll ? "qs-all-contacts--active" : ""}`}
                onClick={toggleSelectAll}
              >
                <div
                  className="qs-contact-check"
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 5,
                    border: `2px solid ${selectAll ? "#38bdf8" : "#94a3b8"}`,
                    background: selectAll ? "#38bdf8" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {selectAll && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <span className="qs-all-contacts-label">All Contacts</span>
                <span className="qs-all-contacts-count">
                  {contactsQuery.data?.total ?? allContacts.length} contacts
                </span>
              </div>

              {/* Search */}
              <div className="qs-contact-search">
                <Search className="qs-search-icon" size={16} />
                <input
                  className="qs-contact-search-input"
                  type="text"
                  placeholder="Search contacts by name, email, or phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Loading */}
              {loading && (
                <div style={{ textAlign: "center", padding: "24px 0" }}>
                  <Loader2 className="qs-spinner" size={24} style={{ color: "#38bdf8", margin: "0 auto" }} />
                </div>
              )}

              {/* Contact List */}
              {!loading && (
                <div className="qs-contact-list">
                  {filteredContacts.length === 0 && (
                    <div style={{ textAlign: "center", padding: "24px 0", color: "#94a3b8", fontSize: 14 }}>
                      {contactsQuery.isError ? "Failed to load contacts" : "No contacts found"}
                    </div>
                  )}
                  {filteredContacts.map((contact) => {
                    const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.name || "Unknown";
                    const isSelected = selectedIds.has(contact.id);
                    return (
                      <div
                        key={contact.id}
                        className={`qs-contact-item ${isSelected ? "qs-contact-item--selected" : ""}`}
                        onClick={() => toggleContact(contact.id)}
                      >
                        <div className="qs-contact-avatar">
                          {getInitials(fullName)}
                        </div>
                        <div className="qs-contact-info">
                          <div className="qs-contact-name">{fullName}</div>
                          <div className="qs-contact-detail">
                            {[contact.email, contact.phone].filter(Boolean).join(" · ") || "No details"}
                          </div>
                        </div>
                        <div
                          className="qs-contact-check"
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 5,
                            border: `2px solid ${isSelected ? "#38bdf8" : "#cbd5e1"}`,
                            background: isSelected ? "#38bdf8" : "transparent",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          {isSelected && (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            /* CSV Upload Tab */
            <div className="qs-csv-upload-section">
              <p className="qs-csv-upload-hint">
                Upload a CSV file to import contacts. All imported contacts will be automatically tagged with <strong>"quick-send"</strong>.
              </p>
              <CSVUploadFlow
                locationId={locationId}
                fixedTag="quick-send"
              />
            </div>
          )}
        </div>

        {/* Footer — only show for contacts tab */}
        {tab === "contacts" && (
          <div className="qs-modal-footer">
            <span className="qs-selected-count">
              {selectAll
                ? `${contactsQuery.data?.total ?? allContacts.length} contacts selected`
                : `${selectedCount} contact${selectedCount !== 1 ? "s" : ""} selected`}
            </span>
            <div className="qs-modal-footer-actions">
              <button
                type="button"
                onClick={onClose}
                className="qs-modal-btn qs-modal-btn--cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isConfirmDisabled}
                onClick={() => {
                  onConfirm(selectAll ? "all" : Array.from(selectedIds));
                }}
                className="qs-modal-btn qs-modal-btn--confirm"
              >
                Confirm
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page Component ─────────────────────────────────────────────
export default function QuickSendPage() {
  const locationId = useLocationId();
  const [message, setMessage] = useState("");
  const [showMergeDropdown, setShowMergeDropdown] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // tRPC mutation for saving
  const saveMutation = trpc.quickSend.saveMessage.useMutation();

  const showToast = useCallback((msg: string, isError = false) => {
    toast(msg, {
      style: isError
        ? { background: "var(--destructive)", color: "var(--destructive-foreground)" }
        : undefined,
    });
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowMergeDropdown(false);
      }
    };
    if (showMergeDropdown) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMergeDropdown]);

  // Insert merge field at cursor position
  const insertMergeField = useCallback(
    (tag: string) => {
      const ta = textareaRef.current;
      if (!ta) {
        setMessage((prev) => prev + tag);
        return;
      }
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const text = ta.value;
      const newText = text.substring(0, start) + tag + text.substring(end);
      setMessage(newText);
      setTimeout(() => {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = start + tag.length;
      }, 0);
    },
    []
  );

  // Handle save
  const handleSave = useCallback(
    async (selection: string[] | "all") => {
      setIsSaving(true);
      setShowModal(false);
      try {
        const result = await saveMutation.mutateAsync({
          locationId,
          message: message.trim(),
          contactSelection: selection === "all" ? "all" : "selected",
          contactIds: selection === "all" ? [] : selection,
        });

        const { contactsTagged } = result;
        let successMsg = "Message saved successfully.";
        if (contactsTagged) {
          successMsg += ` ${contactsTagged.tagged} contact${contactsTagged.tagged !== 1 ? "s" : ""} tagged with "quick-send".`;
          if (contactsTagged.failed > 0) {
            successMsg += ` ${contactsTagged.failed} failed.`;
          }
        }
        showToast(successMsg);
      } catch (err) {
        showToast(
          `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
          true
        );
      } finally {
        setIsSaving(false);
      }
    },
    [locationId, message, saveMutation, showToast]
  );

  // Missing locationId guard
  if (!locationId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Link2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">Quick Send</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Add this page as a GHL custom menu link with the{" "}
            <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
              /quick-send?locationId=YOUR_LOCATION_ID
            </code>{" "}
            URL.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="qs-main">
      <div className="qs-shell">
        {/* ── Page Header ── */}
        <header className="qs-page-header">
          <h1 className="qs-main-title">Quick Send</h1>
          <p className="qs-description">
            Quick Send lets you send a one-time text message to customers. Perfect for promoting add-ons, seasonal reminders, referral offers, weather delays, service updates, or special promotions. A fast, simple way to stay top of mind, bring in extra revenue, and get more responses without long follow-up campaigns or extra back and forth. Messages may be spread out help protect delivery.
          </p>
          <h2 className="qs-how-title">How It works:</h2>
          <div className="qs-how-steps">
            <p className="qs-how-step">1. Save custom message</p>
            <p className="qs-how-step">2. Add your contacts to the "Quick Send" campaign</p>
            <p className="qs-how-step">3. Click "Send Message" on this page</p>
          </div>
        </header>

        {/* ── Content Card: Message Form + Phone Preview ── */}
        <div className="qs-content-card">
          {/* ── Message Column ── */}
          <div className="qs-message-col">
            <h2 className="qs-message-card-title">Custom Message</h2>

            {/* Textarea with relative positioning for dropdown */}
            <div style={{ position: "relative" }}>
              <textarea
                ref={textareaRef}
                className="qs-message-textarea"
                placeholder="Hi, due to the weather, we are unable to come out today. We will see you next week. If you have any questions, text/call us at: (801) 111-1234"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={1600}
              />

              {/* Merge Field Dropdown */}
              {showMergeDropdown && (
                <div ref={dropdownRef}>
                  <MergeFieldDropdown
                    onSelect={insertMergeField}
                    onClose={() => setShowMergeDropdown(false)}
                  />
                </div>
              )}
            </div>

            {/* Merge Fields Bar */}
            <div className="qs-merge-bar" style={{ position: "relative" }}>
              <span className="qs-merge-label">Add Custom Value:</span>
              <button
                type="button"
                className="qs-merge-trigger"
                onClick={() => setShowMergeDropdown(!showMergeDropdown)}
              >
                <ChevronDown size={14} />
                Choose Value
              </button>
            </div>

            {/* Save Button */}
            <div className="qs-save-bar">
              <button
                type="button"
                className="qs-save-btn"
                onClick={() => {
                  if (!message.trim()) {
                    showToast("Please enter a message before saving.", true);
                    return;
                  }
                  setShowModal(true);
                }}
                disabled={isSaving || saveMutation.isPending}
              >
                {isSaving || saveMutation.isPending ? (
                  <>
                    <Loader2 className="qs-spinner" size={18} />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save size={18} />
                    Save and Send
                  </>
                )}
              </button>
            </div>
          </div>

          {/* ── Phone Preview Column ── */}
          <div className="qs-phone-col">
            <div className="qs-phone-frame">
              <div className="qs-phone-island" />
              <div className="qs-phone-btn qs-phone-btn--mute" />
              <div className="qs-phone-btn qs-phone-btn--vol-up" />
              <div className="qs-phone-btn qs-phone-btn--vol-down" />
              <div className="qs-phone-btn qs-phone-btn--power" />
              <div className="qs-phone-screen">
                <div className="qs-phone-statusbar">
                  <span>9:41</span>
                  <div className="qs-phone-statusbar-icons">
                    <svg width="16" height="11" viewBox="0 0 16 11" fill="none"><rect x="0" y="6" width="2.5" height="5" rx="0.5" fill="currentColor"/><rect x="4.5" y="4" width="2.5" height="7" rx="0.5" fill="currentColor"/><rect x="9" y="2" width="2.5" height="9" rx="0.5" fill="currentColor"/><rect x="13.5" y="0" width="2.5" height="11" rx="0.5" fill="currentColor" opacity="0.4"/></svg>
                    <svg width="20" height="11" viewBox="0 0 20 11" fill="none"><rect x="0.5" y="0.5" width="17" height="10" rx="2.5" stroke="currentColor"/><rect x="2" y="2" width="14" height="7" rx="1.5" fill="currentColor"/><rect x="18.5" y="3.5" width="1.5" height="4" rx="0.75" fill="currentColor"/></svg>
                  </div>
                </div>
                <div
                  className={`qs-phone-bubble ${!message.trim() ? "qs-phone-bubble--empty" : ""}`}
                >
                  {message.trim() || "Your message preview will appear here..."}
                </div>
                <div className="qs-phone-home-indicator" />
              </div>
            </div>
          </div>
        </div>

        {/* ── Contact Selection Modal ── */}
        <ContactSelectionModal
          open={showModal}
          onClose={() => setShowModal(false)}
          locationId={locationId}
          onConfirm={handleSave}
        />
      </div>
    </div>
  );
}
