import { useMemo } from "react";
import { Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import SingleContactForm from "@/components/SingleContactForm";
import CSVUploadFlow from "@/components/CSVUploadFlow";

export default function AddContactsPage() {
  const locationId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("locationId") || "";
  }, []);

  if (!locationId) {
    return (
      <div className="ghl-page flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-cyan-100 flex items-center justify-center mx-auto">
            <Info className="h-7 w-7 text-cyan-600" />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Add Contacts</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            This page is designed to be embedded inside GoHighLevel. Add it as a Custom Menu Link
            with the{" "}
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
        {/* Two-column card layout */}
        <div className="cards-grid">
          {/* ── Left card: Single Contact ── */}
          <Card className="contact-card">
            <div className="card-header">
              <div className="card-badge">
                <h2 className="card-title">Add Single Contact</h2>
              </div>
            </div>
            <div className="card-body">
              <SingleContactForm locationId={locationId} />
            </div>
          </Card>

          {/* ── Divider ── */}
          <div className="or-divider">
            <div className="or-line" />
            <div className="or-badge">OR</div>
            <div className="or-line" />
          </div>

          {/* ── Right card: CSV Upload ── */}
          <Card className="contact-card">
            <div className="card-header">
              <div className="card-badge">
                <h2 className="card-title">Upload CSV File</h2>
              </div>
            </div>
            <div className="card-body">
              <div className="csv-hint">
                <p className="csv-hint-title">Your CSV file should include the following:</p>
                <div className="csv-hint-grid">
                  <span>*First Name</span>
                  <span>*Phone Number</span>
                  <span>*Number of Dogs</span>
                  <span>Last Name</span>
                  <span>*Email</span>
                  <span>Last Time Scooped</span>
                  <span>Frequency</span>
                  <span>Street Address</span>
                  <span>City</span>
                  <span>Zip Code</span>
                </div>
              </div>
              <CSVUploadFlow locationId={locationId} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
