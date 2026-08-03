import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Clock3, Link2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import ReactivationQuotePopup from "@/components/ReactivationQuotePopup";
import "./ReactivationPage.css";

// ─── Example images (place these PNGs in /public) ─────────────────────
const EXAMPLE_LITE   = "/lite.png";
const EXAMPLE_CUSTOM = "/custom.png";

// ─── Constants ────────────────────────────────────────────────────────
const REACTIVATION_OPTIONS = ["Lite", "Custom Quote & Link"] as const;
type ReactivationOption = (typeof REACTIVATION_OPTIONS)[number];

// One-Time Service Outreach Scheduling options
// Mapped to: {{custom_values.onetime_service_reactivation_scheduling}}
const ONETIME_TIMING_LABELS = [
  "Never",
  "Immediately",
  "Next Day",
  "72 Hours Later",
  "1 Week Later",
] as const;
type OnetimeTiming = (typeof ONETIME_TIMING_LABELS)[number];

// Timeline Data (Matching Follow-Up page exactly)
const TIMELINE_STEPS = [
  { day: "Day 1",  label: "Email 1\nSMS 1" },
  { day: "Day 3",  label: "Email 2\nSMS 2" },
  { day: "Day 5",  label: "Email 3\nSMS 3" },
  { day: "Day 8",  label: "Email 4\nSMS 4" },
  { day: "Day 12", label: "Email 5\nSMS 5" },
  { day: "Day 26", label: "Email 6" },
  { day: "Day 60", label: "Email 7" },
  { day: "Day 90", label: "Email 8" },
  { day: "Day 180", label: "Email 9" },
  { day: "Day 270", label: "Email 10" },
  { day: "Day 360", label: "Email 11" },
];
const FIRST_ROW  = TIMELINE_STEPS.slice(0, 6);
const SECOND_ROW = TIMELINE_STEPS.slice(6);

// ─── Helpers ──────────────────────────────────────────────────────────
function useLocationId() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("locationId") || "";
  }, []);
}

function sliderBackground(value: number, max: number) {
  const pct = (value / max) * 100;
  return `linear-gradient(to right, var(--primary) 0%, var(--primary) ${pct}%, var(--border) ${pct}%, var(--border) 100%)`;
}

function onetimeTimingToIndex(value: string): number {
  const n = value.trim().toLowerCase().replace(/[\s_-]+/g, " ").trim();
  const map: Record<string, number> = {
    never: 0,
    immediately: 1,
    "next day": 2,
    "72 hours later": 3,
    "72 hours": 3,
    "1 week later": 4,
    "one week later": 4,
    "1 week": 4,
  };
  return (
    map[n] ??
    ONETIME_TIMING_LABELS.findIndex((l) => l.toLowerCase() === n) ??
    0
  );
}

// ─── Main Reactivation Page ───────────────────────────────────────────
export default function ReactivationPage() {
  const locationId = useLocationId();

  const [selectedOption, setSelectedOption] = useState<ReactivationOption>("Lite");
  const [onetimeTiming, setOnetimeTiming]   = useState(0); // default: Never
  const [isSaving, setIsSaving]             = useState(false);
  const [showQuotePopup, setShowQuotePopup] = useState(false);

  // ── Load settings ────────────────────────────────────────────────────
  const settingsQuery = trpc.reactivation.getSettings.useQuery(
    { locationId },
    { enabled: !!locationId }
  );
  const saveMutation = trpc.reactivation.saveSettings.useMutation();

  const showToast = useCallback((message: string, isError = false) => {
    toast(message, {
      style: isError
        ? { background: "var(--destructive)", color: "var(--destructive-foreground)" }
        : undefined,
    });
  }, []);

  // Populate state from GHL on load
  useEffect(() => {
    if (!settingsQuery.data) return;
    const d = settingsQuery.data;
    setSelectedOption(d.reactivationOption);
    setOnetimeTiming(d.onetimeTiming);
  }, [settingsQuery.data]);

  // ── Save handlers ────────────────────────────────────────────────────
  const handleSave = async () => {
    if (selectedOption === "Custom Quote & Link") {
      setShowQuotePopup(true);
      return;
    }
    setIsSaving(true);
    try {
      await saveMutation.mutateAsync({
        locationId,
        reactivationOption: selectedOption,
        onetimeTiming: ONETIME_TIMING_LABELS[onetimeTiming],
      });
      showToast("Reactivation settings saved successfully.");
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`, true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuoteSaveSuccess = () => {
    setSelectedOption("Custom Quote & Link");
    settingsQuery.refetch();
  };

  // ── Missing locationId guard ─────────────────────────────────────────
  if (!locationId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Link2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">Reactivation</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Add this page as a GHL custom menu link with the{" "}
            <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
              /reactivation?locationId=YOUR_LOCATION_ID
            </code>{" "}
            URL.
          </p>
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="rs-main reac-page">
      <div className="rs-shell reac-shell">

        {/* ── Page Header ── */}
        <header className="rs-page-header reac-page-header">
          <div>
            <h1 className="reac-main-title">Reactivation</h1>
            <h2 className="reac-sub-title">How it works:</h2>
            <div className="rs-page-copy">
              <p className="rs-how-step">1. Add Contacts manually or a Facebook form</p>
              <p className="rs-how-step">2. We reach out with a message</p>
              <p className="rs-how-step">3. They approve a quote and schedule an scoop</p>
            </div>
          </div>
        </header>

        {/* ── Campaign Option Cards (2-column) ── */}
        <section className="rs-card rs-option-section reac-card">
          <div className="reac-option-grid">
            {REACTIVATION_OPTIONS.map((option) => {
              const isSelected = selectedOption === option;
              return (
                <div key={option} className="rs-option-card-wrapper">
                  <div
                    className={`rs-option-card reac-option-card ${isSelected ? "rs-option-selected" : ""}`}
                    onClick={() => {
                      setSelectedOption(option);
                      if (option === "Custom Quote & Link") {
                        setShowQuotePopup(true);
                      }
                    }}
                  >
                    <div className="reac-option-title">{option}</div>
                    <p className="rs-option-text">
                      {option === "Lite"
                        ? "Lite includes simple text and email follow-up to help bring past customers back without extra work. Automatic messages help remind customers about your service, rebuild trust, and keep your business top of mind so they are more likely to restart service instead of putting it off or choosing someone else. Your phone number and email are included so customers can easily reach out when they are ready."
                        : "Past customers in the Custom Quote w/Link reactivation campaign are automatically added to a text and email follow-up sequence with a personalized company page and self-onboarding link. Customers can view pricing, see your logo, photos, reviews, and company information, then restart service in just a few clicks. Automatic follow-up helps rebuild trust, keeps your business top of mind, and makes it easier for past customers to come back when the timing feels right."}
                    </p>
                    <div className="rs-example-box">
                      <div className="reac-example-label">EXAMPLE</div>
                      <div className="rs-example-content">
                        <img
                          src={option === "Lite" ? EXAMPLE_LITE : EXAMPLE_CUSTOM}
                          alt={`${option} example`}
                          className="rs-example-image"
                        />
                      </div>
                    </div>

                    {/* Centered Radio Circle at bottom center of card (matching screenshot) */}
                    <div className="reac-card-radio-bottom">
                      <div className={`reac-card-radio-circle ${isSelected ? "reac-radio-checked" : ""}`}>
                        {isSelected && <div className="reac-radio-dot" />}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── One-Time Service Outreach Scheduling ── */}
        <section className="rs-card rs-scheduling-section reac-card">
          <div className="rs-section-heading">
            <div>
              <h2 className="rs-title">One-Time Service Outreach Scheduling</h2>
              <p className="rs-subtitle">
                Choose when you want to begin reactivation outreach to one-time clients (Sweep and Go Only).
              </p>
            </div>
            <span className="rs-current-selection">{ONETIME_TIMING_LABELS[onetimeTiming]}</span>
          </div>

          <div className="rs-slider-panel">
            <input
              type="range"
              min={0}
              max={ONETIME_TIMING_LABELS.length - 1}
              step={1}
              value={onetimeTiming}
              onChange={(e) => setOnetimeTiming(Number.parseInt(e.target.value, 10))}
              style={{ background: sliderBackground(onetimeTiming, ONETIME_TIMING_LABELS.length - 1) }}
              className="rs-slider"
              aria-label="One-time service outreach timing"
            />
            <div className="rs-slider-labels rs-slider-labels-wide">
              {ONETIME_TIMING_LABELS.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
          </div>

          <div className="rs-scheduling-divider" />

          <div className="rs-info-box reac-info-box">
            <div className="rs-info-header">
              <Clock3 className="h-4 w-4 text-primary" />
              <span className="rs-info-title">Important Notes:</span>
            </div>
            <ul className="rs-info-list">
              <li><strong>Messages sent during the day 8 AM to 7 PM</strong></li>
              <li><strong>Text messages are throttled, so your delivery will not be affected</strong></li>
            </ul>
          </div>
        </section>

        {/* ── Redesigned Timeline (matching Follow-Up page) ── */}
        <section className="rs-card rs-timeline-section reac-card">
          <h2 className="rs-title">Timeline</h2>
          <div className="rs-timeline-redesigned">
            {/* First row: Day 1 → Day 3 → Day 5 → Day 8 → Day 12 → Day 26 */}
            <div className="rs-timeline-row">
              {FIRST_ROW.map((step, idx) => (
                <div key={step.day} className="rs-timeline-row-inner">
                  <div className="rs-timeline-step">
                    <span className="rs-timeline-step-day">{step.day}</span>
                    <span className="rs-timeline-step-label">{step.label}</span>
                  </div>
                  {idx < FIRST_ROW.length - 1 && (
                    <ArrowRight className="rs-timeline-dashed-arrow" />
                  )}
                </div>
              ))}
            </div>

            {/* Curved connector from Day 26 (end of row 1) to Day 60 (start of row 2) */}
            <div className="rs-timeline-curve-connector">
              <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="rs-timeline-curve-svg">
                <path
                  d="M 0 0 C 30 0, 70 60, 100 60"
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="2"
                  strokeDasharray="6 4"
                />
              </svg>
            </div>

            {/* Second row: Day 60 → Day 90 → Day 180 → Day 270 → Day 360 */}
            <div className="rs-timeline-row">
              {SECOND_ROW.map((step, idx) => (
                <div key={step.day} className="rs-timeline-row-inner">
                  <div className="rs-timeline-step">
                    <span className="rs-timeline-step-day">{step.day}</span>
                    <span className="rs-timeline-step-label">{step.label}</span>
                  </div>
                  {idx < SECOND_ROW.length - 1 && (
                    <ArrowRight className="rs-timeline-dashed-arrow" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Save Settings Bar ── */}
        <div className="reac-save-bar">
          <button
            type="button"
            className="reac-save-btn"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? "Saving…" : "Save Settings"}
          </button>
        </div>

      </div>

      {/* Reactivation Custom Quote Popup (Dedicated Reactivation Clone) */}
      <ReactivationQuotePopup
        open={showQuotePopup}
        onOpenChange={setShowQuotePopup}
        locationId={locationId}
        reactivationOption={selectedOption}
        onetimeTiming={onetimeTiming}
        onSaveSuccess={handleQuoteSaveSuccess}
      />
    </div>
  );
}


