import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Facebook } from "lucide-react";
import { toast } from "sonner";
import TopSaveButton from "@/components/TopSaveButton";
import { useOnboardingSaveHandler } from "@/components/OnboardingSaveContext";
import { trpc } from "@/lib/trpc";

type FacebookSetupStatus = "yes" | "not-yet";

function getFacebookStatusStorageKey(locationId: string): string {
  return `homeflow:facebook-setup-status:${locationId}`;
}

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
  const [setupStatus, setSetupStatus] =
    useState<FacebookSetupStatus>("not-yet");

  // The answer is stored in the facebook_setup_status GHL custom value so
  // onboarding progress can see it on any device. The older browser-only
  // copy is used only when nothing is stored in GHL yet.
  const statusQuery = trpc.onboarding.getFacebookStatus.useQuery(
    { locationId },
    { enabled: Boolean(locationId), staleTime: 0 }
  );
  const saveMutation = trpc.onboarding.saveFacebookStatus.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!locationId || statusQuery.isLoading) return;
    const remote = statusQuery.data?.status;
    if (remote) {
      setSetupStatus(remote);
      return;
    }
    let local: string | null = null;
    try {
      local = window.localStorage.getItem(
        getFacebookStatusStorageKey(locationId)
      );
    } catch {
      /* storage unavailable */
    }
    if (local === "yes" || local === "not-yet") setSetupStatus(local);
  }, [locationId, statusQuery.isLoading, statusQuery.data?.status]);

  const handleSave = useCallback(async () => {
    if (!locationId) {
      toast.error(
        "A location ID is required before Facebook setup can be saved."
      );
      return;
    }

    try {
      await saveMutation.mutateAsync({ locationId, status: setupStatus });
      try {
        window.localStorage.setItem(
          getFacebookStatusStorageKey(locationId),
          setupStatus
        );
      } catch {
        /* storage unavailable */
      }
      void utils.onboarding.getStatus.invalidate();
      toast.success("Facebook setup status saved.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Facebook setup status could not be saved."
      );
    }
  }, [locationId, setupStatus, saveMutation, utils]);

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
            isSaving={false}
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
            Open the CRM Settings area and connect the client&apos;s Facebook
            Page.
          </li>
          <li>Map the Facebook form fields to the HomeFlow contact fields.</li>
          <li>
            Use the question below to confirm whether both steps are complete.
          </li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold leading-relaxed text-slate-900">
          Have you connected your Facebook Page and mapped your Instant Form
          fields to HomeFlow?
        </h2>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-blue-300 hover:bg-blue-50/40">
          <input
            type="radio"
            name="facebook-setup-status"
            value="yes"
            checked={setupStatus === "yes"}
            onChange={() => setSetupStatus("yes")}
            className="mt-1 h-4 w-4 accent-blue-600"
          />
          <span className="text-sm font-medium text-slate-800">
            Yes, I&apos;ve completed both steps.
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-blue-300 hover:bg-blue-50/40">
          <input
            type="radio"
            name="facebook-setup-status"
            value="not-yet"
            checked={setupStatus === "not-yet"}
            onChange={() => setSetupStatus("not-yet")}
            className="mt-1 h-4 w-4 accent-blue-600"
          />
          <span className="text-sm font-medium text-slate-800">
            Not yet. I&apos;ll do it later or I&apos;m not using Facebook
            Instant Forms.
          </span>
        </label>
        <p className="text-xs leading-relaxed text-slate-500">
          The Facebook Page URL is collected on Account Setup. This step only
          confirms the connection and Instant Form mapping status.
        </p>
      </section>

      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p>
          Choose the option that matches your current setup. Next Step saves the
          onboarding progress before moving forward.
        </p>
      </div>
    </div>
  );
}
