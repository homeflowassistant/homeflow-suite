import { useState, useEffect, useMemo } from "react";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import "./PricingPage.css";

// ─── Shared types with the server ────────────────────────────────────

interface PriceLine {
  label: string;
  value: string;
}

interface DogPricing {
  dogCount: number;
  /** Multi-line free text, one rate line per service frequency. */
  text: string;
}

interface FaqEntry {
  dogLabel: string;
  value: string;
}

// ─── Location id from URL params (same as every other settings page) ──

function useLocationId() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("locationId") || params.get("location_id") || "";
  }, []);
}

// ─── Constants (mirror the server's known duration/frequency buckets) ─

const INITIAL_DURATION_LINES = [
  "One week OR less",
  "More than one week & less than 1 Month",
  "1 Month",
  "2 Month",
  "3 Months",
  "4 Months",
  "5 Months",
  "6 Months",
] as const;

// ─── Reusable building blocks ────────────────────────────────────────

function PawLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="pricing-dog-label">
      <span className="pricing-paw" aria-hidden>
        🐾
      </span>
      {children}
    </h3>
  );
}

/** Small labeled $ input used inside the dog sub-boxes. */
function MoneyField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="pricing-money-field">
      <span className="pricing-money-prefix">$</span>
      <input
        type="text"
        inputMode="decimal"
        className="pricing-money-input"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="0.00"
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}

/**
 * Price box: paw label + stacked money lines (Initial / One-Time tiers).
 * Lines are bound as full "$XX" strings; only the numeric part is editable.
 */
function PriceBox({
  lines,
  onChangeLines,
}: {
  lines: PriceLine[];
  onChangeLines: (next: PriceLine[]) => void;
}) {
  return (
    <div className="pricing-price-box">
      <div className="pricing-price-lines">
        {lines.map((line, i) => (
          <div key={line.label} className="pricing-line-row">
            <span className="pricing-line-label">{line.label}:</span>
            <MoneyField
              value={line.value.replace(/^\$?\s?/, "")}
              onChange={v => {
                const next = [...lines];
                next[i] = { ...line, value: v.trim() };
                onChangeLines(next);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Recurring rate box: paw label + ONE free-text area containing one rate
 * line per service frequency. The client can edit any line and add new
 * frequencies (e.g. 3x weekly) as extra lines.
 */
function RecurringBox({
  pricing,
  onChange,
}: {
  pricing: DogPricing;
  onChange: (next: DogPricing) => void;
}) {
  return (
    <div className="pricing-price-box">
      <textarea
        className="pricing-recurring-textarea"
        value={pricing.text}
        onChange={e => onChange({ ...pricing, text: e.target.value })}
        rows={5}
        placeholder={`2x weekly Recurring Quote Rate for ${pricing.dogCount} dog${pricing.dogCount > 1 ? "s" : ""}: $0.00 per service`}
        autoComplete="off"
        spellCheck={false}
        aria-label={`Recurring quote rates for ${pricing.dogCount} dog${pricing.dogCount > 1 ? "s" : ""}`}
      />
    </div>
  );
}

// ─── Main Pricing page ───────────────────────────────────────────────

export default function PricingPage() {
  const locationId = useLocationId();
  const [isSaving, setIsSaving] = useState(false);

  // ── Local editable state ──────────────────────────────────────────
  const [initialPricing, setInitialPricing] = useState<FaqEntry[]>([]);
  const [oneTimePricing, setOneTimePricing] = useState<FaqEntry[]>([]);
  const [regularZipCodes, setRegularZipCodes] = useState("");
  const [regularRecurringPricing, setRegularRecurringPricing] = useState<
    DogPricing[]
  >([]);
  const [premiumZipCodes, setPremiumZipCodes] = useState("");
  const [crossSells, setCrossSells] = useState("");
  const [premiumRecurringPricing, setPremiumRecurringPricing] = useState<
    DogPricing[]
  >([]);

  // ── tRPC ──────────────────────────────────────────────────────────
  const settingsQuery = trpc.pricing.getSettings.useQuery(
    { locationId: locationId || "preview" },
    { enabled: true }
  );
  const saveMutation = trpc.pricing.saveSettings.useMutation();

  // Hydrate local state when the query resolves
  useEffect(() => {
    const d = settingsQuery.data;
    if (!d) return;
    setInitialPricing(d.initialPricing);
    setOneTimePricing(d.oneTimePricing);
    setRegularZipCodes(d.regularZipCodes);
    setRegularRecurringPricing(d.regularRecurringPricing);
    setPremiumZipCodes(d.premiumZipCodes ?? "");
    setPremiumRecurringPricing(d.premiumRecurringPricing);
    setCrossSells(d.crossSells ?? "");
  }, [settingsQuery.data]);

  // ── Save ──────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!locationId) {
      toast.info(
        "Preview Mode: Settings saved locally. Add ?locationId={{location.id}} in GHL to sync with client sub-accounts."
      );
      return;
    }

    // Client-side required-field check: FAQ blocks must not be empty.
    const faqEmpty = [...initialPricing, ...oneTimePricing].some(
      e => !e.value.trim()
    );
    if (faqEmpty) {
      toast.error(
        "Pricing values are required for every dog count in the Initial and One-Time sections."
      );
      return;
    }
    const regularZips = regularZipCodes.trim();
    if (!regularZips) {
      toast.error("Regular ZIP codes are required.");
      return;
    }

    setIsSaving(true);
    try {
      await saveMutation.mutateAsync({
        locationId,
        initialPricing,
        oneTimePricing,
        regularZipCodes,
        regularRecurringPricing,
        premiumZipCodes,
        premiumRecurringPricing,
        crossSells,
      });
      toast.success("Pricing settings saved successfully!");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save pricing settings"
      );
    } finally {
      setIsSaving(false);
    }
  };

  // ── Derived helpers ───────────────────────────────────────────────
  const dogBoxes: number[] = [1, 2, 3, 4, 5, 6];

  const updateInitialEntry = (index: number, value: string) =>
    setInitialPricing(prev =>
      prev.map((e, i) => (i === index ? { ...e, value } : e))
    );

  const updateOneTimeEntry = (index: number, value: string) =>
    setOneTimePricing(prev =>
      prev.map((e, i) => (i === index ? { ...e, value } : e))
    );

  const updateRecurringDog = (
    rows: DogPricing[],
    setRows: React.Dispatch<React.SetStateAction<DogPricing[]>>,
    index: number,
    next: DogPricing
  ) => setRows(prev => prev.map((r, i) => (i === index ? next : r)));

  const isLoading = settingsQuery.isLoading;

  if (isLoading) {
    return (
      <div className="pricing-page-shell">
        <div className="pricing-loading">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
          <p>Loading pricing settings…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pricing-page-shell">
      {/* ── Top page header ─────────────────────────────────────────── */}
      <div className="pricing-page-header">
        <div className="pricing-header-left">
          <h1 className="pricing-page-title">Pricing Setup</h1>
          <span className="pricing-required-hint">*required fields</span>
        </div>
        <button
          type="button"
          className="pricing-save-btn"
          onClick={handleSave}
          disabled={isSaving}
        >
          <Save className="h-4 w-4" />
          {isSaving ? "Saving..." : "Save Settings"}
        </button>
      </div>

      {isLoading ? (
        <div className="pricing-loading">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="pricing-page-content">
          {/* ── Section 1: Initial Service Pricing ─────────────────── */}
          <section className="pricing-section">
            <div className="pricing-card">
              <h2 className="pricing-section-title required">
                Initial Service Pricing
              </h2>
              <p className="pricing-section-instruction">
                If this service is provided, replace the X's with your service
                pricing. Please contact support if you need assistance.
              </p>
              <div className="pricing-grid-3">
                {dogBoxes.map(dog => (
                  <div className="pricing-dog-block" key={`init-${dog}`}>
                    <PawLabel>
                      {dog} Dog{dog > 1 ? "s" : ""}
                    </PawLabel>
                    <textarea
                      className="pricing-faq-textarea"
                      value={
                        initialPricing[dog - 1]
                          ? initialPricing[dog - 1].value
                          : ""
                      }
                      onChange={e =>
                        updateInitialEntry(dog - 1, e.target.value)
                      }
                      rows={4}
                      aria-label={`Initial service pricing for ${dog} dog${dog > 1 ? "s" : ""}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── Section 2: One-Time Service Pricing ────────────────── */}
          <section className="pricing-section">
            <div className="pricing-card">
              <h2 className="pricing-section-title required">
                One-Time Service Pricing
              </h2>
              <p className="pricing-section-instruction">
                If this service is provided, replace the X's with your service
                pricing. Please contact support if you need assistance.
              </p>
              <div className="pricing-grid-3">
                {dogBoxes.map(dog => (
                  <div className="pricing-dog-block" key={`ot-${dog}`}>
                    <PawLabel>
                      {dog} Dog{dog > 1 ? "s" : ""}
                    </PawLabel>
                    <textarea
                      className="pricing-faq-textarea"
                      value={
                        oneTimePricing[dog - 1]
                          ? oneTimePricing[dog - 1].value
                          : ""
                      }
                      onChange={e =>
                        updateOneTimeEntry(dog - 1, e.target.value)
                      }
                      rows={4}
                      aria-label={`One-time service pricing for ${dog} dog${dog > 1 ? "s" : ""}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── Section 3: Zip code tier fields ────────────────────── */}
          <section className="pricing-section">
            <div className="pricing-card">
              <div className="pricing-zip-grid">
                <div className="pricing-zip-cell">
                  <h2 className="pricing-section-title required">
                    Recurring Service Pricing: Regular Zip Codes
                  </h2>
                  <p className="pricing-section-instruction">
                    If this service is provided, replace the X's with your
                    service pricing. Please contact support if you need
                    assistance.
                  </p>
                  <input
                    type="text"
                    className="pricing-zip-input"
                    value={regularZipCodes}
                    onChange={e => setRegularZipCodes(e.target.value)}
                    placeholder="Zipcode, Zipcode, Zipcode ..."
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Regular recurring pricing zip codes"
                  />
                </div>
                <div className="pricing-zip-cell">
                  <h2 className="pricing-section-title">
                    Recurring Service Pricing: Premium Zip Codes
                  </h2>
                  <p className="pricing-section-instruction">
                    If this service is provided, replace the X's with your
                    service pricing. Please contact support if you need
                    assistance.
                  </p>
                  <input
                    type="text"
                    className="pricing-zip-input"
                    value={premiumZipCodes}
                    onChange={e => setPremiumZipCodes(e.target.value)}
                    placeholder="Zipcode, Zipcode, Zipcode ..."
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Premium recurring pricing zip codes"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* ── Section 4: Recurring pricing — Regular ─────────────── */}
          <section className="pricing-section">
            <div className="pricing-card">
              <h2 className="pricing-section-title required">
                Recurring Service Pricing: Regular Zip Codes
              </h2>
              <p className="pricing-section-instruction">
                If this service is provided, replace the X's with your service
                pricing. Please contact support if you need assistance.
              </p>
              <div className="pricing-grid-3">
                {regularRecurringPricing.map((reg, rowIndex) => {
                  if (!reg) return null;
                  const dog = rowIndex + 1;
                  return (
                    <div className="pricing-dog-block" key={`reg-${dog}`}>
                      <PawLabel>
                        {dog} Dog{dog > 1 ? "s" : ""}
                      </PawLabel>
                      <RecurringBox
                        pricing={reg}
                        onChange={next =>
                          updateRecurringDog(
                            regularRecurringPricing,
                            setRegularRecurringPricing,
                            rowIndex,
                            next
                          )
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* ── Section 5: Recurring pricing — Premium ─────────────── */}
          <section className="pricing-section">
            <div className="pricing-card">
              <h2 className="pricing-section-title">
                Recurring Service Pricing: Premium Zip Codes
              </h2>
              <p className="pricing-section-instruction">
                If this service is provided, replace the X's with your service
                pricing. Please contact support if you need assistance.
              </p>
              <div className="pricing-grid-3">
                {premiumRecurringPricing.map((prem, rowIndex) => {
                  if (!prem) return null;
                  const dog = rowIndex + 1;
                  return (
                    <div className="pricing-dog-block" key={`prem-${dog}`}>
                      <PawLabel>
                        {dog} Dog{dog > 1 ? "s" : ""}
                      </PawLabel>
                      <RecurringBox
                        pricing={prem}
                        onChange={next =>
                          updateRecurringDog(
                            premiumRecurringPricing,
                            setPremiumRecurringPricing,
                            rowIndex,
                            next
                          )
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* ── Section 6: Add-Ons ────────────────────────────────── */}
          {/*
            The Add-Ons textarea is intentionally hidden from the UI for
            now (it is not used in quote generation yet). It stays mapped
            to the add_on_pricing GHL custom value so it is ready when
            we need it — simply remove this comment block to make it
            visible again.
          */}
        </div>
      )}
    </div>
  );
}
