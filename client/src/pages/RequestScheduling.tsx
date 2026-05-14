import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Link2, Clock3, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import "./RequestScheduling.css";

// Mapping from UI slider value to display label and custom value
const TIMING_LABELS = ["Within 24 Hours", "24 Hours", "48 Hours", "1 Week"] as const;
const TIMING_CUSTOM_VALUES = ["Within 24 Hours", "24 Hours", "48 Hours", "1 Week"] as const;

// Mapping from followUpCount to custom value string
const FOLLOWUP_CUSTOM_VALUES: Record<number, "0" | "1" | "2" | "3"> = {
  0: "0",
  1: "1",
  2: "2",
  3: "3",
};

function useLocationAndParams() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      locationId: params.get("locationId") || "",
      initialRequestScheduling: params.get("initial_request_scheduling") || "",
      followUpLimit: params.get("follow_up_limit") || "",
    };
  }, []);
}

function sliderBackground(value: number) {
  const pct = (value / 3) * 100;
  return `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${pct}%, hsl(var(--border)) ${pct}%, hsl(var(--border)) 100%)`;
}

/**
 * Map custom value string to UI slider index
 */
function timingCustomValueToIndex(value: string): number {
  const index = TIMING_CUSTOM_VALUES.indexOf(value as any);
  return index >= 0 ? index : 0;
}

/**
 * Map service type string to UI slider index
 */
function serviceTypeToIndex(value: string): number {
  const idx = parseInt(value, 10);
  return isNaN(idx) || idx < 0 || idx > 3 ? 0 : idx;
}

export default function RequestScheduling() {
  const { locationId, initialRequestScheduling, followUpLimit } = useLocationAndParams();
  const [initialTiming, setInitialTiming] = useState(0);
  const [followUpCount, setFollowUpCount] = useState(3);
  const [isSaving, setIsSaving] = useState(false);

  // Mutation for saving to location custom values
  const saveCustomValuesMutation = trpc.requestScheduling.saveCustomValuesSettings.useMutation();

  const showToast = useCallback((message: string, isError = false) => {
    toast(message, { style: isError ? { background: "hsl(var(--destructive))", color: "hsl(var(--destructive-foreground))" } : undefined });
  }, []);

  // Preload from URL query parameters (custom values)
  useEffect(() => {
    if (initialRequestScheduling) {
      const idx = timingCustomValueToIndex(initialRequestScheduling);
      setInitialTiming(idx);
    }

    if (followUpLimit) {
      const val = parseInt(followUpLimit, 10);
      if (!isNaN(val) && val >= 0 && val <= 3) setFollowUpCount(val);
    }
  }, [initialRequestScheduling, followUpLimit]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Save to location-level custom values
      await saveCustomValuesMutation.mutateAsync({
        locationId,
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

  const handleTogglePause = async () => {
    showToast("Pause/Resume is not available on this page.", true);
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
            Add this page as a GHL custom menu link with the <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">/contacts?locationId=YOUR_LOCATION_ID</code> URL.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rs-main">
      <div className="rs-shell">
        <header className="bg-background/95 backdrop-blur-sm sticky top-0 z-10 mb-6 rounded-t-xl border border-border">
          <div className="px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-3 rounded-t-xl">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
              <div className="min-w-0">
                <h1 className="text-sm font-semibold text-foreground leading-none">Request Scheduling</h1>
                <p className="text-xs text-muted-foreground truncate">Location {locationId}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <span>Connected</span>
            </div>
          </div>
        </header>

        <div className="rs-grid">
          <section className="rs-card">
            <h2 className="rs-title">Initial Request Scheduling</h2>
            <p className="rs-subtitle">Choose when to send review requests to your contacts after receiving their information.</p>

            <div className="rs-info-box" style={{ marginBottom: "12px" }}>
              <p className="text-xs text-muted-foreground">
                <strong>Note:</strong> Saving to custom values. Values will be stored in <code>{"{{custom_values.initial_request_scheduling}}"}</code>.
              </p>
            </div>

            <div className="rs-display-value">{TIMING_LABELS[initialTiming]}</div>

            <div className="rs-slider-wrap">
              <input
                type="range"
                min={0}
                max={3}
                step={1}
                value={initialTiming}
                onChange={(event) => setInitialTiming(Number.parseInt(event.target.value, 10))}
                style={{ background: sliderBackground(initialTiming) }}
                className="rs-slider"
                aria-label="Initial request timing"
              />
              <div className="rs-slider-labels">
                <span>Within 24h</span>
                <span>24h</span>
                <span>48h</span>
                <span>1 Week</span>
              </div>
            </div>

            <div className="rs-info-box">
              <div className="rs-info-header">
                <Clock3 className="h-4 w-4 text-primary" />
                <span className="rs-info-title">Important Notes:</span>
              </div>
              <ul className="rs-info-list">
                <li>Review requests are only sent between 9 AM and 7 PM local time</li>
                <li>If scheduled outside these hours, the request will be sent the next available day</li>
                <li>
                  For custom scheduling needs, contact{' '}
                  <a href="mailto:support@reviewharvest.com">support@reviewharvest.com</a>
                </li>
              </ul>
            </div>
          </section>

          <section className="rs-card">
            <h2 className="rs-title">Follow-up Requests</h2>
            <p className="rs-subtitle">Select the number of follow-up requests to send if no response is received.</p>

            <div className="rs-info-box" style={{ marginBottom: "12px" }}>
              <p className="text-xs text-muted-foreground">
                <strong>Note:</strong> Saving to custom values. Values will be stored in <code>{"{{custom_values.follow_up_limit}}"}</code>.
              </p>
            </div>

            <div className="rs-display-value">
              {followUpCount === 0 ? "No Follow-ups" : `${followUpCount} Follow-up${followUpCount > 1 ? "s" : ""}`}
            </div>

            <div className="rs-slider-wrap">
              <input
                type="range"
                min={0}
                max={3}
                step={1}
                value={followUpCount}
                onChange={(event) => setFollowUpCount(Number.parseInt(event.target.value, 10))}
                style={{ background: sliderBackground(followUpCount) }}
                className="rs-slider"
                aria-label="Number of follow-up requests"
              />
              <div className="rs-slider-labels">
                <span>0</span>
                <span>1</span>
                <span>2</span>
                <span>3</span>
              </div>
            </div>

            <div className="rs-info-box-green">
              <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <p>Our smart system continuously analyzes and adjusts follow-up timing to maximize response rates.</p>
            </div>
          </section>
        </div>

        <div className="rs-save-bar">
          <button className="rs-save-btn" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Settings"}
          </button>
        </div>

        <section className="rs-pause-card">
          <h2 className="rs-title">Pause Review Requests</h2>
          <p className="rs-subtitle">Temporarily stop all review requests from being sent to your contacts.</p>

          {saveMode === "custom-values" ? (
            <div className="rs-info-box">
              <p className="text-sm text-muted-foreground">Pause/Resume functionality is only available when using contact-based settings.</p>
            </div>
          ) : (
            <>
              <div className={`rs-status-box ${isPaused ? "rs-paused" : "rs-active"}`}>
                <span className="rs-status-label">{isPaused ? "Paused" : "Active"}</span>
              </div>

              <button className={`rs-pause-btn ${isPaused ? "rs-btn-resume" : "rs-btn-pause"}`} onClick={handleTogglePause}>
                <span className="inline-flex items-center gap-2 justify-center">
                  {isPaused ? <RefreshCw className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
                  {isPaused ? "Resume Requests" : "Pause Requests"}
                </span>
              </button>

              {isPaused ? (
                <div className="rs-pause-warning">
                  All review requests are currently paused. Contacts have been removed from "01. Review Reactivation First Campaign For Client List" and "02. Review Request New Customers After Review Reactivation". Click Resume Requests to re-enable sending.
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}