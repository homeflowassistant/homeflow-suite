import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Eye, EyeOff, Link2, RefreshCw, Save, ShieldCheck, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

const DEFAULT_INVITE_URL = "https://zapier.com/developer/public-invite/245439/2f155a56598b7113ed6afdea1ebbee3b/";
const LOCATION_STORAGE_KEY = "homeflow:last-zapier-location-id";
const SWEEP_GO_VIDEO_URL = "https://drive.google.com/file/d/1pQIYOlpQTPqKQwFiPjgKyTEwhHA6DzOV/preview";

type ZapierConnectionResponse = {
  success: boolean;
  locationId: string;
  locationName: string;
  zapierEnabled: boolean;
  connectionKey: string | null;
  connectionKeyPreview: string;
  zapierInviteUrl: string;
  createdAt: string;
  lastUsedAt: string | null;
  message?: string;
};

async function readResponseBody(response: Response): Promise<{ json?: unknown; text: string }> {
  const text = await response.text();

  if (!text) {
    return { text: "" };
  }

  try {
    return { json: JSON.parse(text) as unknown, text };
  } catch {
    return { text };
  }
}

function getZapierCliName(): string {
  return import.meta.env.VITE_ZAPIER_APP_CLI_NAME || "";
}

function getInviteUrl(): string {
  return import.meta.env.VITE_ZAPIER_INVITE_URL || DEFAULT_INVITE_URL;
}

function getApiUrl(path: string): string {
  const apiBase = (import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "");
  return `${apiBase}${path}`;
}

function buildZapCreateUrl(locationId: string): string {
  const cliName = getZapierCliName().trim();
  if (!cliName) return "";

  const url = new URL(`https://api.zapier.com/v1/embed/${encodeURIComponent(cliName)}/create`);
  url.searchParams.set("steps[0][app]", "WebhookAPI");
  url.searchParams.set("steps[0][action]", "hook");
  url.searchParams.set("steps[1][app]", cliName);
  url.searchParams.set("steps[1][action]", "upsert_contact");
  return url.toString();
}

function useLocationId() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const fromQuery =
      params.get("locationId") ||
      params.get("location_id") ||
      params.get("location.id") ||
      params.get("subAccountId");

    return (
      fromQuery?.trim() ||
      window.localStorage.getItem(LOCATION_STORAGE_KEY)?.trim() ||
      "XzzLQ42sqJR43o30CP34"
    );
  }, []);
}

export default function ZapierIntegrationPage() {
  const locationId = useLocationId();
  const [copiedKey, setCopiedKey] = useState(false);
  const [zapCreateUrl, setZapCreateUrl] = useState("");
  const [connection, setConnection] = useState<ZapierConnectionResponse | null>(null);
  const [visibleConnectionKey, setVisibleConnectionKey] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [showRotateConfirm, setShowRotateConfirm] = useState(false);
  const [rotateConfirmed, setRotateConfirmed] = useState(false);

  // Sweep & Go Integration State & tRPC
  const [webhookUrl, setWebhookUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSavingSweepGo, setIsSavingSweepGo] = useState(false);

  const sweepGoSettingsQuery = trpc.integrations.getSettings.useQuery(
    { locationId: locationId || "test-location" },
    { enabled: true }
  );

  const saveSweepGoMutation = trpc.integrations.saveSettings.useMutation();

  useEffect(() => {
    if (sweepGoSettingsQuery.data) {
      setWebhookUrl(sweepGoSettingsQuery.data.webhookUrl || "");
      setAccessToken(sweepGoSettingsQuery.data.accessToken || "");
    }
  }, [sweepGoSettingsQuery.data]);

  const handleSaveSweepGo = async () => {
    if (!locationId || locationId === "preview" || locationId === "test-location") {
      toast.info(
        "Preview / Test Mode: Settings saved locally. Add ?locationId={{location.id}} in GHL to sync with live sub-accounts."
      );
      return;
    }

    setIsSavingSweepGo(true);
    try {
      await saveSweepGoMutation.mutateAsync({
        locationId,
        webhookUrl: webhookUrl.trim(),
        accessToken: accessToken.trim(),
      });

      toast.success("Sweep & Go integration settings saved successfully!");
      await sweepGoSettingsQuery.refetch();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save Sweep & Go settings"
      );
    } finally {
      setIsSavingSweepGo(false);
    }
  };

  useEffect(() => {
    if (locationId) {
      window.localStorage.setItem(LOCATION_STORAGE_KEY, locationId);
      setZapCreateUrl(buildZapCreateUrl(locationId));
    }
  }, [locationId]);

  const loadConnection = async () => {
    if (!locationId) {
      toast.error("Missing locationId. Open HomeFlow from a GHL sub-account or add ?locationId=<GHL_LOCATION_ID> to the URL.");
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch(getApiUrl(`/api/zapier/connection?locationId=${encodeURIComponent(locationId)}`), {
        method: "GET",
        credentials: "include",
      });
      const body = await readResponseBody(response);
      const data = (body.json ?? {}) as ZapierConnectionResponse & { message?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.message || body.text || "Failed to load Zapier connection.");
      }
      setConnection(data);
      setVisibleConnectionKey(data.connectionKey || "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load Zapier connection.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadConnection();
  }, [locationId]);

  const inviteUrl = useMemo(() => {
    const baseInvite = connection?.zapierInviteUrl || getInviteUrl();
    if (!zapCreateUrl) return baseInvite;
    return `${baseInvite}?next=${encodeURIComponent(zapCreateUrl)}`;
  }, [connection?.zapierInviteUrl, zapCreateUrl]);

  const handleCopyConnectionKey = async () => {
    if (!visibleConnectionKey) {
      toast.error("No raw connection key is available. Rotate the key to generate a new one.");
      return;
    }

    try {
      await navigator.clipboard.writeText(visibleConnectionKey);
      setCopiedKey(true);
      toast.success("Zapier connection key copied.");
      window.setTimeout(() => setCopiedKey(false), 1800);
    } catch {
      toast.error("Unable to copy Zapier connection key.");
    }
  };

  const handleIntegrate = () => {
    window.open(inviteUrl, "_blank", "noopener,noreferrer");
  };

  const handleCreateZap = () => {
    if (!zapCreateUrl) {
      toast.error("Set VITE_ZAPIER_APP_CLI_NAME before opening the Zap editor.");
      return;
    }

    window.open(zapCreateUrl, "_blank", "noopener,noreferrer");
  };

  const handleRotateKey = async () => {
    if (!locationId) {
      toast.error("Missing locationId. Open HomeFlow from a GHL sub-account or add ?locationId=<GHL_LOCATION_ID> to the URL.");
      return;
    }
    // Show confirmation modal first
    setShowRotateConfirm(true);
  };

  const performRotateKey = async () => {
    if (!locationId) return;
    setIsRotating(true);
    try {
      const response = await fetch(getApiUrl("/api/zapier/connection/rotate"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId }),
      });

      const body = await readResponseBody(response);
      const data = (body.json ?? {}) as {
        success: boolean;
        connectionKey?: string;
        connectionKeyPreview?: string;
        message?: string;
      };

      if (!response.ok || !data.success || !data.connectionKey) {
        throw new Error(data.message || body.text || "Failed to rotate Zapier key.");
      }

      setVisibleConnectionKey(data.connectionKey);
      setConnection((prev) =>
        prev
          ? {
              ...prev,
              connectionKey: data.connectionKey || null,
              connectionKeyPreview: data.connectionKeyPreview || prev.connectionKeyPreview,
              zapierEnabled: true,
            }
          : prev
      );

      toast.success(data.message || "Zapier key rotated successfully.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rotate key.");
    } finally {
      setIsRotating(false);
      setShowRotateConfirm(false);
      setRotateConfirmed(false);
    }
  };

  const handleRevoke = async () => {
    if (!locationId) {
      toast.error("Missing locationId. Open HomeFlow from a GHL sub-account or add ?locationId=<GHL_LOCATION_ID> to the URL.");
      return;
    }

    setIsRevoking(true);
    try {
      const response = await fetch(getApiUrl("/api/zapier/connection/revoke"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId }),
      });
      const body = await readResponseBody(response);
      const data = (body.json ?? {}) as { success: boolean; message?: string; zapierEnabled?: boolean };
      if (!response.ok || !data.success) {
        throw new Error(data.message || body.text || "Failed to revoke Zapier access.");
      }

      setVisibleConnectionKey("");
      setConnection((prev) =>
        prev
          ? {
              ...prev,
              zapierEnabled: false,
              connectionKey: null,
            }
          : prev
      );

      toast.success(data.message || "Zapier access revoked.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to revoke Zapier access.");
    } finally {
      setIsRevoking(false);
    }
  };

  if (!locationId) {
    return (
      <div className="ghl-page flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-cyan-100 flex items-center justify-center mx-auto">
            <Zap className="h-7 w-7 text-cyan-600" />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Zapier Integration</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            This page is designed to be embedded inside GoHighLevel. Add it as a
            Custom Menu Link with the{" "}
            <code className="px-1.5 py-0.5 bg-slate-200 rounded text-xs font-mono">
              ?locationId=YOUR_LOCATION_ID
            </code>{" "}
            parameter.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="ghl-page pb-10">
      <div className="ghl-inner space-y-8">
        {/* ── Sweep & Go Integration Card (Top) ── */}
        <Card className="border border-slate-200/80 shadow-sm bg-white rounded-2xl p-6 sm:p-7">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-sky-100 text-sky-600 flex items-center justify-center flex-shrink-0">
              <Link2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 leading-tight">Sweep & Go Integration</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Connect your Sweep & Go account to HomeFlow.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            {/* Left Column: Form Inputs & Save Button */}
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1.5" htmlFor="sweepgo-webhook-url">
                  Webhook URL
                </label>
                <Input
                  id="sweepgo-webhook-url"
                  type="text"
                  placeholder="Enter Webhook URL"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className="h-10 text-xs border-slate-300 focus-visible:ring-sky-500 rounded-lg placeholder:text-slate-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1.5" htmlFor="sweepgo-access-token">
                  Access Token / API Key
                </label>
                <div className="relative">
                  <Input
                    id="sweepgo-access-token"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter Access Token / API Key"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    className="h-10 text-xs border-slate-300 pr-10 focus-visible:ring-sky-500 rounded-lg placeholder:text-slate-400"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                    onClick={() => setShowPassword(!showPassword)}
                    title={showPassword ? "Hide token" : "Show token"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  type="button"
                  onClick={handleSaveSweepGo}
                  disabled={isSavingSweepGo}
                  className="bg-sky-600 hover:bg-sky-700 text-white font-semibold gap-2 px-5 h-9 text-xs rounded-lg shadow-sm"
                >
                  <Save className="h-3.5 w-3.5" />
                  {isSavingSweepGo ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>

            {/* Right Column: Video Embed & Caption */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-800">How to connect Sweep & Go</h3>
              <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black border border-slate-200 shadow-sm">
                <iframe
                  src={SWEEP_GO_VIDEO_URL}
                  className="w-full h-full border-none"
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  title="How to connect Sweep & Go"
                />
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed pt-0.5">
                This short video shows you how to find your webhook URL and access token in Sweep & Go and connect it to HomeFlow.
              </p>
            </div>
          </div>
        </Card>

        {/* ── 2. Zapier Integration Outer Card ── */}
        <Card className="border border-slate-200/80 shadow-sm bg-white rounded-2xl p-6 sm:p-7 space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center flex-shrink-0">
              <Zap className="h-5 w-5 fill-orange-500 text-orange-500" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 leading-tight">Zapier Integration</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Use Zapier to send contacts into HomeFlow from other CRMs, forms, and lead sources.
              </p>
            </div>
          </div>

          {/* Row 1: Left Column (What is Zapier Video) | Right Column (Connection Key & Zapier Access) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
            {/* Left Column: Video */}
            <div className="border border-slate-200/90 shadow-sm bg-white rounded-xl p-5 space-y-3 flex flex-col justify-between">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">What is Zapier + when to use it</h3>
                <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black border border-slate-200 shadow-sm">
                  <iframe
                    src={SWEEP_GO_VIDEO_URL}
                    className="w-full h-full border-none"
                    allow="autoplay; encrypted-media; picture-in-picture"
                    allowFullScreen
                    title="What is Zapier + when to use it"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed pt-1">
                Learn how Zapier works, common use cases, and when to use it to send leads into HomeFlow.
              </p>
            </div>

            {/* Right Column: Connection Key & Zapier Access */}
            <div className="space-y-4 flex flex-col justify-between">
              {/* Connection Key */}
              <div className="border border-slate-200/90 shadow-sm bg-white rounded-xl p-5 space-y-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Connection Key</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Copy the raw key or rotate it only when you need a fresh credential.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-500">Raw key</label>
                  <Input
                    readOnly
                    value={visibleConnectionKey || connection?.connectionKeyPreview || "No active key"}
                    className="font-mono text-xs h-9"
                  />
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button type="button" variant="outline" className="gap-2 h-8 text-xs px-3" onClick={handleCopyConnectionKey}>
                    {copiedKey ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedKey ? "Copied" : "Copy Key"}
                  </Button>
                  <Button type="button" variant="outline" className="gap-2 h-8 text-xs px-3" onClick={handleRotateKey} disabled={isRotating || !locationId}>
                    <RefreshCw className={`h-3.5 w-3.5 ${isRotating ? "animate-spin" : ""}`} />
                    {isRotating ? "Rotating..." : "Rotate Key"}
                  </Button>
                </div>
                <p className="text-[11px] text-slate-500 pt-0.5">
                  The key is stored securely in hashed form for validation, and the raw value is kept so you can copy it later.
                </p>
              </div>

              {/* Zapier Access */}
              <div className="border border-slate-200/90 shadow-sm bg-white rounded-xl p-5 space-y-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Zapier Access</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Open the invite flow or jump straight into the Zap builder.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className={connection?.zapierEnabled ? "inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700" : "inline-flex items-center rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600"}>
                    {connection?.zapierEnabled ? "Enabled" : "Disabled"}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                    Private app invite
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button type="button" onClick={handleIntegrate} className="gap-2 h-9 text-xs px-4 bg-sky-600 hover:bg-sky-700 text-white font-medium" disabled={!locationId}>
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open Zapier Invite
                  </Button>
                  <Button type="button" variant="outline" onClick={handleCreateZap} className="gap-2 h-9 text-xs px-3" disabled={!locationId || !zapCreateUrl}>
                    <Zap className="h-3.5 w-3.5" />
                    Create Zap
                  </Button>
                  <Button type="button" variant="outline" className="gap-2 h-9 text-xs px-3" disabled={isLoading || !locationId} onClick={() => void loadConnection()}>
                    <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                </div>

                <Button type="button" variant="destructive" className="gap-2 h-8 text-xs px-3" onClick={handleRevoke} disabled={isRevoking || !locationId}>
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {isRevoking ? "Revoking..." : "Revoke Access"}
                </Button>
              </div>
            </div>
          </div>

          {/* Row 2: Steps to connect in Zapier */}
          <div className="border border-slate-200/90 shadow-sm bg-white rounded-xl p-5 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Steps to connect in Zapier</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2">
                <div className="flex items-start gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-sky-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                  <p className="font-semibold text-xs text-slate-900 leading-snug">
                    Open the Zapier invite, accept the invitation, and then start creating the Zap.
                  </p>
                </div>
                <p className="text-[11px] text-slate-500 leading-normal pl-8">
                  Use the private invite link to open the app inside Zapier.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2">
                <div className="flex items-start gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-sky-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                  <p className="font-semibold text-xs text-slate-900 leading-snug">
                    In Zapier, select the HomeFlow app in the Action step.
                  </p>
                </div>
                <p className="text-[11px] text-slate-500 leading-normal pl-8">
                  Choose the app action you want to use for the Zap.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2">
                <div className="flex items-start gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-sky-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
                  <p className="font-semibold text-xs text-slate-900 leading-snug">
                    Connect your account by adding the connection key.
                  </p>
                </div>
                <p className="text-[11px] text-slate-500 leading-normal pl-8">
                  Zapier uses this connection key to access your account.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2">
                <div className="flex items-start gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-sky-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">4</span>
                  <p className="font-semibold text-xs text-slate-900 leading-snug">
                    Map the Zap trigger fields to the contact fields.
                  </p>
                </div>
                <p className="text-[11px] text-slate-500 leading-normal pl-8">
                  Every field mapped on the Add Contact page is available in the action.
                </p>
              </div>
            </div>
          </div>

          {/* Row 3: Available Fields Grid */}
          <div className="border border-slate-200/90 shadow-sm bg-white rounded-xl p-5 space-y-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">Available Fields</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                These are the fields available in HomeFlow. Use them when mapping your Zap in Zapier.
              </p>
            </div>
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              {[
                "First Name",
                "Last Name",
                "Email",
                "Phone Number",
                "Service Address",
                "City",
                "State",
                "Zip Code",
                "No. of Dogs",
                "Last Scooped",
                "Frequency",
                "Marketing Allowed",
              ].map((label) => (
                <div key={label} className="flex items-center rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2 font-medium text-slate-700">
                  {label}
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* ── 3. Security Model Standalone Card (Bottom of Page) ── */}
        <div className="border border-sky-200/90 bg-sky-50/60 shadow-sm rounded-2xl p-5 sm:p-6 mb-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-sky-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-slate-900 leading-tight">Security model</h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                Account credentials stay server-side. The key is hashed for validation, while the raw key is retained for user copying.
              </p>
            </div>
          </div>
        </div>
      </div>

      {showRotateConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-lg">
            <h3 className="mb-2 text-lg font-semibold text-slate-900">Rotate Zapier Connection Key</h3>
            <p className="mb-4 text-sm text-slate-600">
              Rotating the connection key will immediately invalidate any existing Zaps that use
              the previous key. You will need to update any Zap that relied on the old key.
            </p>

            <div className="mb-4 flex items-start gap-3">
              <input
                id="rotate-confirm"
                type="checkbox"
                checked={rotateConfirmed}
                onChange={(e) => setRotateConfirmed(e.target.checked)}
                className="mt-1 h-4 w-4"
              />
              <label htmlFor="rotate-confirm" className="text-sm text-slate-700">
                I understand that rotating the key will invalidate existing Zaps and I want to proceed.
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => { setShowRotateConfirm(false); setRotateConfirmed(false); }}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void performRotateKey()}
                disabled={!rotateConfirmed || isRotating}
              >
                {isRotating ? "Rotating..." : "Confirm and Rotate"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
