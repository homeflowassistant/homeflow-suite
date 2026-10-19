import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Facebook, Link2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import TopSaveButton from "@/components/TopSaveButton";
import { useOnboardingSaveHandler } from "@/components/OnboardingSaveContext";

function useLocationId() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get("locationId")?.trim() ||
      params.get("location_id")?.trim() ||
      params.get("subAccountId")?.trim() ||
      ""
    );
  }, []);
}

export default function FacebookSetupPage(props: any = {}) {
  const embedded = Boolean(props.embedded);
  const locationId = useLocationId();
  const [facebookPageLink, setFacebookPageLink] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const settingsQuery = trpc.accountSetup.getSettings.useQuery(
    { locationId },
    { enabled: Boolean(locationId) }
  );
  const saveFieldMutation = trpc.accountSetup.saveField.useMutation();

  useEffect(() => {
    if (settingsQuery.data) {
      setFacebookPageLink(settingsQuery.data.facebookPageLink || "");
    }
  }, [settingsQuery.data]);

  const handleSave = useCallback(async () => {
    if (!locationId) {
      toast.error(
        "A location ID is required before Facebook setup can be saved."
      );
      return;
    }

    setIsSaving(true);
    try {
      await saveFieldMutation.mutateAsync({
        locationId,
        field: "facebookPageLink",
        value: facebookPageLink.trim(),
      });
      toast.success("Facebook setup saved.");
      await settingsQuery.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Facebook setup could not be saved."
      );
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [facebookPageLink, locationId, saveFieldMutation, settingsQuery]);

  useOnboardingSaveHandler(embedded, handleSave);

  if (!locationId) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
        Open this setup page from a subaccount or include a location ID in the
        URL.
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
            <Facebook className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Facebook Setup</h1>
            <p className="text-sm text-slate-600">
              Connect the Facebook Page used for lead generation and value
              mapping.
            </p>
          </div>
        </div>
        {!embedded && (
          <TopSaveButton
            onClick={() => void handleSave()}
            isSaving={isSaving || saveFieldMutation.isPending}
            label="Save"
          />
        )}
      </header>

      <section className="rounded-xl border border-blue-200 bg-blue-50/70 p-5">
        <h2 className="text-base font-semibold text-blue-950">
          What to complete
        </h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-blue-950/80">
          <li>
            Open the CRM Settings area and connect the client’s Facebook Page.
          </li>
          <li>Map the Facebook form fields to the HomeFlow contact fields.</li>
          <li>Copy the public Facebook Page URL into the field below.</li>
          <li>
            Use Next Step after checking the connection. Next Step saves this
            page.
          </li>
        </ol>
      </section>

      <section className="space-y-2">
        <label
          htmlFor="facebook-page-link"
          className="flex items-center gap-2 text-sm font-semibold text-slate-900"
        >
          <Link2 className="h-4 w-4 text-blue-700" aria-hidden="true" />
          Facebook Page URL
        </label>
        <input
          id="facebook-page-link"
          type="url"
          value={facebookPageLink}
          onChange={event => setFacebookPageLink(event.target.value)}
          placeholder="https://www.facebook.com/your-page"
          disabled={settingsQuery.isLoading || isSaving}
          className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none ring-blue-500 focus:ring-2"
        />
        <p className="text-xs leading-relaxed text-slate-500">
          This value is stored as the Facebook Page Link custom value and is
          used by HomeFlow campaign messages.
        </p>
      </section>

      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p>
          When the Facebook connection and field mapping are complete, click
          Next Step. The onboarding flow saves the page before moving forward.
        </p>
      </div>
    </div>
  );
}
