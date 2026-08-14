import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  getLocationCustomValueMap,
  updateExistingCustomValuesOnly,
  upsertGhlCustomValue,
} from "../ghl-service";

// ─── GHL custom value keys ────────────────────────────────────────────
// The Pricing page consolidates all of its data into three custom values
// that the client's GHL sub-account uses (the legacy per-section keys are
// still accepted on READ as fallbacks for sub-accounts not yet migrated):
//
//   initial_and_recurring_pricing  -> Initial Service Pricing + Regular ZIP
//                                     codes + Regular Recurring + Premium
//                                     ZIP codes + Premium Recurring (one
//                                     composed text block, FAQ_PriceList
//                                     template structure used by n8n)
//   onetime_pricing                -> One-Time Service Pricing (composed
//                                     per-dog blocks, FAQ_OneTimeQuotes
//                                     template structure used by n8n)
//   add_on_pricing                 -> Add-Ons (single free-text block;
//                                     currently not shown in the UI)
//
// Writes go to the canonical key plus a display-name alias. Values are
// written with updateExistingCustomValuesOnly (never creates duplicate
// fields) plus upsertGhlCustomValue for the primary keys.
const PRICING_KEYS = {
  // Primary consolidated keys
  initialAndRecurring: "initial_and_recurring_pricing",
  onetime: "onetime_pricing",
  addOns: "add_on_pricing",
  // Legacy per-section keys (READ-ONLY fallbacks, never written)
  legacyFaqPriceList: "faq_price_list",
  legacyFaqOneTimeQuotes: "faq_one_time_quotes",
  legacyRegularZipCodes: "regular_pricing_zip_codes",
  legacyRegularRecurring: "regular_recurring_pricing",
  legacyPremiumZipCodes: "premium_pricing_zip_codes",
  legacyPremiumRecurring: "premium_recurring_pricing",
  legacyCrossSells: "cross_sells",
} as const;

// ─── Data shapes ───────────────────────────────────────────────────────

/** One dog sub-box: heading + its free text (Initial / One-Time sections). */
interface FaqEntry {
  dogLabel: string;
  value: string;
}

/**
 * One recurring dog sub-box: heading + ONE free-text block containing
 * one rate line per service frequency (e.g. 2x weekly, Weekly, Biweekly,
 * Monthly). Extra lines can be added freely by the client for future
 * frequencies (3x weekly, 4x weekly, ...).
 */
interface RecurringEntry {
  dogCount: number;
  /** Multi-line text, one rate line per line. */
  text: string;
}

const DOG_COUNTS = [1, 2, 3, 4, 5, 6];

// ─── Instruction copy shown in every field default ─────────────────────
// Client instruction (verbatim from the client's request).
const FIELD_INSTRUCTION =
  "If this service is provided, replace the X's with your service pricing.  Please contact support if you need assistance.";

// ─── Default values (shown when GHL returns nothing) ──────────────────
// Generic XX/XX.XX placeholders that work for every client. Real prices
// are never leaked as defaults.

function makeInitialDefault(dogs: number): FaqEntry {
  return {
    dogLabel: dogs === 6 ? "6+ Dogs" : `${dogs} Dog${dogs > 1 ? "s" : ""}`,
    value: `${FIELD_INSTRUCTION}\nInitial service starts at $XX and covers the first two bags. Additional bags are charged at $XX each. Only applies to initial cleanup and does not apply to weekly service.`,
  };
}

function makeOneTimeDefault(dogs: number): FaqEntry {
  return {
    dogLabel: `${dogs} Dog${dogs > 1 ? "s" : ""}`,
    value: `${FIELD_INSTRUCTION}\nOne-time service starts at $XX and covers the first two bags. Additional bags are charged at $XX each.`,
  };
}

/**
 * Build the prefilled recurring text block for one dog count using the
 * client's line wording ("2x weekly Recurring Quote Rate for N dogs:
 * $XX.XX per service") with neutral XX/XX.XX placeholders.
 */
function makeRecurringDefault(dogs: number): RecurringEntry {
  const dogWord = `${dogs} dog${dogs > 1 ? "s" : ""}`;
  const freqLines: [string, string][] = [
    ["2x weekly", "2x weekly Recurring Quote Rate"],
    ["Weekly", "Weekly Recurring Quote Rate"],
    ["Biweekly", "Biweekly Recurring Quote Rate"],
    ["Monthly", "Monthly Recurring Quote Rate"],
  ];
  const lines = freqLines.map(
    ([_key, label]) => `${label} for ${dogWord}: $XX.XX per service`
  );
  return { dogCount: dogs, text: lines.join("\n") };
}

function buildDefaults() {
  return {
    initialPricing: DOG_COUNTS.map(makeInitialDefault),
    oneTimePricing: DOG_COUNTS.map(makeOneTimeDefault),
    regularZipCodes: "",
    regularRecurringPricing: DOG_COUNTS.map(makeRecurringDefault),
    premiumZipCodes: "",
    premiumRecurringPricing: DOG_COUNTS.map(makeRecurringDefault),
    crossSells: `${FIELD_INSTRUCTION}\nAdd-on name: $XX per visit`,
  };
}

// ─── Composed block templates (n8n FAQ_PriceList / FAQ_OneTimeQuotes) ──

const DOG_LABELS: Record<number, string> = {
  1: "1 Dog",
  2: "2 Dogs",
  3: "3 Dogs",
  4: "4 Dogs",
  5: "5 Dogs",
  6: "6+ Dogs",
};

/**
 * Compose the initial-and-recurring block matching the n8n
 * FAQ_PriceList template structure:
 *   # Initial Service Pricing for <N Dog(s)>
 *   <free text>
 *   # Rule: Regular Recurring Pricing Applies to these zip codes:
 *   [<zip list>]
 *   ## Regular Recurring Service Pricing for <N> DOG:
 *   <free text>
 *   # Rule: Premium Recurring Pricing Applies to these zip codes
 *   (Ignore Premium Recurring Service Pricing Section if prices or
 *   zip codes are blank/duplicate):
 *   [<zip list>]
 *   ## Premium Recurring Service Pricing for <N> DOG:
 *   <free text>
 */
function composeInitialAndRecurring(input: {
  initialPricing: FaqEntry[];
  regularZipCodes: string;
  regularRecurringPricing: RecurringEntry[];
  premiumZipCodes: string;
  premiumRecurringPricing: RecurringEntry[];
}): string {
  const parts: string[] = [];

  for (const entry of input.initialPricing) {
    if (!entry.value.trim()) continue;
    parts.push(
      `# Initial Service Pricing for ${entry.dogLabel}`,
      entry.value.trim()
    );
  }

  parts.push("# Rule: Regular Recurring Pricing Applies to these zip codes:");
  parts.push(`[${input.regularZipCodes.trim()}]`);

  for (const row of input.regularRecurringPricing) {
    if (!row.text.trim()) continue;
    parts.push(
      `## Regular Recurring Service Pricing for ${row.dogCount} DOG${row.dogCount > 1 ? "S" : ""}:`,
      row.text.trim()
    );
  }

  parts.push(
    "# Rule: Premium Recurring Pricing Applies to these zip codes (Ignore Premium Recurring Service Pricing Section if prices or zip codes are blank/duplicate):"
  );
  parts.push(`[${input.premiumZipCodes.trim()}]`);

  for (const row of input.premiumRecurringPricing) {
    if (!row.text.trim()) continue;
    parts.push(
      `## Premium Recurring Service Pricing for ${row.dogCount} DOG${row.dogCount > 1 ? "S" : ""}:`,
      row.text.trim()
    );
  }

  return parts.join("\n");
}

/**
 * Parse a composed FAQ_OneTimeQuotes-style one-time block back into one
 * FaqEntry per dog count. Used on both the primary and legacy branches so
 * each dog box shows only its own quote text.
 */
function parseOneTimeEntries(raw: string, fallbacks: FaqEntry[]): FaqEntry[] {
  if (!raw) return fallbacks;
  const lines = raw
    .split(/\n+/)
    .map(l => l.trim())
    .filter(Boolean);
  const perDog = new Map<number, string[]>();
  let current = -1;
  for (const l of lines) {
    const header = l.match(/^#\s*One-Time Service Pricing For\s+(\d+)\s*DOG/i);
    if (header) {
      current = Number(header[1]);
      if (!perDog.has(current)) perDog.set(current, []);
      continue;
    }
    if (current !== -1 && l) perDog.get(current)?.push(l);
  }
  // Body lines only (headers stripped) so the prose fallback never picks
  // up a header line as a match for another dog.
  const bodyOnly = lines
    .filter(l => !/^#\s*One-Time Service Pricing For\s+\d+\s*DOG/i.test(l))
    .join("\n");
  return fallbacks.map((def, i) => {
    const section = perDog.get(i + 1);
    const value =
      section && section.length > 0
        ? section.join("\n")
        : buildOneTimeFallback(bodyOnly, fallbacks)[i].value;
    return { ...def, value };
  });
}

/** Prose fallback: first body line mentioning the dog label. */
function buildOneTimeFallback(raw: string, fallbacks: FaqEntry[]): FaqEntry[] {
  if (!raw) return fallbacks;
  const lines = raw
    .split(/\n+/)
    .map(l => l.trim())
    .filter(Boolean);
  return fallbacks.map(def => {
    const match = lines.find(l =>
      new RegExp(`\\b${def.dogLabel.replace("+", "\\+")}`, "i").test(l)
    );
    return { ...def, value: match ?? raw };
  });
}

/**
 * Compose the one-time block matching the n8n FAQ_OneTimeQuotes
 * template structure:
 *   # One-Time Service Pricing For <N> DOG:
 *   <free text>
 */
function composeOneTime(entries: FaqEntry[]): string {
  const parts: string[] = [];
  for (const entry of entries) {
    if (!entry.value.trim()) continue;
    const dogs =
      entry.dogLabel.toLowerCase().includes("+") ||
      entry.dogLabel.toLowerCase().includes("dogs")
        ? "DOGS"
        : "DOG";
    parts.push(
      `# One-Time Service Pricing For ${entry.dogLabel.toUpperCase()}:`
    );
    void dogs;
    parts.push(entry.value.trim());
  }
  return parts.join("\n");
}

// ─── Reverse parsing (composed block -> per-dog fields) ────────────────

/**
 * Split a composed block into per-dog sections keyed by dog count, then
 * map each dog count to its textarea text. Returns undefined entries
 * untouched when no matching section exists.
 */
function parsePerDogSections(
  raw: string,
  headers: RegExp[],
  defaults: { dogCount: number }[]
): Map<number, string> {
  const map = new Map<number, string>();
  const lines = raw.split("\n");
  let current = -1;
  const buffer = new Map<number, string[]>();

  for (const line of lines) {
    let matched = false;
    for (let i = 0; i < headers.length; i += 1) {
      const headerMatch = line.match(headers[i]);
      if (headerMatch && headerMatch[1]) {
        current = Number(headerMatch[1]);
        if (!buffer.has(current)) buffer.set(current, []);
        matched = true;
        break;
      }
    }
    if (!matched && current !== -1 && line.trim()) {
      buffer.get(current)?.push(line.trim());
    }
  }

  for (const { dogCount } of defaults) {
    const section = buffer.get(dogCount);
    if (section && section.length > 0) {
      map.set(dogCount, section.join("\n"));
    }
  }
  return map;
}

const INITIAL_SECTION_HEADERS = DOG_COUNTS.map(
  d =>
    new RegExp(
      `^#\\s*Initial Service Pricing for ${d} Dog${d > 1 ? "s" : ""}\\s*$`,
      "i"
    )
);

const ONETIME_SECTION_HEADERS = DOG_COUNTS.map(
  d =>
    new RegExp(
      `^#\\s*One-Time Service Pricing For ${d} DOG${d > 1 ? "S" : ""}:?\\s*$`,
      "i"
    )
);

const REGULAR_RECURRING_HEADERS = DOG_COUNTS.map(
  d =>
    new RegExp(
      `^##\\s*Regular Recurring Service Pricing for ${d} DOG${d > 1 ? "S" : ""}:?\\s*$`,
      "i"
    )
);

const PREMIUM_RECURRING_HEADERS = DOG_COUNTS.map(
  d =>
    new RegExp(
      `^##\\s*Premium Recurring Service Pricing for ${d} DOG${d > 1 ? "S" : ""}:?\\s*$`,
      "i"
    )
);

/**
 * Parse recurring prose into the client's free-text line format.
 * Handles both the new line wording ("2x weekly Recurring Quote Rate for
 * 3 dogs: $19 per service") and the legacy format used by the first
 * version of this page ("1 Dog\n2x Weekly: $18.69 per service").
 * Lines that match this dog's count are kept verbatim; other dogs'
 * lines are dropped so each textarea shows only its own rates.
 */
function parseRecurringText(raw: string, dogCount: number): string {
  const dogWord = `${dogCount} dog${dogCount > 1 ? "s" : ""}`;
  const lines = raw
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const line of lines) {
    // New wording: frequency label line mentioning this dog count
    if (
      /recurring quote rate/i.test(line) &&
      new RegExp(dogWord, "i").test(line)
    ) {
      out.push(line);
      continue;
    }
    // Legacy format: header lines like "1 Dog" / "2 Dogs" start a block
    if (/^\d+\s*dogs?$/i.test(line)) {
      // subsequent rate lines belong to this block — we process those
      // lines individually below, so just track the current block header
      continue;
    }
    // Legacy rate line under this dog's block: "<Freq>: $X per service"
    const legacyMatch = line.match(
      /^((?:2x\s+)?weekly|biweekly|monthly)\s*:\s*(.+)$/i
    );
    if (legacyMatch) {
      const freqRaw = legacyMatch[1];
      const freq = freqRaw.toLowerCase().includes("2x")
        ? "2x weekly"
        : freqRaw.toLowerCase();
      const rate = legacyMatch[2].trim();
      out.push(
        `${freq.charAt(0).toUpperCase() + freq.slice(1)} Recurring Quote Rate for ${dogWord}: ${rate}`
      );
    }
  }

  // Preserve per-dog rate lines for legacy blocks: re-scan with block
  // tracking when the new-wording pass found nothing for this dog.
  if (out.length === 0) {
    let currentDogs = -1;
    for (const line of lines) {
      const header = line.match(/^(\d+)\s*dogs?$/i);
      if (header) {
        currentDogs = Number(header[1]);
        continue;
      }
      if (currentDogs === dogCount) {
        const legacyMatch = line.match(
          /^((?:2x\s+)?weekly|biweekly|monthly)\s*:\s*(.+)$/i
        );
        if (legacyMatch) {
          const freqRaw = legacyMatch[1];
          const freq = freqRaw.toLowerCase().includes("2x")
            ? "2x weekly"
            : freqRaw.toLowerCase();
          const rate = legacyMatch[2].trim();
          out.push(
            `${freq.charAt(0).toUpperCase() + freq.slice(1)} Recurring Quote Rate for ${dogWord}: ${rate}`
          );
        }
      }
    }
  }

  return out.join("\n");
}

// ─── Router ────────────────────────────────────────────────────────────

export const pricingRouter = router({
  /**
   * Load current pricing settings from GHL custom values.
   * Primary source: the three consolidated custom values
   * (initial_and_recurring_pricing, onetime_pricing, add_on_pricing),
   * parsed back into per-dog fields. Legacy per-section keys are used
   * as a fallback for sub-accounts not yet migrated.
   */
  getSettings: publicProcedure
    .input(z.object({ locationId: z.string().min(1) }))
    .query(async ({ input }) => {
      if (!input.locationId) return buildDefaults();

      try {
        const cvMap = await getLocationCustomValueMap(input.locationId);

        const getValueForKeys = (keys: string[]): string | undefined => {
          for (const k of keys) {
            const entry =
              cvMap.get(k) ||
              cvMap.get(k.toLowerCase().replace(/[^a-z0-9]/g, ""));
            if (
              entry?.value !== undefined &&
              entry.value !== null &&
              entry.value !== ""
            ) {
              return entry.value;
            }
          }
          return undefined;
        };

        const str = (keys: string[], fallback: string): string =>
          getValueForKeys(keys) ?? fallback;

        // ── Primary source: the three consolidated custom values ─────
        const rawInitialAndRecurring = str(
          [
            PRICING_KEYS.initialAndRecurring,
            "Initial And Recurring Pricing",
            "initial and recurring pricing",
            "Initial And Recurring",
          ],
          ""
        );
        const rawOneTime = str(
          [
            PRICING_KEYS.onetime,
            "OneTime Pricing",
            "One-Time Pricing",
            "onetime",
          ],
          ""
        );
        const rawAddOns = str(
          [
            PRICING_KEYS.addOns,
            "Add On Pricing",
            "Add-On Pricing",
            "Add On",
            "add_on",
          ],
          ""
        );

        const defaults = buildDefaults();

        if (rawInitialAndRecurring) {
          // Parse composed FAQ_PriceList-style block back into fields.
          const sections = rawInitialAndRecurring.split(/\n+/);

          const readInitialSection = (dogs: number): string | undefined => {
            const label = `${dogs} Dog${dogs > 1 ? "s" : ""}`;
            const idx = sections.findIndex(l =>
              new RegExp(
                `^#\\s*Initial Service Pricing for ${label.replace("+", "\\+")}\\s*$`,
                "i"
              ).test(l)
            );
            if (idx === -1) return undefined;
            const textLines: string[] = [];
            for (let i = idx + 1; i < sections.length; i += 1) {
              const l = sections[i];
              const isZipBracket =
                l.trim().startsWith("[") && l.trim().endsWith("]");
              if (isZipBracket) break;
              if (/^# Rule:/i.test(l)) break;
              textLines.push(l);
            }
            return textLines.join("\n") || undefined;
          };

          const readZipBlock = (rulePrefix: string): string => {
            const idx = sections.findIndex(l =>
              new RegExp(`^# Rule: ${rulePrefix}`, "i").test(l)
            );
            if (idx === -1) return "";
            const next = sections[idx + 1] ?? "";
            const bracketStart = next.indexOf("[");
            const bracketEnd = next.lastIndexOf("]");
            if (bracketStart === -1 || bracketEnd <= bracketStart) return "";
            return next.slice(bracketStart + 1, bracketEnd);
          };

          const readRecurringBlocks = (
            prefix: "Regular" | "Premium"
          ): RecurringEntry[] =>
            DOG_COUNTS.map(dogCount => {
              const label = `${dogCount} Dog${dogCount > 1 ? "s" : ""}`;
              const idx = sections.findIndex(l =>
                new RegExp(
                  `^##\\s*${prefix} Recurring Service Pricing for ${label}\\s*[:]?\\s*$`,
                  "i"
                ).test(l)
              );
              if (idx === -1) {
                return {
                  dogCount,
                  text:
                    prefix === "Premium"
                      ? ""
                      : defaults.regularRecurringPricing[dogCount - 1].text,
                };
              }
              const textLines: string[] = [];
              for (let i = idx + 1; i < sections.length; i += 1) {
                const l = sections[i];
                const isZipBracket =
                  l.trim().startsWith("[") && l.trim().endsWith("]");
                if (isZipBracket) break;
                if (/^# Rule:/i.test(l)) break;
                if (l.trim()) textLines.push(l);
              }
              return {
                dogCount,
                text: parseRecurringText(textLines.join("\n"), dogCount),
              };
            });

          const initialPricing = DOG_COUNTS.map(dogCount => {
            const text = readInitialSection(dogCount);
            const def = defaults.initialPricing[dogCount - 1];
            return {
              ...def,
              value: text ?? def.value,
            };
          });

          const regularZipCodes = readZipBlock(
            "Regular Recurring Pricing Applies"
          );
          const premiumZipCodes = readZipBlock(
            "Premium Recurring Pricing Applies"
          );

          return {
            initialPricing,
            oneTimePricing: parseOneTimeEntries(
              rawOneTime,
              defaults.oneTimePricing
            ),
            regularZipCodes,
            regularRecurringPricing: readRecurringBlocks("Regular"),
            premiumZipCodes,
            premiumRecurringPricing: readRecurringBlocks("Premium"),
            crossSells:
              rawAddOns !== undefined ? rawAddOns : defaults.crossSells,
          };
        }

        // ── No primary block: one-time & add-ons may still be primary ──
        // (rawOneTime may exist as the primary key even without the
        // initial-and-recurring block)
        const oneTimePricingRaw =
          rawOneTime ||
          // Legacy fallback (one-time legacy key)
          getValueForKeys([
            PRICING_KEYS.legacyFaqOneTimeQuotes,
            "One-Time Quotes",
            "one_time_quotes",
          ]);

        const legacyInitial = getValueForKeys([
          PRICING_KEYS.legacyFaqPriceList,
          "Price List",
          "price_list",
        ]);
        const legacyRegularZip = getValueForKeys([
          PRICING_KEYS.legacyRegularZipCodes,
          "Recurring Pricing Zip Codes",
          "recurring_pricing_zip_codes",
        ]);
        const legacyRegularRecurring = getValueForKeys([
          PRICING_KEYS.legacyRegularRecurring,
          "Regular Recurring Pricing",
          "regular_recurring_pricing",
        ]);
        const legacyPremiumZip = getValueForKeys([
          PRICING_KEYS.legacyPremiumZipCodes,
          "Premium Pricing Zip Codes",
          "premium_pricing_zip_codes",
        ]);
        const legacyPremiumRecurring = getValueForKeys([
          PRICING_KEYS.legacyPremiumRecurring,
          "Premium Recurring Pricing",
          "premium_recurring_pricing",
        ]);
        const legacyCrossSells = getValueForKeys([
          PRICING_KEYS.legacyCrossSells,
          "Cross Sells",
          "cross_sells",
        ]);

        // FAQ-style prose field split into editable dog boxes.
        const buildFaqEntries = (
          raw: string,
          fallbacks: FaqEntry[]
        ): FaqEntry[] => {
          if (!raw) return fallbacks;
          const lines = raw
            .split(/\n+/)
            .map(l => l.trim())
            .filter(Boolean);
          return fallbacks.map(def => {
            const match = lines.find(l =>
              new RegExp(`\\b${def.dogLabel.replace("+", "\\+")}`, "i").test(l)
            );
            return { ...def, value: match ?? raw };
          });
        };

        const buildRecurring = (
          raw: string | undefined,
          fallbacks: RecurringEntry[],
          isPremium: boolean
        ): RecurringEntry[] => {
          if (!raw) return fallbacks;
          return fallbacks.map(def => {
            const blockMatch = raw
              .split(/\n{2,}/)
              .find(block =>
                new RegExp(`\\b${def.dogCount}\\s*dog`, "i").test(block)
              );
            const text = blockMatch ?? raw;
            const parsed = parseRecurringText(text, def.dogCount);
            return {
              dogCount: def.dogCount,
              text: parsed || (isPremium ? "" : def.text),
            };
          });
        };

        return {
          initialPricing: buildFaqEntries(
            legacyInitial ?? "",
            defaults.initialPricing
          ),
          oneTimePricing: parseOneTimeEntries(
            oneTimePricingRaw ?? "",
            defaults.oneTimePricing
          ),
          regularZipCodes: legacyRegularZip ?? defaults.regularZipCodes,
          regularRecurringPricing: buildRecurring(
            legacyRegularRecurring,
            defaults.regularRecurringPricing,
            false
          ),
          premiumZipCodes: legacyPremiumZip ?? defaults.premiumZipCodes,
          premiumRecurringPricing: buildRecurring(
            legacyPremiumRecurring,
            defaults.premiumRecurringPricing,
            true
          ),
          crossSells:
            rawAddOns !== undefined && rawAddOns !== ""
              ? rawAddOns
              : (legacyCrossSells ?? defaults.crossSells),
        };
      } catch (err) {
        console.warn(
          "[Pricing] Failed to load pricing custom values from GHL, using defaults:",
          err
        );
        return buildDefaults();
      }
    }),

  /**
   * Save pricing settings to GHL custom values.
   * All page data is consolidated into the three client custom values:
   *   initial_and_recurring_pricing  (composed FAQ_PriceList-style block)
   *   onetime_pricing                (composed FAQ_OneTimeQuotes-style blocks)
   *   add_on_pricing                 (single free-text block)
   * Writes go to the canonical key and a display-name alias. Step 1
   * (updateExistingCustomValuesOnly) only touches custom values that
   * already exist — it never creates fields; step 2 (upsertGhlCustomValue)
   * re-attempts the canonical keys.
   */
  saveSettings: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1, "Location ID is required"),
        initialPricing: z.array(
          z.object({ dogLabel: z.string(), value: z.string() })
        ),
        oneTimePricing: z.array(
          z.object({ dogLabel: z.string(), value: z.string() })
        ),
        regularZipCodes: z.string(),
        regularRecurringPricing: z.array(
          z.object({
            dogCount: z.number().int().min(1).max(6),
            text: z.string(),
          })
        ),
        premiumZipCodes: z.string(),
        premiumRecurringPricing: z.array(
          z.object({
            dogCount: z.number().int().min(1).max(6),
            text: z.string(),
          })
        ),
        crossSells: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const locationId = input.locationId.trim();
        if (!locationId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Location ID cannot be empty",
          });
        }

        // ── Validation ───────────────────────────────────────────────
        // Each non-empty line of a recurring text block must express a
        // monetary rate (optionally with "per service" suffix), or one of
        // the accepted non-numeric statuses ("N/A", "not offered",
        // "not offered currently"). The neutral $XX / $XX.XX placeholders
        // from the page defaults are also accepted so a client can save
        // defaults as-is. Free text around the rate is kept so the
        // client's wording is preserved and new frequencies work.
        const moneyRegex = /\$\s?(?:XX(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i;
        const statusRegex = /^(n\/a|not offered(\s+currently)?)$/i;

        const validateRecurring = (
          rows: typeof input.regularRecurringPricing,
          tier: "regular" | "premium"
        ): void => {
          for (const row of rows) {
            const lines = row.text.split("\n").filter(l => l.trim());
            for (const line of lines) {
              const t = line.trim();
              if (statusRegex.test(t)) continue;
              // Allow lines that carry their own status phrase anywhere,
              // e.g. "Biweekly Recurring Quote Rate for 5 dogs: not offered"
              if (/not offered|n\/a/i.test(t)) continue;
              if (!moneyRegex.test(t)) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: `${tier} tier, ${row.dogCount} dog${row.dogCount > 1 ? "s" : ""}: line "${line.trim()}" must contain a rate like $18.69 per service, "N/A", "not offered currently", or an $XX placeholder`,
                });
              }
            }
          }
        };

        validateRecurring(input.regularRecurringPricing, "regular");
        validateRecurring(input.premiumRecurringPricing, "premium");

        // ZIP codes: 5-digit groups separated by commas/whitespace, or empty.
        const zipRegex = /^(\d{5})(?:\s*,\s*\d{5})*$/;
        for (const [field, value] of [
          ["Regular", input.regularZipCodes],
          ["Premium", input.premiumZipCodes],
        ] as const) {
          const trimmed = value.trim();
          if (!trimmed) continue; // premium may be empty
          const codes = trimmed.split(/[\s,]+/).filter(Boolean);
          for (const code of codes) {
            if (!/^\d{5}$/.test(code)) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `${field} ZIP codes: "${code}" is not a valid 5-digit ZIP code`,
              });
            }
          }
        }

        // ── Compose the three consolidated custom values ─────────────
        const initialAndRecurringText = composeInitialAndRecurring({
          initialPricing: input.initialPricing,
          regularZipCodes: input.regularZipCodes,
          regularRecurringPricing: input.regularRecurringPricing,
          premiumZipCodes: input.premiumZipCodes,
          premiumRecurringPricing: input.premiumRecurringPricing,
        });
        const oneTimeText = composeOneTime(input.oneTimePricing);

        // ── Payload: primary key + display-name aliases ──────────────
        // Mirrors the alertsNotifications save flow: write under the
        // snake_case key and under a human display-name alias so keys
        // that exist under either variant in the client's sub-account
        // are updated. updateExistingCustomValuesOnly only touches
        // custom values that already exist — it never creates fields.
        const customValuePayload: Record<string, string> = {
          [PRICING_KEYS.initialAndRecurring]: initialAndRecurringText,
          [PRICING_KEYS.onetime]: oneTimeText,
          [PRICING_KEYS.addOns]: input.crossSells.trim(),
          // Display-name aliases for dual-write coverage
          "Initial And Recurring Pricing": initialAndRecurringText,
          "OneTime Pricing": oneTimeText,
          "Add On Pricing": input.crossSells.trim(),
        };

        // Step 1: Update existing custom values only (never creates).
        await updateExistingCustomValuesOnly(locationId, customValuePayload);

        // Step 2: Re-attempt primary keys for full sub-account coverage.
        const primaryEntries: [string, string][] = [
          [PRICING_KEYS.initialAndRecurring, initialAndRecurringText],
          [PRICING_KEYS.onetime, oneTimeText],
          [PRICING_KEYS.addOns, input.crossSells.trim()],
        ];

        for (const [key, val] of primaryEntries) {
          try {
            await upsertGhlCustomValue(locationId, key, val);
          } catch (e) {
            console.warn(`[Pricing] Upsert custom value '${key}':`, e);
          }
        }

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const msg = error instanceof Error ? error.message : "Unknown error";
        console.error("[Pricing] saveSettings error:", msg);
        if (
          msg.includes("401") ||
          msg.includes("Unauthorized") ||
          msg.includes("token")
        ) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message:
              "GHL authentication failed. Your access token may be missing or expired.",
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: msg || "Failed to save pricing settings. Please try again.",
        });
      }
    }),
});
