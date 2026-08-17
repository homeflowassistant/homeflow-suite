import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Save, Check, Copy, X, Tag } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { CustomVariablePicker } from "@/components/CustomVariablePicker";
import "./AlertsNotificationsPage.css";

// Dynamic merge tag helpers for the modal
const MERGE_TAGS = [
  { code: "{{location.name}}", label: "Business / Location Name" },
  { code: "{{name}}", label: "Contact Full Name" },
  { code: "{{first_name}}", label: "Contact First Name" },
  { code: "{{phone}}", label: "Contact Phone Number" },
  { code: "{{email}}", label: "Contact Email Address" },
  { code: "{{address}}", label: "Street Address / City" },
  { code: "{{dogs}}", label: "Number of Dogs" },
  { code: "{{frequency}}", label: "Service Frequency" },
];

function useLocationId() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("locationId") || params.get("location_id") || "test-location";
  }, []);
}

// ── Custom Cyan Toggle Switch Component ────────────────────────────────
interface ToggleSwitchProps {
  isOn: boolean;
  onToggle: () => void;
  id?: string;
}

function ToggleSwitch({ isOn, onToggle, id }: ToggleSwitchProps) {
  return (
    <button
      id={id}
      type="button"
      className="alerts-toggle-switch"
      onClick={onToggle}
      aria-pressed={isOn}
    >
      <div className={`alerts-toggle-track ${isOn ? "is-on" : ""}`}>
        <span className="alerts-toggle-text">{isOn ? "ON" : "OFF"}</span>
        <div className="alerts-toggle-thumb" />
      </div>
    </button>
  );
}

// ── Chat Bubble Display & Inline Editor Component ──────────────────────
interface ChatBubbleProps {
  pickerId: string;
  value: string;
  onChange: (val: string) => void;
  isEditing: boolean;
  onStartEditing: () => void;
  onStopEditing: () => void;
  activePickerId: string | null;
  onTogglePicker: (id: string) => void;
  onCaretChange: (start: number, end: number) => void;
  pickerComponent: React.ReactNode;
  disabled?: boolean;
}

function ChatBubble({
  pickerId,
  value,
  onChange,
  isEditing,
  onStartEditing,
  onStopEditing,
  activePickerId,
  onTogglePicker,
  onCaretChange,
  pickerComponent,
  disabled = false,
}: ChatBubbleProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isPickerOpen = activePickerId === pickerId;

  const handleSelectionChange = () => {
    if (textareaRef.current) {
      onCaretChange(
        textareaRef.current.selectionStart || 0,
        textareaRef.current.selectionEnd || 0
      );
    }
  };

  // If disabled while editing, stop editing automatically
  useEffect(() => {
    if (disabled && isEditing) {
      onStopEditing();
    }
  }, [disabled, isEditing, onStopEditing]);

  if (disabled) {
    return (
      <div className="alerts-chat-bubble-wrapper is-disabled relative">
        <div className="alerts-chat-bubble pr-10">
          <span className="alerts-bubble-disabled-hint">(Disabled when toggle is OFF)</span>
          {value || <span className="italic text-slate-400">Empty message</span>}
        </div>
        <button
          type="button"
          className="alerts-picker-trigger"
          disabled
          title="Field is disabled when toggle is OFF"
          aria-label="Insert custom variable (disabled)"
        >
          <Tag className="w-4 h-4 opacity-40" />
        </button>
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="alerts-editor-container space-y-2">
        <div className="relative">
          <textarea
            ref={textareaRef}
            className="alerts-chat-bubble-textarea pr-10"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              handleSelectionChange();
            }}
            onClick={handleSelectionChange}
            onKeyUp={handleSelectionChange}
            onSelect={handleSelectionChange}
            autoFocus
            rows={4}
          />
          <button
            type="button"
            className="alerts-picker-trigger"
            onClick={(e) => {
              e.stopPropagation();
              handleSelectionChange();
              onTogglePicker(pickerId);
            }}
            title="Insert GHL custom value or field"
            aria-label="Insert custom variable"
          >
            <Tag className="w-4 h-4" />
          </button>
          {isPickerOpen && pickerComponent}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="px-3 py-1 text-xs font-bold bg-slate-200 text-slate-700 rounded-md hover:bg-slate-300"
            onClick={onStopEditing}
          >
            Done Editing
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="alerts-chat-bubble-wrapper relative" onClick={onStartEditing}>
      <div className="alerts-chat-bubble pr-10">
        {value}
      </div>
      <button
        type="button"
        className="alerts-picker-trigger"
        onClick={(e) => {
          e.stopPropagation();
          onStartEditing();
          setTimeout(() => {
            onTogglePicker(pickerId);
          }, 50);
        }}
        title="Insert GHL custom value or field"
        aria-label="Insert custom variable"
      >
        <Tag className="w-4 h-4" />
      </button>
      {isPickerOpen && pickerComponent}
    </div>
  );
}

// ── Main Alerts & Notifications Page ──────────────────────────────────
export default function AlertsNotificationsPage() {
  const locationId = useLocationId();
  const isPreviewMode = false;

  // Active picker state & caret range tracking
  const [activePickerId, setActivePickerId] = useState<string | null>(null);
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number }>({
    start: 0,
    end: 0,
  });

  // State management for all toggles & fields
  const [autoReplyNewLeadEnabled, setAutoReplyNewLeadEnabled] = useState(true);
  const [autoReplyNewLeadMessage, setAutoReplyNewLeadMessage] = useState(
    "Thanks for contacting {{location.name}}! We've received your request and will be in touch shortly. We look forward to helping you enjoy a cleaner, poop-free yard!"
  );

  const [autoReplyNewCustomerEnabled, setAutoReplyNewCustomerEnabled] = useState(true);
  const [autoReplyNewCustomerMessage, setAutoReplyNewCustomerMessage] = useState(
    "Thanks for signing up with {{location.name}}! We look forward to keeping your yard clean and enjoyable year-round."
  );

  const [teamNotifyNewLeadEnabled, setTeamNotifyNewLeadEnabled] = useState(true);
  const [teamNotifyNewLeadMessage, setTeamNotifyNewLeadMessage] = useState(
    "New Lead Received:\nName: {{name}}\nPhone: {{phone}}\nEmail: {{email}}\nCity: {{address}}\nDogs: {{dogs}}\nFrequency: {{frequency}}\nGive them a call!"
  );

  const [teamNotifyNewCustomerEnabled, setTeamNotifyNewCustomerEnabled] = useState(true);
  const [teamNotifyNewCustomerMessage, setTeamNotifyNewCustomerMessage] = useState(
    "New Customer Sign Up!\nName:\nPhone:\nEmail:\nCity:\n\nPlease assign the customer to a route"
  );

  const [teamNotifyPhone, setTeamNotifyPhone] = useState("");
  const [teamNotifyEmail, setTeamNotifyEmail] = useState("");

  const [failedPaymentNotifyEnabled, setFailedPaymentNotifyEnabled] = useState(true);
  const [failedPaymentNotifyMessage, setFailedPaymentNotifyMessage] = useState(
    "Hi John, we were unable to process your recent payment. To avoid any interruption in service, please update your payment method using the secure link below:"
  );

  const [skippedJobNotifyEnabled, setSkippedJobNotifyEnabled] = useState(true);
  const [skippedJobNotifyMessage, setSkippedJobNotifyMessage] = useState(
    "Hi John, due to your gate being locked, we were unable to complete your scheduled service. We apologize for the inconvenience and will be back on your next service day. Thank you for your patience!"
  );

  const [subscriptionPausedNotifyEnabled, setSubscriptionPausedNotifyEnabled] = useState(true);
  const [subscriptionPausedNotifyMessage, setSubscriptionPausedNotifyMessage] = useState(
    "Hi John, your service pause has been removed, and your recurring cleanups will resume as scheduled, as requested. Thank you for trusting {{location.name}}!"
  );

  // Active inline editor key & modal state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [showPromptsModal, setShowPromptsModal] = useState(false);
  const [copiedTag, setCopiedTag] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Condition: Both Team Notifications toggles are off
  const isTeamNotifyDisabled = !teamNotifyNewLeadEnabled && !teamNotifyNewCustomerEnabled;

  // tRPC queries & mutations
  const settingsQuery = trpc.alertsNotifications.getSettings.useQuery(
    { locationId: locationId || "test-location" },
    { enabled: true }
  );

  const pickerVariablesQuery = trpc.alertsNotifications.getPickerVariables.useQuery(
    { locationId: locationId || "test-location" },
    { enabled: true }
  );

  const saveMutation = trpc.alertsNotifications.saveSettings.useMutation();

  // Populate settings when query returns data
  useEffect(() => {
    if (!settingsQuery.data) return;
    const d = settingsQuery.data;

    setAutoReplyNewLeadEnabled(d.autoReplyNewLeadEnabled);
    if (d.autoReplyNewLeadMessage) setAutoReplyNewLeadMessage(d.autoReplyNewLeadMessage);

    setAutoReplyNewCustomerEnabled(d.autoReplyNewCustomerEnabled);
    if (d.autoReplyNewCustomerMessage) setAutoReplyNewCustomerMessage(d.autoReplyNewCustomerMessage);

    setTeamNotifyNewLeadEnabled(d.teamNotifyNewLeadEnabled);
    if (d.teamNotifyNewLeadMessage) setTeamNotifyNewLeadMessage(d.teamNotifyNewLeadMessage);

    setTeamNotifyNewCustomerEnabled(d.teamNotifyNewCustomerEnabled);
    if (d.teamNotifyNewCustomerMessage) setTeamNotifyNewCustomerMessage(d.teamNotifyNewCustomerMessage);

    setTeamNotifyPhone(d.teamNotifyPhone || "");
    setTeamNotifyEmail(d.teamNotifyEmail || "");

    setFailedPaymentNotifyEnabled(d.failedPaymentNotifyEnabled);
    if (d.failedPaymentNotifyMessage) setFailedPaymentNotifyMessage(d.failedPaymentNotifyMessage);

    setSkippedJobNotifyEnabled(d.skippedJobNotifyEnabled);
    if (d.skippedJobNotifyMessage) setSkippedJobNotifyMessage(d.skippedJobNotifyMessage);

    setSubscriptionPausedNotifyEnabled(d.subscriptionPausedNotifyEnabled);
    if (d.subscriptionPausedNotifyMessage) setSubscriptionPausedNotifyMessage(d.subscriptionPausedNotifyMessage);
  }, [settingsQuery.data]);

  // Insert selected token into active field
  const handleSelectToken = useCallback(
    (fieldKey: string, token: string) => {
      const fieldSetterMap: Record<string, (updater: (prev: string) => string) => void> = {
        autoReplyNewLead: setAutoReplyNewLeadMessage,
        autoReplyNewCustomer: setAutoReplyNewCustomerMessage,
        teamNotifyNewLead: setTeamNotifyNewLeadMessage,
        teamNotifyNewCustomer: setTeamNotifyNewCustomerMessage,
        failedPayment: setFailedPaymentNotifyMessage,
        skippedJob: setSkippedJobNotifyMessage,
        subscriptionPaused: setSubscriptionPausedNotifyMessage,
      };

      const setter = fieldSetterMap[fieldKey];
      if (!setter) return;

      setter((prevText: string) => {
        const start = selectionRange.start ?? prevText.length;
        const end = selectionRange.end ?? prevText.length;
        const textBefore = prevText.slice(0, start);
        const textAfter = prevText.slice(end);
        return textBefore + token + textAfter;
      });

      setActivePickerId(null);
      toast.success(`Inserted ${token}`);
    },
    [selectionRange]
  );

  // Toggle picker popover
  const handleTogglePicker = useCallback((id: string) => {
    setActivePickerId((current) => (current === id ? null : id));
  }, []);

  // Track caret position
  const handleCaretChange = useCallback((start: number, end: number) => {
    setSelectionRange({ start, end });
  }, []);

  // Save handler
  const handleSave = async () => {
    if (!locationId || locationId === "preview" || locationId === "test-location") {
      toast.info(
        "Preview / Test Mode: Settings saved locally. Add ?locationId={{location.id}} in GHL to sync with live client sub-accounts."
      );
      return;
    }

    setIsSaving(true);
    try {
      await saveMutation.mutateAsync({
        locationId,
        autoReplyNewLeadEnabled,
        autoReplyNewLeadMessage: autoReplyNewLeadEnabled ? autoReplyNewLeadMessage : "",
        autoReplyNewCustomerEnabled,
        autoReplyNewCustomerMessage: autoReplyNewCustomerEnabled ? autoReplyNewCustomerMessage : "",
        teamNotifyNewLeadEnabled,
        teamNotifyNewLeadMessage: teamNotifyNewLeadEnabled ? teamNotifyNewLeadMessage : "",
        teamNotifyNewCustomerEnabled,
        teamNotifyNewCustomerMessage: teamNotifyNewCustomerEnabled ? teamNotifyNewCustomerMessage : "",
        teamNotifyPhone: isTeamNotifyDisabled ? "" : teamNotifyPhone,
        teamNotifyEmail: isTeamNotifyDisabled ? "" : teamNotifyEmail,
        failedPaymentNotifyEnabled,
        failedPaymentNotifyMessage: failedPaymentNotifyEnabled ? failedPaymentNotifyMessage : "",
        skippedJobNotifyEnabled,
        skippedJobNotifyMessage: skippedJobNotifyEnabled ? skippedJobNotifyMessage : "",
        subscriptionPausedNotifyEnabled,
        subscriptionPausedNotifyMessage: subscriptionPausedNotifyEnabled ? subscriptionPausedNotifyMessage : "",
      });

      toast.success("Alerts & Notifications settings saved successfully!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyTag = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedTag(code);
    toast.success(`Copied ${code} to clipboard!`);
    setTimeout(() => setCopiedTag(null), 2000);
  };

  // Helper to render picker component for a given field
  const renderPickerForField = (fieldKey: string) => (
    <CustomVariablePicker
      isOpen={activePickerId === fieldKey}
      onClose={() => setActivePickerId(null)}
      onSelectToken={(token) => handleSelectToken(fieldKey, token)}
      data={pickerVariablesQuery.data}
      isLoading={pickerVariablesQuery.isLoading}
      error={pickerVariablesQuery.error ? pickerVariablesQuery.error.message : null}
      disabled={isPreviewMode}
      disabledReason="Connect a GHL sub-account location ID to load custom values and fields."
      onRetry={() => pickerVariablesQuery.refetch()}
    />
  );

  return (
    <div className="alerts-page-shell">
      {/* ── Top Page Header ────────────────────────────────────────────── */}
      <div className="alerts-page-header">
        <div>
          <h1 className="alerts-page-title">Alerts & Notifications</h1>
        </div>
        <button
          type="button"
          className="alerts-save-btn"
          onClick={handleSave}
          disabled={isSaving}
        >
          <Save className="h-4 w-4" />
          {isSaving ? "Saving..." : "Save Settings"}
        </button>
      </div>

      {/* ── Section 1: Auto Replies ────────────────────────────────────── */}
      <section className="alerts-section">
        <h2 className="alerts-section-title">Auto Replies</h2>
        <div className="alerts-card-box">
          <div className="alerts-grid-2">
            {/* Custom New Leads Message */}
            <div className="alerts-item-block">
              <h3 className="alerts-item-title">Custom New Leads Message</h3>
              <ChatBubble
                pickerId="autoReplyNewLead"
                value={autoReplyNewLeadMessage}
                onChange={setAutoReplyNewLeadMessage}
                isEditing={editingKey === "autoReplyNewLead"}
                onStartEditing={() => setEditingKey("autoReplyNewLead")}
                onStopEditing={() => setEditingKey(null)}
                activePickerId={activePickerId}
                onTogglePicker={handleTogglePicker}
                onCaretChange={handleCaretChange}
                pickerComponent={renderPickerForField("autoReplyNewLead")}
                disabled={!autoReplyNewLeadEnabled}
              />
              <div>
                <ToggleSwitch
                  id="toggle-auto-reply-lead"
                  isOn={autoReplyNewLeadEnabled}
                  onToggle={() => setAutoReplyNewLeadEnabled((v) => !v)}
                />
              </div>
            </div>

            {/* Custom New Customer Message */}
            <div className="alerts-item-block">
              <h3 className="alerts-item-title">Custom New Customer Message</h3>
              <ChatBubble
                pickerId="autoReplyNewCustomer"
                value={autoReplyNewCustomerMessage}
                onChange={setAutoReplyNewCustomerMessage}
                isEditing={editingKey === "autoReplyNewCustomer"}
                onStartEditing={() => setEditingKey("autoReplyNewCustomer")}
                onStopEditing={() => setEditingKey(null)}
                activePickerId={activePickerId}
                onTogglePicker={handleTogglePicker}
                onCaretChange={handleCaretChange}
                pickerComponent={renderPickerForField("autoReplyNewCustomer")}
                disabled={!autoReplyNewCustomerEnabled}
              />
              <div>
                <ToggleSwitch
                  id="toggle-auto-reply-customer"
                  isOn={autoReplyNewCustomerEnabled}
                  onToggle={() => setAutoReplyNewCustomerEnabled((v) => !v)}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 2: Team Notifications ──────────────────────────────── */}
      <section className="alerts-section">
        <h2 className="alerts-section-title">Team Notifications</h2>
        <div className="alerts-card-box">
          <div className="alerts-grid-2">
            {/* Custom New Leads Message */}
            <div className="alerts-item-block">
              <h3 className="alerts-item-title">Custom New Leads Message</h3>
              <ChatBubble
                pickerId="teamNotifyNewLead"
                value={teamNotifyNewLeadMessage}
                onChange={setTeamNotifyNewLeadMessage}
                isEditing={editingKey === "teamNotifyNewLead"}
                onStartEditing={() => setEditingKey("teamNotifyNewLead")}
                onStopEditing={() => setEditingKey(null)}
                activePickerId={activePickerId}
                onTogglePicker={handleTogglePicker}
                onCaretChange={handleCaretChange}
                pickerComponent={renderPickerForField("teamNotifyNewLead")}
                disabled={!teamNotifyNewLeadEnabled}
              />
              <div>
                <ToggleSwitch
                  id="toggle-team-lead"
                  isOn={teamNotifyNewLeadEnabled}
                  onToggle={() => setTeamNotifyNewLeadEnabled((v) => !v)}
                />
              </div>
            </div>

            {/* Custom New Customer Message */}
            <div className="alerts-item-block">
              <h3 className="alerts-item-title">Custom New Customer Message</h3>
              <ChatBubble
                pickerId="teamNotifyNewCustomer"
                value={teamNotifyNewCustomerMessage}
                onChange={setTeamNotifyNewCustomerMessage}
                isEditing={editingKey === "teamNotifyNewCustomer"}
                onStartEditing={() => setEditingKey("teamNotifyNewCustomer")}
                onStopEditing={() => setEditingKey(null)}
                activePickerId={activePickerId}
                onTogglePicker={handleTogglePicker}
                onCaretChange={handleCaretChange}
                pickerComponent={renderPickerForField("teamNotifyNewCustomer")}
                disabled={!teamNotifyNewCustomerEnabled}
              />
              <div>
                <ToggleSwitch
                  id="toggle-team-customer"
                  isOn={teamNotifyNewCustomerEnabled}
                  onToggle={() => setTeamNotifyNewCustomerEnabled((v) => !v)}
                />
              </div>
            </div>
          </div>

          {/* Sub-box: Send Team Notifications to: */}
          <div className={`alerts-team-box ${isTeamNotifyDisabled ? "is-disabled" : ""}`}>
            <h4 className="alerts-team-box-title">Send Team Notifications to:</h4>
            <div className="alerts-team-form-grid">
              <div className="alerts-input-row">
                <label htmlFor="team-phone">Phone</label>
                <input
                  id="team-phone"
                  type="text"
                  className="alerts-input-field"
                  placeholder="Enter Phone"
                  value={teamNotifyPhone}
                  onChange={(e) => setTeamNotifyPhone(e.target.value)}
                  disabled={isTeamNotifyDisabled}
                />
              </div>
              <div className="alerts-input-row">
                <label htmlFor="team-email">Email</label>
                <input
                  id="team-email"
                  type="email"
                  className="alerts-input-field"
                  placeholder="Enter Email"
                  value={teamNotifyEmail}
                  onChange={(e) => setTeamNotifyEmail(e.target.value)}
                  disabled={isTeamNotifyDisabled}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 3: Failed Payments & Skipped Job ────────────────────── */}
      <section className="alerts-section">
        <div className="alerts-grid-2">
          {/* Left Column: Failed Payments Notifications */}
          <div>
            <h2 className="alerts-section-title">Failed Payments Notifications</h2>
            <div className="alerts-card-box">
              <div className="alerts-item-block">
                <div className="alerts-item-header">
                  <h3 className="alerts-item-title">
                    Custom Failed Payment Message
                    <span className="alerts-item-subtitle">(S&G Only)</span>
                  </h3>
                </div>
                <div className="flex flex-col sm:flex-row items-start gap-4">
                  <div className="pt-2">
                    <ToggleSwitch
                      id="toggle-failed-payment"
                      isOn={failedPaymentNotifyEnabled}
                      onToggle={() => setFailedPaymentNotifyEnabled((v) => !v)}
                    />
                  </div>
                  <div className="flex-1 w-full">
                    <ChatBubble
                      pickerId="failedPayment"
                      value={failedPaymentNotifyMessage}
                      onChange={setFailedPaymentNotifyMessage}
                      isEditing={editingKey === "failedPayment"}
                      onStartEditing={() => setEditingKey("failedPayment")}
                      onStopEditing={() => setEditingKey(null)}
                      activePickerId={activePickerId}
                      onTogglePicker={handleTogglePicker}
                      onCaretChange={handleCaretChange}
                      pickerComponent={renderPickerForField("failedPayment")}
                      disabled={!failedPaymentNotifyEnabled}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Skipped Job Notifications */}
          <div>
            <h2 className="alerts-section-title">Skipped Job Notifications</h2>
            <div className="alerts-card-box">
              <div className="alerts-item-block">
                <div className="alerts-item-header">
                  <h3 className="alerts-item-title">
                    Custom Skipped Job Message
                    <span className="alerts-item-subtitle">(S&G Only)</span>
                  </h3>
                </div>
                <div className="flex flex-col sm:flex-row items-start gap-4">
                  <div className="pt-2">
                    <ToggleSwitch
                      id="toggle-skipped-job"
                      isOn={skippedJobNotifyEnabled}
                      onToggle={() => setSkippedJobNotifyEnabled((v) => !v)}
                    />
                  </div>
                  <div className="flex-1 w-full">
                    <ChatBubble
                      pickerId="skippedJob"
                      value={skippedJobNotifyMessage}
                      onChange={setSkippedJobNotifyMessage}
                      isEditing={editingKey === "skippedJob"}
                      onStartEditing={() => setEditingKey("skippedJob")}
                      onStopEditing={() => setEditingKey(null)}
                      activePickerId={activePickerId}
                      onTogglePicker={handleTogglePicker}
                      onCaretChange={handleCaretChange}
                      pickerComponent={renderPickerForField("skippedJob")}
                      disabled={!skippedJobNotifyEnabled}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 4: Subscription Paused & Personalize Prompts ────────── */}
      <section className="alerts-section">
        <div className="alerts-grid-2">
          {/* Left Column: Subscription Paused/Unpaused */}
          <div>
            <h2 className="alerts-section-title">Subscription Paused/Unpaused</h2>
            <div className="alerts-card-box">
              <div className="alerts-item-block">
                <div className="alerts-item-header">
                  <h3 className="alerts-item-title">
                    Custom Subscription Paused/Unpaused Message
                    <span className="alerts-item-subtitle">(S&G Only)</span>
                  </h3>
                </div>
                <div className="flex flex-col sm:flex-row items-start gap-4">
                  <div className="pt-2">
                    <ToggleSwitch
                      id="toggle-subscription-paused"
                      isOn={subscriptionPausedNotifyEnabled}
                      onToggle={() => setSubscriptionPausedNotifyEnabled((v) => !v)}
                    />
                  </div>
                  <div className="flex-1 w-full">
                    <ChatBubble
                      pickerId="subscriptionPaused"
                      value={subscriptionPausedNotifyMessage}
                      onChange={setSubscriptionPausedNotifyMessage}
                      isEditing={editingKey === "subscriptionPaused"}
                      onStartEditing={() => setEditingKey("subscriptionPaused")}
                      onStopEditing={() => setEditingKey(null)}
                      activePickerId={activePickerId}
                      onTogglePicker={handleTogglePicker}
                      onCaretChange={handleCaretChange}
                      pickerComponent={renderPickerForField("subscriptionPaused")}
                      disabled={!subscriptionPausedNotifyEnabled}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: To personalize message prompts */}
          <div>
            <div className="h-full flex flex-col justify-end pt-9">
              <div className="alerts-card-box h-full flex items-center justify-center">
                <div className="alerts-personalize-card">
                  <h3 className="alerts-personalize-title">To personalize message prompts</h3>
                  <button
                    type="button"
                    className="alerts-click-here-btn"
                    onClick={() => setShowPromptsModal(true)}
                  >
                    Click Here
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Variable Prompts Personalization Modal ────────────────────── */}
      {showPromptsModal && (
        <div
          className="alerts-modal-overlay"
          onClick={() => setShowPromptsModal(false)}
        >
          <div
            className="alerts-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="alerts-modal-header">
              <h3 className="alerts-modal-title">Personalize Message Prompts</h3>
              <button
                type="button"
                className="p-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                onClick={() => setShowPromptsModal(false)}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="alerts-modal-body space-y-3">
              <p className="text-xs text-slate-500 mb-2">
                Click any tag below to copy it to your clipboard, then paste it into any custom message field:
              </p>
              {MERGE_TAGS.map((tag) => (
                <div key={tag.code} className="alerts-tag-card">
                  <div>
                    <code className="alerts-tag-code">{tag.code}</code>
                    <p className="alerts-tag-label">{tag.label}</p>
                  </div>
                  <button
                    type="button"
                    className="alerts-tag-copy-btn"
                    onClick={() => handleCopyTag(tag.code)}
                  >
                    {copiedTag === tag.code ? (
                      <span className="flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> Copied
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Copy className="w-3.5 h-3.5" /> Copy
                      </span>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
