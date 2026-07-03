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
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-cyan-100 flex items-center justify-center mx-auto">
            <Info className="h-7 w-7 text-cyan-600" />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Add Contacts</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            This page is designed to be embedded inside GoHighLevel. Add it as a Custom Menu Link
            with the <code className="px-1.5 py-0.5 bg-slate-200 rounded text-xs font-mono">?locationId=YOUR_LOCATION_ID</code> parameter.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white overflow-y-auto">
      <div className="mx-auto max-w-[1260px] px-6 py-3">
        <div className="grid grid-cols-[1fr_80px_1fr] items-start gap-4">
          <Card className="flex flex-col overflow-hidden rounded-xl border border-slate-300 bg-white p-0 shadow-[0_2px_10px_rgba(15,23,42,0.06)]">
            <div className="flex items-start justify-between px-5 pt-5">
              <div className="inline-flex rounded-lg border border-cyan-300 bg-cyan-200 px-4 py-2 shadow-sm">
                <h2 className="text-[28px] font-extrabold leading-none tracking-tight text-slate-900">
                  Add Single Contacts
                </h2>
              </div>
              <span className="pt-8 text-xs font-medium text-slate-500">* Required Fields</span>
            </div>

            <div className="px-6 pb-4 pt-3">
              <SingleContactForm locationId={locationId} />
            </div>
          </Card>

          <div className="relative flex items-center justify-center">
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-cyan-300" />
            <div className="relative rounded-md bg-cyan-400 px-4 py-2 text-2xl font-bold text-white shadow-sm">
              OR
            </div>
          </div>

          <Card className="flex flex-col overflow-hidden rounded-xl border border-slate-300 bg-white p-0 shadow-[0_2px_10px_rgba(15,23,42,0.06)]">
            <div className="flex items-start justify-between px-5 pt-5">
              <div className="inline-flex rounded-lg border border-cyan-300 bg-cyan-200 px-4 py-2 shadow-sm">
                <h2 className="text-[28px] font-extrabold leading-none tracking-tight text-slate-900">
                  Upload CVS File
                </h2>
              </div>
              <span className="pt-8 text-xs font-medium text-slate-500">* Required Fields</span>
            </div>

            <div className="px-6 pb-4 pt-3">
              <div className="mb-3 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3">
                <p className="text-sm font-semibold text-slate-900">Your CVS file should include the following:</p>
                <div className="mt-2 grid grid-cols-3 gap-x-6 gap-y-1 text-sm text-slate-700">
                  <div>*First Name</div>
                  <div>*Phone Number</div>
                  <div>*Number of Dogs</div>
                  <div>Last Name</div>
                  <div>*Email</div>
                  <div>Last Time Scooped</div>
                  <div>Street Address</div>
                  <div>City</div>
                  <div />
                  <div>Zip Code</div>
                  <div>State</div>
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
