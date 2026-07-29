import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Clock3, Link2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import "./AddOnCampaignPage.css";

// ─── Example image ───────────────────────────────────────────────────
const ADDON_SMS_EXAMPLE = "/addon-sms-example.png";

// ─── Constants ────────────────────────────────────────────────────────
const ADDON_DURATION_OPTIONS = [
  "4 Weeks",
  "6 Weeks",
  "8 Weeks",
  "10 Weeks",
  "12 Weeks",
] as const;
type AddonDuration = (typeof ADDON_DURATION_OPTIONS)[number];

// Timeline Data for Add-On Campaign (3 Month / ~12 Weeks)
// SMS every 2 weeks: Day 1, Day 14, Day 28, Day 42, Day 56, Day 70
const TIMELINE_STEPS = [
  { day: "Day 1",  label: "SMS 1" },
  { day: "Day 14", label: "SMS 1" },
  { day: "Day 28", label: "SMS 1" },
  { day: "Day 42", label: "SMS 1" },
  { day: "Day 56 to Day 60", label: "SMS 1" },
  { day: "Day 70 to Day 90", label: "SMS 1" },
];
const FIRST_ROW = TIMELINE_STEPS.slice(0, 3);
const SECOND_ROW = TIMELINE_STEPS.slice(3);

// ─── Helpers ──────────────────────────────────────────────────────────
function useLocationId() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("locationId") || "";
  }, []);
}

function sliderBackground(value: number, max: number) {
  const pct = (value / max) * 100;
  return `linear-gradient(to right, #00c2e0 0%, #00c2e0 ${pct}%, var(--border) ${pct}%, var(--border) 100%)`;
}

function addonDurationToIndex(value: string): number {
  const n = value.trim().toLowerCase().replace(/[\s_-]+/g, " ").trim();
  const map: Record<string, number> = {
    "4 weeks": 0, "4 wk": 0, "4w": 0,
    "6 weeks": 1, "6 wk": 1, "6w": 1,
    "8 weeks": 2, "8 wk": 2, "8w": 2,
    "10 weeks": 3, "10 wk": 3, "10w": 3,
    "12 weeks": 4, "12 wk": 4, "12w": 4,
  };
  return (
    map[n] ??
    ADDON_DURATION_OPTIONS.findIndex((l) => l.toLowerCase() === n) ??
    3 // default to 10 Weeks
  );
}

// ─── Main Page Component ─────────────────────────────────────────────
export default function AddOnCampaignPage() {
  const locationId = useLocationId();
  const [addonDuration, setAddonDuration] = useState(3); // default: 10 Weeks
  const [isSaving, setIsSaving] = useState(false);

  const showToast = useCallback((message: string, isError = false) => {
    toast(message, {
      style: isError
        ? { background: "var(--destructive)", color: "var(--destructive-foreground)" }
        : undefined,
    });
  }, []);

  // ── Load settings from GHL on mount ──
  const settingsQuery = trpc.addOnCampaign.getSettings.useQuery(
    { locationId },
    { enabled: !!locationId }
  );
  const saveMutation = trpc.addOnCampaign.saveSettings.useMutation();

  useEffect(() => {
    if (!settingsQuery.data) return;
    const d = settingsQuery.data;
    setAddonDuration(d.addonDuration);
  }, [settingsQuery.data]);

  // ── Save handler ──
  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveMutation.mutateAsync({
        locationId,
        addonDuration: ADDON_DURATION_OPTIONS[addonDuration],
      });
      showToast("Add-on Campaign settings saved successfully.");
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`, true);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Go to SMS/Email templates ──
  const handleGoToTemplates = () => {
    window.open(
      `https://app.royalreview.io/v2/location/${locationId}/conversations/templates?tab=folders&page=1&size=20`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  // ── Missing locationId guard ──
  if (!locationId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Link2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">Add-On Campaign</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Add this page as a GHL custom menu link with the{" "}
            <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
              /add-on-campaign?locationId=YOUR_LOCATION_ID
            </code>{" "}
            URL.
          </p>
        </div>
      </div>
    );
  }

  // ── Render ──
  return (
    <div className="aoc-main">
      <div className="aoc-shell">

        {/* ── Page Header ── */}
        <header className="aoc-page-header">
          <h1 className="aoc-main-title">Add-On Campaign</h1>
          <h2 className="aoc-how-title">How It works:</h2>
          <div className="aoc-how-steps">
            <p className="aoc-how-step">1. Add Contacts manually</p>
            <p className="aoc-how-step">2. We reach out with a message</p>
            <p className="aoc-how-step">3. They approve and you schedule their service</p>
          </div>
        </header>

        {/* ── LITE Info Card ── */}
        <section className="aoc-lite-card">
          <div className="aoc-lite-inner">
            <div className="aoc-lite-content">
              <div className="aoc-lite-label">LITE</div>
              <p className="aoc-lite-text">
                Add-On Follow-Up helps you promote extra services to current customers without feeling
                pushy. Send a text message every 2 weeks for 1 to 3 months to stay top of mind, educate
                customers, and gently remind them about helpful add-ons like deodorizer, disinfectant,
                or deterrent services. Consistent follow-up helps customers see the value of extra
                services over time, increasing revenue while making upgrades feel easy and natural.
              </p>
            </div>
            <div className="aoc-lite-phone">
              <img
                src={ADDON_SMS_EXAMPLE}
                alt="Add-On SMS example on mobile phone"
                className="aoc-lite-phone-img"
              />
            </div>
          </div>
        </section>

        {/* ── Add-On Duration Section ── */}
        <section className="aoc-duration-section">
          <h2 className="aoc-duration-title">Add-On Duration</h2>
          <p className="aoc-duration-subtitle">
            Choose how long you want the add-on campaign to run:
          </p>

          <div className="aoc-current-selection">
            {ADDON_DURATION_OPTIONS[addonDuration]}
          </div>

          <div className="aoc-slider-panel">
            <input
              type="range"
              min={0}
              max={ADDON_DURATION_OPTIONS.length - 1}
              step={1}
              value={addonDuration}
              onChange={(e) => setAddonDuration(Number.parseInt(e.target.value, 10))}
              style={{ background: sliderBackground(addonDuration, ADDON_DURATION_OPTIONS.length - 1) }}
              className="aoc-slider"
              aria-label="Add-On Duration"
            />
            <div className="aoc-slider-labels">
              {ADDON_DURATION_OPTIONS.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
          </div>

          {/* ── Important Notes ── */}
          <div className="aoc-notes-box">
            <div className="aoc-notes-header">
              <Clock3 className="h-4 w-4 text-primary" />
              <span className="aoc-notes-title">Important Notes:</span>
            </div>
            <ul className="aoc-notes-list">
              <li>
                <strong>Messages sent during the day 8 AM to 7 PM</strong>
              </li>
              <li>
                <strong>
                  Texts will be sent every two weeks, and messages are throttled, so your delivery
                  will not be affected
                </strong>
              </li>
            </ul>
          </div>
        </section>

        {/* ── Timeline Section ── */}
        <section className="aoc-timeline-section">
          <h2 className="aoc-timeline-title">3 Month Example Timeline:</h2>

          <div className="aoc-timeline-wrapper">
            {/* Timeline diagram (left side) */}
            <div className="aoc-timeline-diagram">
              {/* First row: Day 1 → Day 14 → Day 28 */}
              <div className="aoc-timeline-row">
                {FIRST_ROW.map((step, idx) => (
                  <div key={step.day} className="aoc-timeline-row-inner">
                    <div className="aoc-timeline-step">
                      <span className="aoc-timeline-step-day">{step.day}</span>
                      <span className="aoc-timeline-step-label">{step.label}</span>
                    </div>
                    {idx < FIRST_ROW.length - 1 && (
                      <div className="aoc-timeline-arrow"><ArrowRight className="h-4 w-4 text-primary opacity-40" /></div>
                    )}
                  </div>
                ))}
              </div>

              {/* Second row: Day 42 → Day 56 → Day 70 */}
              <div className="aoc-timeline-row" style={{ marginTop: 12 }}>
                {SECOND_ROW.map((step, idx) => (
                  <div key={step.day} className="aoc-timeline-row-inner">
                    <div className="aoc-timeline-step">
                      <span className="aoc-timeline-step-day">{step.day}</span>
                      <span className="aoc-timeline-step-label">{step.label}</span>
                    </div>
                    {idx < SECOND_ROW.length - 1 && (
                      <div className="aoc-timeline-arrow"><ArrowRight className="h-4 w-4 text-primary opacity-40" /></div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Vertical Cyan Divider */}
            <div className="aoc-timeline-vertical-divider" />

            {/* CTA (right side) */}
            <div className="aoc-timeline-cta">
              <p className="aoc-timeline-cta-text">
                To personalize<br />your SMS and<br />email prompts
              </p>
              <button
                type="button"
                className="aoc-timeline-cta-btn"
                onClick={handleGoToTemplates}
              >
                Click Here
                <ExternalLink className="h-5 w-5 ml-2 inline-block" />
              </button>
            </div>
          </div>
        </section>

        {/* ── Save Settings Bar ── */}
        <div className="aoc-save-bar">
          <button
            type="button"
            className="aoc-save-btn"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? "Saving…" : "Save Settings"}
          </button>
        </div>

      </div>
    </div>
  );
}
