import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, ExternalLink, Link2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const DEFAULT_INVITE_URL = "https://zapier.com/developer/public-invite/240507/da63c72aee602b7838b5e5b8d6d72396/";
const DEFAULT_TAG = "trigger-royal-review";
const LOCATION_STORAGE_KEY = "royal-review:last-zapier-location-id";

function getZapierCliName(): string {
  return import.meta.env.VITE_ZAPIER_APP_CLI_NAME || "";
}

function getInviteUrl(): string {
  return import.meta.env.VITE_ZAPIER_INVITE_URL || DEFAULT_INVITE_URL;
}

function buildZapCreateUrl(locationId: string): string {
  const cliName = getZapierCliName().trim();
  if (!cliName) return "";

  const url = new URL(`https://api.zapier.com/v1/embed/${encodeURIComponent(cliName)}/create`);
  url.searchParams.set("steps[0][app]", "WebhookAPI");
  url.searchParams.set("steps[0][action]", "hook");
  url.searchParams.set("steps[1][app]", cliName);
  url.searchParams.set("steps[1][action]", "create_contact");
  url.searchParams.set("steps[1][params][location_id]", locationId);
  url.searchParams.set("steps[1][params][tags]", DEFAULT_TAG);
  return url.toString();
}

function useLocationId() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("locationId")?.trim() || "";
  }, []);
}

export default function ZapierIntegrationPage() {
  const locationId = useLocationId();
  const [copied, setCopied] = useState(false);
  const [zapCreateUrl, setZapCreateUrl] = useState("");

  useEffect(() => {
    if (locationId) {
      window.localStorage.setItem(LOCATION_STORAGE_KEY, locationId);
      setZapCreateUrl(buildZapCreateUrl(locationId));
    }
  }, [locationId]);

  const inviteUrl = useMemo(() => {
    if (!zapCreateUrl) return getInviteUrl();
    return `${getInviteUrl()}?next=${encodeURIComponent(zapCreateUrl)}`;
  }, [zapCreateUrl]);

  const handleCopy = async () => {
    if (!locationId) return;

    try {
      await navigator.clipboard.writeText(locationId);
      setCopied(true);
      toast.success("Location ID copied.");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Unable to copy Location ID.");
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid w-full gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
              <Zap className="h-3.5 w-3.5 text-amber-500" />
              Home Flow Zapier Integration
            </div>

            <div className="space-y-3">
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
                Connect your GHL location to Zapier.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-slate-600">
                Open Zapier, accept the private app invite, and drop into a prefilled Zap that sends contacts into your GHL sub-account with the <span className="font-semibold text-slate-900">{DEFAULT_TAG}</span> tag.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card className="border-slate-200 bg-white/90 shadow-sm">
                <CardHeader className="space-y-2 pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Link2 className="h-4 w-4 text-blue-600" />
                    Your Location ID
                  </CardTitle>
                  <CardDescription>Use this ID inside the Zapier action configuration.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input readOnly value={locationId || "Missing locationId"} className="font-mono text-sm" />
                  <Button type="button" variant="outline" onClick={handleCopy} className="w-full gap-2" disabled={!locationId}>
                    {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Copied" : "Copy Location ID"}
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-slate-200 bg-white/90 shadow-sm">
                <CardHeader className="space-y-2 pb-3">
                  <CardTitle className="text-lg">Zapier App Status</CardTitle>
                  <CardDescription>Set your Zapier CLI name to enable the one-click Zap editor shortcut.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={zapCreateUrl ? "default" : "outline"}>{zapCreateUrl ? "Zap editor ready" : "CLI name needed"}</Badge>
                    <Badge variant="secondary">Private app invite</Badge>
                  </div>
                  <p className="text-sm text-slate-600">
                    {getZapierCliName().trim()
                      ? `Configured app: ${getZapierCliName().trim()}`
                      : "Add VITE_ZAPIER_APP_CLI_NAME to your environment to enable the prefilled Zap editor link."}
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="button" onClick={handleIntegrate} className="gap-2 bg-slate-900 text-white hover:bg-slate-800" disabled={!locationId}>
                <ExternalLink className="h-4 w-4" />
                Integrate with Zapier
              </Button>
              <Button type="button" variant="outline" onClick={handleCreateZap} className="gap-2" disabled={!locationId || !zapCreateUrl}>
                <Zap className="h-4 w-4" />
                Create Your Zap
              </Button>
            </div>

            <p className="text-sm text-slate-500">
              The invite button opens Zapier in a new tab. After the invite is accepted, Zapier can redirect directly into your prefilled Zap editor.
            </p>
          </section>

          <Card className="border-slate-200 bg-slate-950 text-slate-50 shadow-xl">
            <CardHeader className="space-y-2 pb-4">
              <CardTitle className="text-xl text-white">How it works</CardTitle>
              <CardDescription className="text-slate-300">A simple 3-step flow for clients inside GHL.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-6 text-slate-300">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="font-medium text-white">1. Accept the private app invite</p>
                <p>Zapier grants access to your private app without any public listing requirements.</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="font-medium text-white">2. Choose a trigger source</p>
                <p>Select a source like Jobber, Typeform, or a webhook, then continue through the Zap editor.</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="font-medium text-white">3. Send contacts to GHL</p>
                <p>The Zap calls your backend proxy, which upserts the contact into GHL and applies the review tag.</p>
              </div>
              <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-amber-100">
                <p className="font-medium text-white">Location ID already saved</p>
                <p>{locationId || "Add ?locationId=... to this page URL inside GHL to enable the integration flow."}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}