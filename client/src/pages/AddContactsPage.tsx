import { useState, useMemo } from "react";
import { Cloud, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
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
    <div className="min-h-screen bg-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Add Contacts</h1>
          <p className="text-sm text-slate-600">Add contacts individually or upload a CSV file to bulk import</p>
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Single Contact Form */}
          <div>
            <Card className="p-6 border-0 shadow-sm bg-white">
              {/* Section Header with Cyan Background */}
              <div className="mb-5 pb-0 -mx-6 -mt-6 px-6 py-3 bg-cyan-400 rounded-t-lg">
                <h2 className="text-xl font-bold text-white">
                  Add Single Contacts
                </h2>
              </div>

              {/* Form */}
              <div className="mt-5">
                <SingleContactForm locationId={locationId} />
              </div>
            </Card>
          </div>

          {/* Right Column - CSV Upload */}
          <div>
            <Card className="p-6 border-0 shadow-sm bg-white">
              {/* Section Header with Cyan Background */}
              <div className="mb-5 pb-0 -mx-6 -mt-6 px-6 py-3 bg-cyan-400 rounded-t-lg">
                <h2 className="text-xl font-bold text-white">
                  Upload CSV File
                </h2>
              </div>

              {/* CSV Upload Requirements */}
              <div className="mb-4 p-4 bg-cyan-50 border border-cyan-200 rounded-lg">
                <p className="text-sm font-semibold text-slate-900 mb-2">Your CSV file should include:</p>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-700">
                  <div>• First Name</div>
                  <div>• Phone Number</div>
                  <div>• Last Name</div>
                  <div>• Email</div>
                  <div>• Street Address</div>
                  <div>• City</div>
                  <div>• Zip Code</div>
                  <div>• State</div>
                  <div>• Number of Dogs</div>
                  <div>• Last Time Scooped</div>
                </div>
              </div>

              {/* CSV Upload Component */}
              <CSVUploadFlow locationId={locationId} />
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
