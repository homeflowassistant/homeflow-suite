import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Link2, Clock3, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import "./RequestScheduling.css";

const LEAD_FOLLOW_UP_OPTIONS = ["Lite", "S&G Link"] as const;
const TIMING_LABELS = ["Immediately", "Next Day", "48 Hours Later", "72 Hours Later", "One Week from Now"] as const;
const TIMING_CUSTOM_VALUES = ["Immediately", "Next Day", "48 Hours Later", "72 Hours Later", "One Week from Now"] as const;

const FOLLOWUP_CUSTOM_VALUES: Record<number, "0" | "1" | "2" | "3"> = {
  0: "0",
  1: "1",
  2: "2",
  3: "3",
};

function normalizeTimingValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function useLocationAndParams() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      locationId: params.get("locationId") || "",
      leadFollowUpOption: params.get("lead_follow_up_option") || "",
      initialRequestScheduling: params.get("initial_request_scheduling") || "",
      followUpLimit: params.get("follow_up_limit") || "",
    };
  }, []);
}

function sliderBackground(value: number) {
  const pct = (value / (TIMING_LABELS.length - 1)) * 100;
  return `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${pct}%, hsl(var(--border)) ${pct}%, hsl(var(--border)) 100%)`;
}

function timingCustomValueToIndex(value: string): number {
  const normalized = normalizeTimingValue(value);
  const lookup: Record<string, number> = {
    immediately: 0,
    "next day": 1,
    "24 hours": 1,
    "24h": 1,
    "48 hours later": 2,
    "48 hours": 2,
    "48h": 2,
    "72 hours later": 3,
    "72 hours": 3,
    "1 week from now": 4,
    "one week from now": 4,
    "1 week": 4,
    "one week": 4,
  };

  return lookup[normalized] ?? TIMING_CUSTOM_VALUES.findIndex((label) => normalizeTimingValue(label) === normalized) ?? 0;
}

export default function RequestScheduling() {
  const { locationId, leadFollowUpOption, initialRequestScheduling, followUpLimit } = useLocationAndParams();
  const [selectedOption, setSelectedOption] = useState<(typeof LEAD_FOLLOW_UP_OPTIONS)[number]>("Lite");
  const [initialTiming, setInitialTiming] = useState(3);
  const [followUpCount, setFollowUpCount] = useState(3);
  const [isSaving, setIsSaving] = useState(false);

  const settingsQuery = trpc.requestScheduling.getSettings.useQuery(
    { locationId },
    { enabled: !!locationId }
  );

  const saveCustomValuesMutation = trpc.requestScheduling.saveCustomValuesSettings.useMutation();

  const showToast = useCallback((message: string, isError = false) => {
    toast(message, { style: isError ? { background: "hsl(var(--destructive))", color: "hsl(var(--destructive-foreground))" } : undefined });
  }, []);

  useEffect(() => {
    if (leadFollowUpOption && LEAD_FOLLOW_UP_OPTIONS.includes(leadFollowUpOption as any)) {
      setSelectedOption(leadFollowUpOption as (typeof LEAD_FOLLOW_UP_OPTIONS)[number]);
    }

    if (initialRequestScheduling) {
      setInitialTiming(timingCustomValueToIndex(initialRequestScheduling));
    }

    if (followUpLimit) {
      const val = parseInt(followUpLimit, 10);
      if (!isNaN(val) && val >= 0 && val <= 3) setFollowUpCount(val);
    }
  }, [leadFollowUpOption, initialRequestScheduling, followUpLimit]);

  useEffect(() => {
    if (leadFollowUpOption || initialRequestScheduling || followUpLimit) {
      return;
    }

    if (settingsQuery.data) {
      setSelectedOption(settingsQuery.data.leadFollowUpOption);
      setInitialTiming(settingsQuery.data.initialTiming);
      setFollowUpCount(settingsQuery.data.followUpCount);
    }
  }, [leadFollowUpOption, initialRequestScheduling, followUpLimit, settingsQuery.data]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveCustomValuesMutation.mutateAsync({
        locationId,
        leadFollowUpOption: selectedOption,
        initialRequestScheduling: TIMING_LABELS[initialTiming],
        followUpLimit: FOLLOWUP_CUSTOM_VALUES[followUpCount],
      });
      showToast("Settings saved successfully.");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      showToast(`Error saving settings: ${errorMsg}`, true);
    } finally {
      setIsSaving(false);
    }
  };
  if (!locationId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Link2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">Request Scheduling</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Add this page as a GHL custom menu link with the <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">/request-scheduling?locationId=YOUR_LOCATION_ID</code> URL.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rs-main">
      <div className="rs-shell">
        <header className="rs-page-header">
          <div>
            <p className="rs-page-label">Lead Follow-Up Options</p>
            <h1 className="rs-page-title">How it works</h1>
            <p className="rs-page-copy">
              1. Add Contacts manually or via Facebook form.
              2. We reach out with a message.
              3. They approve a quote and you schedule a scope.
            </p>
          </div>
          <div className="rs-page-icon">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
        </header>

        <section className="rs-card rs-option-section">
          <div className="rs-option-grid">
            {LEAD_FOLLOW_UP_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={`rs-option-card ${selectedOption === option ? "rs-option-selected" : ""}`}
                onClick={() => setSelectedOption(option)}
              >
                <div className="rs-option-card-header">
                  <span className="rs-option-name">{option.toUpperCase()}</span>
                  <span className="rs-option-pill">{option === "Lite" ? "Simple follow-up" : "Self-onboarding campaign"}</span>
                </div>
                <p className="rs-option-text">
                  {option === "Lite"
                    ? "Lite includes simple text and email follow-up for new leads so you stay connected without extra work. When someone reaches out, automatic messages help build trust, answer questions, and keep your business top of mind."
                    : "Leads in the Sweep & Go Link campaign are automatically added to a text and email follow-up sequence with a self-onboarding link. Customers can simply click the link to view pricing, approve services, and schedule themselves, eliminating 90% of the back and forth."}
                </p>
                <p className="rs-option-text">
                  {option === "Lite"
                    ? "If you'd rather get distracted, or choose someone else, your phone number and email are included so customers feel comfortable reaching out when they are ready."
                    : "Automate follow-up, keep your business top of mind, build trust over time, and help more leads sign up before they forget, get busy, or choose someone else."}
                </p>
                <div className="rs-example-box">
                  <div className="rs-example-label">Example</div>
                  <div className="rs-example-content">
                    {option === "Lite"
                      ? "Simple message + email follow-up keeps the lead engaged."
                      : "Self-onboarding link sends the customer directly to pricing and scheduling."}
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="rs-field-notes">
            <p className="rs-field-notes-title">Custom values stored by the backend</p>
            <ul>
              <li><code>lead_follow_up_option</code></li>
              <li><code>initial_request_scheduling</code></li>
              <li><code>follow_up_limit</code></li>
            </ul>
            <p className="rs-field-notes-copy">The backend automatically finds the existing custom value IDs and saves the new values when you click Save.</p>
          </div>
        </section>

        <section className="rs-card rs-scheduling-section">
          <div className="rs-section-heading">
            <div>
              <h2 className="rs-title">Initial Outreach Scheduling</h2>
              <p className="rs-subtitle">Choose when you want to start your initial outreach for Lead Follow-Ups.</p>
            </div>
            <span className="rs-current-selection">{TIMING_LABELS[initialTiming]}</span>
          </div>

          <div className="rs-slider-panel">
            <input
              type="range"
              min={0}
              max={TIMING_LABELS.length - 1}
              step={1}
              value={initialTiming}
              onChange={(event) => setInitialTiming(Number.parseInt(event.target.value, 10))}
              style={{ background: sliderBackground(initialTiming) }}
              className="rs-slider"
              aria-label="Initial outreach timing"
            />
            <div className="rs-slider-labels rs-slider-labels-wide">
              {TIMING_LABELS.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
          </div>

          <div className="rs-info-box">
            <div className="rs-info-header">
              <Clock3 className="h-4 w-4 text-primary" />
              <span className="rs-info-title">Important Notes</span>
            </div>
            <ul className="rs-info-list">
              <li>Messages sent during the day <strong>8 AM to 7 PM</strong></li>
              <li>Text messages are throttled, so your delivery will not be affected</li>
            </ul>
          </div>
        </section>

        <section className="rs-card rs-timeline-section">
          <h2 className="rs-title">Timeline</h2>
          <div className="rs-timeline-grid">
            <div className="rs-timeline-item"><span className="rs-timeline-day">Day 1</span><span>Email 1 · SMS 1</span></div>
            <div className="rs-timeline-item"><span className="rs-timeline-day">Day 3</span><span>Email 2 · SMS 2</span></div>
            <div className="rs-timeline-item"><span className="rs-timeline-day">Day 5</span><span>Email 3 · SMS 3</span></div>
            <div className="rs-timeline-item"><span className="rs-timeline-day">Day 8</span><span>Email 4 · SMS 4</span></div>
            <div className="rs-timeline-item"><span className="rs-timeline-day">Day 12</span><span>Email 5 · SMS 5</span></div>
            <div className="rs-timeline-item"><span className="rs-timeline-day">Day 26</span><span>Email 6</span></div>
            <div className="rs-timeline-item"><span className="rs-timeline-day">Day 60</span><span>Email 7</span></div>
            <div className="rs-timeline-item"><span className="rs-timeline-day">Day 90</span><span>Email 8</span></div>
            <div className="rs-timeline-item"><span className="rs-timeline-day">Day 180</span><span>Email 9</span></div>
            <div className="rs-timeline-item"><span className="rs-timeline-day">Day 270</span><span>Email 10</span></div>
            <div className="rs-timeline-item"><span className="rs-timeline-day">Day 360</span><span>Email 11</span></div>
          </div>
        </section>

        <div className="rs-save-bar">
          <button type="button" className="rs-save-btn" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save settings"}
          </button>
        </div>

        <div className="rs-actions-row">
          <p className="rs-actions-copy">Save your Request Scheduling settings before visiting workflow templates. You will be redirected to a new page.</p>
          <div className="rs-actions-buttons">
            <a href="/messaging" className="rs-cta-btn">Email Templates</a>
            <a href="/messaging" className="rs-cta-btn rs-cta-btn-secondary">SMS Templates</a>
          </div>
        </div>
      </div>
    </div>
  );
}