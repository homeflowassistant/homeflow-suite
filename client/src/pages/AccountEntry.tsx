import { useEffect } from "react";

export default function AccountEntry() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const locationId = params.get("locationId");
      
      if (!locationId) {
        // No locationId, redirect to account without params
        window.location.replace("/account");
        return;
      }
      
      // Redirect to /account with locationId preserved
      const target = new URL(window.location.origin + "/account");
      target.searchParams.set("locationId", locationId);
      window.location.replace(target.toString());
    } catch (err) {
      // Fallback: go to account page
      window.location.replace("/account");
    }
  }, []);

  return null;
}
