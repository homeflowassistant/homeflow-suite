import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const DEFAULT_INVITE_URL = "https://zapier.com/developer/public-invite/240507/da63c72aee602b7838b5e5b8d6d72396/";
const LOCATION_STORAGE_KEY = "homeflow:last-zapier-location-id";

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
    return params.get("locationId")?.trim() || "";
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

  useEffect(() => {
    if (locationId) {
      window.localStorage.setItem(LOCATION_STORAGE_KEY, locationId);
      setZapCreateUrl(buildZapCreateUrl(locationId));
    }
  }, [locationId]);

  const loadConnection = async () => {
    if (!locationId) {
      toast.error("Missing locationId in the page URL.");
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch(`/api/zapier/connection?locationId=${encodeURIComponent(locationId)}`, {
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
      toast.error("Missing locationId in the page URL.");
      return;
    }
    // Show confirmation modal first
    setShowRotateConfirm(true);
  };

  const performRotateKey = async () => {
    if (!locationId) return;
    setIsRotating(true);
    try {
      const response = await fetch("/api/zapier/connection/rotate", {
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
      toast.error("Missing locationId in the page URL.");
      return;
    }

    setIsRevoking(true);
    try {
      const response = await fetch("/api/zapier/connection/revoke", {
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
    <div className="ghl-page">
      <div className="ghl-inner">
        <div className="grid gap-8 lg:grid-cols-[1.08fr_0.92fr]">
          <section className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-700 border-cyan-300">
              <Zap className="h-3.5 w-3.5 text-cyan-600" />
              HomeFlow Zapier Integration
            </div>

            <div className="space-y-3">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                Connect your account to Zapier.
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
                Generate a secure connection key, open the private Zapier app, and keep contact
                upserts flowing through your account connection. Every field mapped on the Add
                Contact page — name, email, phone, service address, number of dogs, last time
                scooped, clean-up frequency, and marketing consent — is available in the Zap.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card className="contact-card">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg text-slate-900">Connection key</CardTitle>
                  <CardDescription>
                    Copy the raw key or rotate it only when you need a fresh credential.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-500">Raw key</label>
                    <Input
                      readOnly
                      value={visibleConnectionKey || connection?.connectionKeyPreview || "No active key"}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="gap-2" onClick={handleCopyConnectionKey}>
                      {copiedKey ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copiedKey ? "Copied" : "Copy Key"}
                    </Button>
                    <Button type="button" variant="outline" className="gap-2" onClick={handleRotateKey} disabled={isRotating || !locationId}>
                      <RefreshCw className={`h-4 w-4 ${isRotating ? "animate-spin" : ""}`} />
                      {isRotating ? "Rotating..." : "Rotate Key"}
                    </Button>
                  </div>
                  <p className="text-xs text-slate-500">
                    The key is stored securely in hashed form for validation, and the raw value is
                    kept so you can copy it later.
                  </p>
                </CardContent>
              </Card>

              <Card className="contact-card">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg text-slate-900">Zapier access</CardTitle>
                  <CardDescription>
                    Open the invite flow or jump straight into the Zap builder.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <span
                      className={
                        connection?.zapierEnabled
                          ? "inline-flex items-center rounded-full border border-cyan-300 bg-cyan-100 px-2.5 py-0.5 text-xs font-medium text-cyan-700"
                          : "inline-flex items-center rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600"
                      }
                    >
                      {connection?.zapierEnabled ? "Enabled" : "Disabled"}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                      Private app invite
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={handleIntegrate} className="gap-2" disabled={!locationId}>
                      <ExternalLink className="h-4 w-4" />
                      Open Zapier Invite
                    </Button>
                    <Button type="button" variant="outline" onClick={handleCreateZap} className="gap-2" disabled={!locationId || !zapCreateUrl}>
                      <Zap className="h-4 w-4" />
                      Create Zap
                    </Button>
                    <Button type="button" variant="outline" className="gap-2" disabled={isLoading || !locationId} onClick={() => void loadConnection()}>
                      <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                      Refresh
                    </Button>
                  </div>

                  <Button type="button" variant="destructive" className="gap-2" onClick={handleRevoke} disabled={isRevoking || !locationId}>
                    <AlertTriangle className="h-4 w-4" />
                    {isRevoking ? "Revoking..." : "Revoke Access"}
                  </Button>
                </CardContent>
              </Card>
            </div>

            <Card className="contact-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg text-slate-900">Mapped fields</CardTitle>
                <CardDescription>
                  The Zap action maps every field from the Add Contact page into the CRM contact.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-1.5 text-sm sm:grid-cols-2">
                  {[
                    ["First Name", "firstName"],
                    ["Last Name", "lastName"],
                    ["Email", "email"],
                    ["Phone Number", "phone"],
                    ["Service Address", "address1"],
                    ["City", "city"],
                    ["State", "state"],
                    ["Zip Code", "postalCode"],
                    ["No. of Dogs", "number_of_dogs"],
                    ["Last Scooped", "last_time_yard_was_thoroughly_cleaned"],
                    ["Frequency", "clean_up_frequency"],
                    ["Marketing Allowed", "marketing_allowed"],
                    ["Do Not Disturb", "dnd"],
                  ].map(([label, key]) => (
                    <div key={key} className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5">
                      <span className="text-slate-700">{label}</span>
                      <code className="text-xs font-mono text-slate-500">{key}</code>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          <Card className="contact-card h-fit">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl text-slate-900">How it works</CardTitle>
              <CardDescription>Use this short flow to connect Zapier without exposing any account credentials.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-6 text-slate-600">
              <div className="rounded-lg border bg-slate-50 p-4">
                <p className="font-medium text-slate-900">1. Open the Zapier invite, accept the invitation, and then start creating the Zap.</p>
                <p>Use the private invite link to open the app inside Zapier.</p>
              </div>
              <div className="rounded-lg border bg-slate-50 p-4">
                <p className="font-medium text-slate-900">2. In Zapier, select the HomeFlow app in the Action step.</p>
                <p>Choose the app action you want to use for the Zap.</p>
              </div>
              <div className="rounded-lg border bg-slate-50 p-4">
                <p className="font-medium text-slate-900">3. Connect your account by adding the connection key.</p>
                <p>Zapier uses this connection key to access your account.</p>
              </div>
              <div className="rounded-lg border bg-slate-50 p-4">
                <p className="font-medium text-slate-900">4. Map the Zap trigger fields to the contact fields.</p>
                <p>Every field mapped on the Add Contact page is available in the action, so Zapier-sourced contacts look exactly like manually added ones.</p>
              </div>
              <div className="rounded-lg border border-cyan-300/50 bg-cyan-50/50 p-4">
                <p className="flex items-center gap-2 font-medium text-slate-900">
                  <ShieldCheck className="h-4 w-4 text-cyan-600" />
                  Security model
                </p>
                <p>Account credentials stay server-side. The key is hashed for validation, while the raw key is retained for user copying.</p>
              </div>
            </CardContent>
          </Card>
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
