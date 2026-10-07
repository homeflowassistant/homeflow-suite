export type HomeFlowTagManifestEntry = {
  key: string;
  purpose: string;
  required: boolean;
  conditionalOn?: "email" | "sms" | "calendar";
};

/**
 * Versioned baseline tag taxonomy from the HomeFlow onboarding reference.
 * Tags are validated server-side; UI components must not hard-code this list.
 */
export const HOMEFLOW_TAG_MANIFEST_VERSION = "1.0.0";

export const HOMEFLOW_TAG_MANIFEST: HomeFlowTagManifestEntry[] = [
  { key: "hf_source", purpose: "Original acquisition source", required: true },
  { key: "hf_lifecycle", purpose: "Current lifecycle stage", required: true },
  { key: "hf_service", purpose: "Requested HomeFlow service", required: true },
  { key: "hf_status", purpose: "Operational processing state", required: true },
  { key: "hf_owner", purpose: "Assigned team or user identifier", required: true },
  { key: "hf_consent_email", purpose: "Email consent state", required: false, conditionalOn: "email" },
  { key: "hf_consent_sms", purpose: "SMS consent state", required: false, conditionalOn: "sms" },
  { key: "hf_booking_status", purpose: "Appointment status", required: false, conditionalOn: "calendar" },
  { key: "hf_customer_type", purpose: "Customer classification", required: false },
];
