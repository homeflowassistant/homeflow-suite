/**
 * SingleContactForm Component
 *
 * Uses the backend tRPC proxy to create contacts via GHL OAuth tokens.
 * No manual API key configuration needed — the backend handles authentication.
 */

import { useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, UserPlus, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  streetAddress: string;
  city: string;
  state: string;
  postalCode: string;
  numberOfDogs: string;
  lastTimeScooped: string;
  frequency: string;
}

type ContactTagOption =
  | "new lead (via homeflow)"
  | "homeflow: inactive customer"
  | "add-on-campaign"
  | "quick-send";

const TAG_OPTIONS: Array<{ value: ContactTagOption; label: string }> = [
  { value: "new lead (via homeflow)", label: "Lead Follow-Up" },
  { value: "homeflow: inactive customer", label: "Reactivation Campaign" },
  { value: "add-on-campaign", label: "Add-on Campaign" },
  { value: "quick-send", label: "Quick Send" },
];

interface SingleContactFormProps {
  locationId: string;
}

export default function SingleContactForm({ locationId }: SingleContactFormProps) {
  const [formData, setFormData] = useState<FormData>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    streetAddress: "",
    city: "",
    state: "",
    postalCode: "",
    numberOfDogs: "",
    lastTimeScooped: "",
    frequency: "",
  });
  const [dnd, setDnd] = useState(false);
  const [tagOption, setTagOption] = useState<ContactTagOption>("new lead (via homeflow)");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Partial<FormData>>({});

  const createContactMutation = trpc.ghl.createContact.useMutation({
    onSuccess: (result) => {
      toast.success("Contact added successfully!", {
        description: result.enrolledInWorkflow
          ? "Contact has been enrolled in the Review Reactivation workflow."
          : dnd
          ? "Contact marked as Do Not Disturb — not enrolled in workflow."
          : "Contact created.",
        icon: <CheckCircle2 className="h-4 w-4 text-primary" />,
      });

      setFormData({
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        streetAddress: "",
        city: "",
        state: "",
        postalCode: "",
        numberOfDogs: "",
        lastTimeScooped: "",
        frequency: "",
      });
      setDnd(false);
      setTagOption("new lead (via homeflow)");
      setConsent(false);
      setErrors({});
    },
    onError: (error) => {
      toast.error("Failed to add contact", {
        description: error.message || "Unknown error occurred",
      });
    },
  });

  const validate = (): boolean => {
    const newErrors: Partial<FormData> = {};
    if (!formData.firstName.trim()) newErrors.firstName = "First name is required";
    if (!formData.email.trim() && !formData.phone.trim()) {
      newErrors.email = "Email or phone is required";
      newErrors.phone = "Email or phone is required";
    }
    if (formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      newErrors.email = "Invalid email format";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!validate()) return;
    if (!consent) {
      toast.error("Please confirm you have consent to message this customer");
      return;
    }
    createContactMutation.mutate({
      locationId,
      contact: {
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        email: formData.email.trim(),
        phone: formData.phone.trim(),
        address1: formData.streetAddress.trim(),
        city: formData.city.trim(),
        state: formData.state.trim(),
        postalCode: formData.postalCode.trim(),
        dnd,
        tagName: tagOption,
        customFields: [
          { fieldKey: "number_of_dogs", fieldValue: formData.numberOfDogs.trim() },
          { fieldKey: "last_time_yard_was_thoroughly_cleaned", fieldValue: formData.lastTimeScooped.trim() },
          { fieldKey: "clean_up_frequency", fieldValue: formData.frequency.trim() },
        ],
      },
    });
  };

  const handleChange =
    (field: keyof FormData) => (e: ChangeEvent<HTMLInputElement>) => {
      setFormData((prev) => ({ ...prev, [field]: e.target.value }));
      if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
    };

  const isFormValid =
    formData.firstName.trim() &&
    (formData.email.trim() || formData.phone.trim()) &&
    consent;

  const isSubmitting = createContactMutation.isPending;

  return (
    <form onSubmit={handleSubmit} className="scf-form">
      {/* DND toggle row */}
      <div className="scf-dnd-row">
        <span className="scf-req-note">* Required Fields</span>
        <div className="scf-dnd-toggle">
          <span className="scf-dnd-label">Do Not Disturb</span>
          <Switch
            checked={dnd}
            onCheckedChange={setDnd}
            className="data-[state=checked]:bg-cyan-400 h-4 w-7"
          />
        </div>
      </div>

      {/* Name row */}
      <div className="scf-row-2">
        <div className="scf-field">
          <label className="scf-label scf-label--required">First Name</label>
          <input
            type="text"
            value={formData.firstName}
            onChange={handleChange("firstName")}
            placeholder="Enter First Name"
            className={`scf-input ${errors.firstName ? "scf-input--error" : ""}`}
          />
          {errors.firstName && <p className="scf-error">{errors.firstName}</p>}
        </div>
        <div className="scf-field">
          <label className="scf-label">Last Name</label>
          <input
            type="text"
            value={formData.lastName}
            onChange={handleChange("lastName")}
            placeholder="Enter Last Name"
            className="scf-input"
          />
        </div>
      </div>

      {/* Email + Phone row */}
      <div className="scf-row-2">
        <div className="scf-field">
          <label className="scf-label scf-label--required">Email</label>
          <input
            type="email"
            value={formData.email}
            onChange={handleChange("email")}
            placeholder="Enter Email"
            className={`scf-input ${errors.email ? "scf-input--error" : ""}`}
          />
          {errors.email && <p className="scf-error">{errors.email}</p>}
        </div>
        <div className="scf-field">
          <label className="scf-label scf-label--required">Phone Number</label>
          <input
            type="tel"
            value={formData.phone}
            onChange={handleChange("phone")}
            placeholder="Enter Phone Number"
            className={`scf-input ${errors.phone ? "scf-input--error" : ""}`}
          />
          {errors.phone && <p className="scf-error">{errors.phone}</p>}
        </div>
      </div>

      {/* Street Address */}
      <div className="scf-field">
        <label className="scf-label">Street Address</label>
        <input
          type="text"
          value={formData.streetAddress}
          onChange={handleChange("streetAddress")}
          placeholder="Enter Service Address"
          className="scf-input"
        />
      </div>

      {/* City / State / Zip */}
      <div className="scf-row-3">
        <div className="scf-field">
          <label className="scf-label">City</label>
          <input
            type="text"
            value={formData.city}
            onChange={handleChange("city")}
            placeholder="City"
            className="scf-input"
          />
        </div>
        <div className="scf-field">
          <label className="scf-label">State</label>
          <input
            type="text"
            value={formData.state}
            onChange={handleChange("state")}
            placeholder="State"
            className="scf-input"
          />
        </div>
        <div className="scf-field">
          <label className="scf-label">Zip Code</label>
          <input
            type="text"
            value={formData.postalCode}
            onChange={handleChange("postalCode")}
            placeholder="Zip Code"
            className="scf-input"
          />
        </div>
      </div>

      {/* Dogs / Last Scooped / Frequency */}
      <div className="scf-row-3">
        <div className="scf-field">
          <label className="scf-label scf-label--required">No. of Dogs</label>
          <input
            type="text"
            value={formData.numberOfDogs}
            onChange={handleChange("numberOfDogs")}
            placeholder="# of Dogs"
            className="scf-input"
          />
        </div>
        <div className="scf-field">
          <label className="scf-label">Last Scooped</label>
          <input
            type="text"
            value={formData.lastTimeScooped}
            onChange={handleChange("lastTimeScooped")}
            placeholder="Enter Date"
            className="scf-input"
          />
        </div>
        <div className="scf-field">
          <label className="scf-label">Frequency</label>
          <input
            type="text"
            value={formData.frequency}
            onChange={handleChange("frequency")}
            placeholder="Frequency"
            className="scf-input"
          />
        </div>
      </div>

      {/* Campaign tag */}
      <div className="scf-tags">
        <p className="scf-tags-title">Add contacts to:</p>
        <div className="scf-tags-grid">
          {TAG_OPTIONS.map((option) => (
            <label key={option.value} className="scf-radio-label">
              <input
                type="radio"
                name="contactTag"
                value={option.value}
                checked={tagOption === option.value}
                onChange={() => setTagOption(option.value)}
                className="scf-radio"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Consent */}
      <div className="scf-consent">
        <Checkbox
          id="consent"
          checked={consent}
          onCheckedChange={(checked) => setConsent(checked === true)}
          className="mt-0.5 h-4 w-4 border-cyan-300 data-[state=checked]:bg-cyan-400 data-[state=checked]:border-cyan-400"
        />
        <label htmlFor="consent" className="scf-consent-label">
          I have consent to message this customer
        </label>
      </div>

      {/* Submit */}
      <div className="scf-submit-row">
        <Button
          type="submit"
          disabled={!isFormValid || isSubmitting}
          className="scf-submit-btn"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Adding…
            </>
          ) : (
            <>
              <UserPlus className="h-4 w-4 mr-2" />
              Add Contact
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
