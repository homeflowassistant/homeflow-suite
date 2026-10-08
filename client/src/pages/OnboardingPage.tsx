import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  ClipboardCheck,
  Info,
  Loader2,
  RefreshCw,
  ShieldAlert,
  SkipForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import AccountSetupPage from "@/pages/AccountSetupPage";
import AddOnCampaignPage from "@/pages/AddOnCampaignPage";
import AlertsNotificationsPage from "@/pages/AlertsNotificationsPage";
import IntegrationsPage from "@/pages/IntegrationsPage";
import PricingPage from "@/pages/PricingPage";
import ReactivationPage from "@/pages/ReactivationPage";
import RequestScheduling from "@/pages/RequestScheduling";
import ZapierIntegrationPage from "@/pages/ZapierIntegrationPage";
import OnboardingTutorial from "@/components/OnboardingTutorial";

type PageStatus = "complete" | "incomplete" | "blocked" | "skipped";

type Requirement = {
  id: string;
  label: string;
  kind: "custom_value" | "custom_field" | "system";
  key: string;
  required: boolean;
  status: "complete" | "incomplete" | "blocked";
  reason: string;
};

type PageResult = {
  id: string;
  stepOrder: number;
  title: string;
  description: string;
  route: string;
  required: boolean;
  skippable: boolean;
  skipped: boolean;
  status: PageStatus;
  complete: boolean;
  completedCount: number;
  totalCount: number;
  missingCount: number;
  requirements: Requirement[];
};

function useLocationId() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("locationId")?.trim() || params.get("location_id")?.trim() || params.get("subAccountId")?.trim() || "";
  }, []);
}

function statusLabel(status: PageStatus) {
  if (status === "complete") return "Complete";
  if (status === "blocked") return "Blocked";
  if (status === "skipped") return "Skipped";
  return "Needs attention";
}

function StatusPill({ status }: { status: PageStatus }) {
  const tone = status === "complete"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status === "blocked"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : status === "skipped"
        ? "border-slate-200 bg-slate-100 text-slate-600"
        : "border-amber-200 bg-amber-50 text-amber-700";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>{statusLabel(status)}</span>;
}

function StatusIcon({ status }: { status: PageStatus }) {
  if (status === "complete") return <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />;
  if (status === "blocked") return <ShieldAlert className="h-5 w-5 text-rose-600" aria-hidden="true" />;
  if (status === "skipped") return <Info className="h-5 w-5 text-slate-500" aria-hidden="true" />;
  return <AlertCircle className="h-5 w-5 text-amber-600" aria-hidden="true" />;
}

function RequirementRow({ requirement }: { requirement: Requirement }) {
  const complete = requirement.status === "complete";
  const blocked = requirement.status === "blocked";
  return (
    <li className="flex items-start gap-3 border-t border-slate-100 py-3 first:border-t-0">
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        {complete ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-3.5 w-3.5" /></span>
        ) : blocked ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-100 text-rose-700"><ShieldAlert className="h-3.5 w-3.5" /></span>
        ) : (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-amber-700"><Circle className="h-3.5 w-3.5" /></span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-900">{requirement.label}</span>
          <span className={`text-[10px] font-semibold uppercase tracking-wide ${requirement.required ? "text-rose-600" : "text-slate-400"}`}>{requirement.required ? "Required" : "Optional"}</span>
        </div>
        <p className={`mt-0.5 text-xs ${complete ? "text-emerald-700" : blocked ? "text-rose-700" : "text-amber-700"}`}>{requirement.reason}</p>
        {!complete && <p className="mt-1 font-mono text-[10px] text-slate-400">{requirement.kind === "custom_value" ? "Custom Value" : requirement.kind === "custom_field" ? "Contact Custom Field" : "System check"}: {requirement.key}</p>}
      </div>
    </li>
  );
}

function EmbeddedSetupPage({ pageId }: { pageId: string }) {
  switch (pageId) {
    case "account-setup": return <AccountSetupPage />;
    case "pricing": return <PricingPage />;
    case "request-scheduling": return <RequestScheduling />;
    case "reactivation": return <ReactivationPage />;
    case "add-on-campaign": return <AddOnCampaignPage />;
    case "alerts-notifications": return <AlertsNotificationsPage />;
    case "integrations": return <IntegrationsPage />;
    case "zapier": return <ZapierIntegrationPage />;
    default: return null;
  }
}

function EmbeddedTutorial({ pageId }: { pageId: string }) {
  switch (pageId) {
    case "pricing":
      return <OnboardingTutorial title="Filling Out Pricing Section Guide" youtubeId="agPFTQ5pJwI" />;
    case "reactivation":
      return <OnboardingTutorial title="Reactivating Inactive Customers With Custom Quotes" youtubeId="ZDnvQ9m5XTg" />;
    case "add-on-campaign":
      return <OnboardingTutorial title="Set Up and Edit Add On Campaign Messages" youtubeId="xek6VNHbPdw" />;
    case "alerts-notifications":
      return <OnboardingTutorial title="Customize Customer and Team Notification Alerts" youtubeId="WWpqJc8t0lE" />;
    default:
      return null;
  }
}

export default function OnboardingPage() {
  const locationId = useLocationId();
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [savingProgress, setSavingProgress] = useState(false);
  const statusQuery = trpc.onboarding.getStatus.useQuery(
    { locationId },
    {
      enabled: Boolean(locationId),
      staleTime: 0,
      refetchOnWindowFocus: false,
      refetchOnMount: true,
      refetchInterval: activeStepId ? 5000 : false,
    }
  );
  const recordProgress = trpc.onboarding.recordProgress.useMutation();
  const stepStateMutation = trpc.onboarding.setStepState.useMutation();
  const pages = (statusQuery.data?.pages ?? []) as PageResult[];

  useEffect(() => {
    if (!activeStepId && pages.length > 0) {
      setActiveStepId(pages.find(page => page.status !== "complete" && page.status !== "skipped")?.id || pages[0].id);
    }
  }, [activeStepId, pages]);

  if (!locationId) {
    return <div className="ghl-page flex items-center justify-center p-8"><Card className="w-full max-w-lg border-slate-200 shadow-sm"><CardContent className="space-y-4 p-8 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-100 text-cyan-700"><ClipboardCheck className="h-7 w-7" /></div><h1 className="text-xl font-bold text-slate-900">HomeFlow Setup</h1><p className="text-sm leading-relaxed text-slate-600">Open this page from a GHL sub-account or add <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">?locationId=YOUR_LOCATION_ID</code> to the Custom Menu Link URL.</p></CardContent></Card></div>;
  }

  if (statusQuery.isLoading || !statusQuery.data) {
    return <div className="ghl-page flex items-center justify-center p-10"><div className="flex items-center gap-3 text-sm text-slate-600"><Loader2 className="h-5 w-5 animate-spin text-cyan-600" />Checking your HomeFlow setup in GHL…</div></div>;
  }

  if (statusQuery.isError) {
    return <div className="ghl-page flex items-center justify-center p-8"><Card className="w-full max-w-lg border-rose-200 shadow-sm"><CardContent className="space-y-4 p-8 text-center"><ShieldAlert className="mx-auto h-8 w-8 text-rose-600" /><h1 className="text-xl font-bold text-slate-900">Unable to check setup</h1><p className="text-sm text-slate-600">HomeFlow could not read the current GHL configuration. Refresh the page and try again.</p><Button type="button" onClick={() => void statusQuery.refetch()} className="gap-2 bg-cyan-600 hover:bg-cyan-700"><RefreshCw className="h-4 w-4" />Try again</Button></CardContent></Card></div>;
  }

  const activeIndex = Math.max(0, pages.findIndex(page => page.id === activeStepId));
  const currentPage = pages[activeIndex] || pages[0];

  const saveCurrentProgress = async (page: PageResult) => {
    setSavingProgress(true);
    try {
      await recordProgress.mutateAsync({
        locationId,
        stepId: page.id,
        state: page.skipped ? "skipped" : page.status,
        completedCount: page.completedCount,
        totalCount: page.totalCount,
        missingRequirementsJson: JSON.stringify(page.requirements.filter(item => item.status !== "complete")),
        lastReason: page.requirements.find(item => item.status !== "complete")?.reason || "All step checks passed.",
      });
    } finally {
      setSavingProgress(false);
    }
  };

  const goToStep = async (index: number) => {
    if (!currentPage || index < 0 || index >= pages.length) {
      if (currentPage && index >= pages.length) {
        const latest = await statusQuery.refetch();
        const latestPage = latest.data?.pages.find(page => page.id === currentPage.id) || currentPage;
        await saveCurrentProgress(latestPage as PageResult);
      }
      return;
    }
    const latest = await statusQuery.refetch();
    const latestPages = (latest.data?.pages || pages) as PageResult[];
    const latestCurrentPage = latestPages.find(page => page.id === currentPage.id) || currentPage;
    await saveCurrentProgress(latestCurrentPage as PageResult);
    setDetailsOpen(false);
    setActiveStepId(latestPages[index]?.id || pages[index].id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSkip = () => {
    if (!currentPage.skippable) return;
    stepStateMutation.mutate(
      { locationId, stepId: currentPage.id, state: currentPage.skipped ? "active" : "skipped" },
      {
        onSuccess: async () => {
          await statusQuery.refetch();
          if (!currentPage.skipped && activeIndex < pages.length - 1) {
            setActiveStepId(pages[activeIndex + 1].id);
          }
        },
      }
    );
  };

  return (
    <div className="ghl-page bg-slate-50/70 pb-12">
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Onboarding</h1>
          <div className="mt-5 flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-slate-700">Step {activeIndex + 1} of {pages.length}</span>
            <span className="text-xs text-slate-500">{currentPage?.title}</span>
          </div>
          <div className="mt-3 flex items-center gap-1.5" aria-label="Onboarding steps">
            {pages.map((page, index) => (
              <div key={page.id} className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${index === activeIndex ? "bg-cyan-600 text-white" : page.status === "complete" ? "bg-emerald-100 text-emerald-700" : page.status === "skipped" ? "bg-slate-200 text-slate-600" : "bg-slate-100 text-slate-500"}`} aria-label={`Step ${index + 1}: ${page.title}`}>
                  {page.status === "complete" ? <Check className="h-3.5 w-3.5" /> : index + 1}
                </span>
                {index < pages.length - 1 && <span className={`h-0.5 min-w-1 flex-1 ${index < activeIndex ? "bg-cyan-500" : "bg-slate-200"}`} />}
              </div>
            ))}
          </div>
          <Progress value={((activeIndex + 1) / Math.max(pages.length, 1)) * 100} className="mt-4 h-2 bg-slate-100" />
        </header>

        {currentPage && <>
          <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Step {currentPage.stepOrder}</p><h2 className="mt-1 text-xl font-bold text-slate-900">{currentPage.title}</h2></div><StatusPill status={currentPage.status} /></div>

          <Card className="border-slate-200 bg-white shadow-sm"><CardHeader className="p-5 pb-3 sm:p-7 sm:pb-4"><div className="flex items-start gap-3"><StatusIcon status={currentPage.status} /><div><CardTitle className="text-lg text-slate-900">{currentPage.title}</CardTitle><CardDescription className="mt-1.5 leading-relaxed">{currentPage.description}</CardDescription></div></div></CardHeader><CardContent className="p-5 pt-1 sm:p-7 sm:pt-1"><div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5 text-xs"><span className="font-medium text-slate-600">{currentPage.totalCount === 0 ? "No validation fields" : `${currentPage.completedCount} of ${currentPage.totalCount} checks complete`}</span><span className={currentPage.skippable ? "font-semibold text-slate-600" : "font-semibold text-slate-700"}>{currentPage.skippable ? "Optional step" : "Required step"}</span></div>{currentPage.totalCount > 0 && <button type="button" onClick={() => setDetailsOpen(!detailsOpen)} className="mt-3 flex w-full items-center justify-between text-left text-xs font-semibold text-slate-600 hover:text-slate-900" aria-expanded={detailsOpen}><span>{detailsOpen ? "Hide configuration checks" : `View ${currentPage.missingCount} remaining check${currentPage.missingCount === 1 ? "" : "s"}`}</span>{detailsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>}{detailsOpen && currentPage.totalCount > 0 && <ul className="mt-2 rounded-lg border border-slate-100 px-3">{currentPage.requirements.map(requirement => <RequirementRow key={requirement.id} requirement={requirement} />)}</ul>}</CardContent></Card>

          <div className="space-y-5">
            <EmbeddedTutorial pageId={currentPage.id} />
            <div className="rounded-2xl border border-cyan-200 bg-white shadow-sm"><div className="border-b border-cyan-100 bg-cyan-50 px-5 py-3"><p className="text-sm font-semibold text-cyan-900">Complete Step {currentPage.stepOrder}: {currentPage.title}</p><p className="mt-0.5 text-xs text-cyan-700">This is the existing HomeFlow page. Fill it out and save, or use Next step to record the remaining work and continue.</p></div><div className="p-2 sm:p-4"><EmbeddedSetupPage pageId={currentPage.id} /></div></div>
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between"><Button type="button" variant="outline" disabled={activeIndex === 0 || savingProgress} onClick={() => void goToStep(activeIndex - 1)} className="gap-2 border-slate-300"><ArrowLeft className="h-4 w-4" />Back</Button><div className="flex flex-col gap-2 sm:flex-row"><Button type="button" variant="outline" disabled={!currentPage.skippable || savingProgress || stepStateMutation.isPending} onClick={handleSkip} className="gap-2 border-slate-300">{currentPage.skipped ? "Resume step" : "Skip step"}<SkipForward className="h-4 w-4" /></Button><Button type="button" disabled={savingProgress || recordProgress.isPending} onClick={() => void goToStep(activeIndex + 1)} className="gap-2 bg-cyan-600 text-white hover:bg-cyan-700">{savingProgress ? "Saving progress…" : activeIndex === pages.length - 1 ? "Finish setup" : "Next step"}<ArrowRight className="h-4 w-4" /></Button></div></div>
        </>}

        <Card className="border-slate-200 bg-white shadow-sm"><CardContent className="flex items-start gap-3 p-5 text-xs leading-relaxed text-slate-600"><Info className="mt-0.5 h-5 w-5 shrink-0 text-cyan-600" /><div><p className="font-semibold text-slate-800">How progress is recorded</p><p className="mt-1">Saving a page records its live configuration. Clicking Next step without saving records the page as incomplete and stores its missing checks, so the client can return to it later.</p></div></CardContent></Card>
      </div>
    </div>
  );
}
