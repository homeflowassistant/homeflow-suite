import React, { useState, useEffect, useMemo } from "react";
import { Save, Link2, Video, Eye, EyeOff, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import VideoHelpButton from "@/components/VideoHelpButton";
import "./IntegrationsPage.css";

const SWEEP_AND_GO_VIDEO_URL = "https://www.youtube.com/embed/Pw4xD6HYqIo";

function useLocationId() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("locationId") || params.get("location_id") || "test-location";
  }, []);
}

export default function IntegrationsPage() {
  const locationId = useLocationId();

  const [webhookUrl, setWebhookUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // tRPC query & mutation
  const settingsQuery = trpc.integrations.getSettings.useQuery(
    { locationId: locationId || "test-location" },
    { enabled: true }
  );

  const saveMutation = trpc.integrations.saveSettings.useMutation();

  // Load existing settings into state
  useEffect(() => {
    if (!settingsQuery.data) return;
    setWebhookUrl(settingsQuery.data.webhookUrl || "");
    setAccessToken(settingsQuery.data.accessToken || "");
  }, [settingsQuery.data]);

  // Save handler
  const handleSave = async () => {
    if (!locationId || locationId === "preview" || locationId === "test-location") {
      toast.info(
        "Preview / Test Mode: Settings saved locally. Add ?locationId={{location.id}} in GHL to sync with live sub-accounts."
      );
      return;
    }

    setIsSaving(true);
    try {
      await saveMutation.mutateAsync({
        locationId,
        webhookUrl: webhookUrl.trim(),
        accessToken: accessToken.trim(),
      });

      toast.success("Integrations settings saved successfully!");
      await settingsQuery.refetch();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save integrations settings"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyWebhook = async () => {
    if (!webhookUrl.trim()) return;
    await navigator.clipboard.writeText(webhookUrl.trim());
    setCopiedWebhook(true);
    window.setTimeout(() => setCopiedWebhook(false), 1800);
  };

  return (
    <div className="integrations-page-shell">
      <div className="integrations-page-container">
        {/* ── Top Page Header ────────────────────────────────────────────── */}
        <div className="integrations-page-header">
          <h1 className="integrations-page-title">Integrations</h1>
          <VideoHelpButton pageTitle="Sweep & Go Integration" videos={[{ title: "HomeFlow Assistant: Sweep and Go Webhook Setup Guide", youtubeId: "Pw4xD6HYqIo" }]} />
        </div>

        {/* ── Top Video Tutorial Section ─────────────────────────────────── */}
        <section className="integrations-section">
          <div className="integrations-card-box">
            <div className="integrations-card-header">
              <div className="integrations-card-icon">
                <Video className="w-5 h-5" />
              </div>
              <div>
                <h2 className="integrations-card-title">Setup Video Tutorial</h2>
                <p className="integrations-card-subtitle">
                  Watch the step-by-step video below to learn how to configure your webhook and access key.
                </p>
              </div>
            </div>

            <div className="integrations-video-wrapper">
              <iframe
                src={SWEEP_AND_GO_VIDEO_URL}
                className="integrations-video-iframe"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                title="Integrations Setup Tutorial"
              />
            </div>
          </div>
        </section>

        {/* ── Webhook & API Key Settings Section ──────────────────────────── */}
        <section className="integrations-section">
          <div className="integrations-card-box">
            <div className="integrations-card-header">
              <div className="integrations-card-icon">
                <Link2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="integrations-card-title">API & Webhook Configuration</h2>
                <p className="integrations-card-subtitle">
                  Manage your sub-account webhook endpoint and authorization credentials.
                </p>
              </div>
            </div>

            <div className="integrations-form-grid">
              {/* Field 1: Webhook URL */}
              <div className="integrations-item-block">
                <div className="integrations-label-row">
                  <label className="integrations-item-label" htmlFor="webhook-url-input">
                    Render / Webhook Link
                  </label>
                </div>
                <div className="integrations-input-container">
                  <input
                    id="webhook-url-input"
                    type="text"
                    className="integrations-input-field integrations-input-readonly"
                    placeholder="Generated by HomeFlow"
                    value={webhookUrl}
                    readOnly
                    aria-readonly="true"
                  />
                  <button
                    type="button"
                    className="integrations-copy-btn"
                    onClick={() => void handleCopyWebhook()}
                    disabled={!webhookUrl.trim()}
                    title="Copy render/webhook link"
                    aria-label="Copy render/webhook link"
                  >
                    {copiedWebhook ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copiedWebhook ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="integrations-field-help">This link is generated by HomeFlow and cannot be edited here.</p>
              </div>

              {/* Field 2: Access Token / API Key */}
              <div className="integrations-item-block">
                <div className="integrations-label-row">
                  <label className="integrations-item-label" htmlFor="access-token-input">
                    Enter Access Token / API Key
                  </label>
                </div>
                <div className="integrations-input-container">
                  <input
                    id="access-token-input"
                    type={showPassword ? "text" : "password"}
                    className="integrations-input-field has-pw-toggle"
                    placeholder="Enter Access Token / API Key here"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                  />
                  <button
                    type="button"
                    className="integrations-toggle-pw-btn"
                    onClick={() => setShowPassword((prev) => !prev)}
                    title={showPassword ? "Hide token" : "Show token"}
                    aria-label={showPassword ? "Hide token" : "Show token"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="integrations-bottom-actions">
              <button
                type="button"
                className="integrations-save-btn"
                onClick={handleSave}
                disabled={isSaving}
              >
                <Save className="h-4 w-4" />
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
