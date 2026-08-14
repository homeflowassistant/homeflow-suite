import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { Search, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import ContactTable from "@/components/ContactTable";
import Pagination from "@/components/Pagination";
import "./ContactsPage.css";

// ─── Helpers ──────────────────────────────────────────────────────────

function useLocationId() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("locationId") || "";
  }, []);
}

const PAGE_SIZE = 50;

export default function ContactsPage() {
  const locationId = useLocationId();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Debounce search input
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const trimmed = value.trim();
      setDebouncedSearch(trimmed);
      setPage(1); // Reset to first page on new search
    }, 400);
  }, []);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  // tRPC query for fetching contacts
  // staleTime: 0 — data is always considered stale so refetches always hit the network
  const contactsQuery = trpc.contacts.getContacts.useQuery(
    {
      locationId,
      search: debouncedSearch || undefined,
      page,
      pageSize: PAGE_SIZE,
    },
    {
      enabled: !!locationId,
      refetchOnWindowFocus: false,
      staleTime: 0,
      refetchOnMount: true,
    }
  );

  // Full refresh: directly refetch the query (used by manual button and all mutations)
  const handleFullRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await contactsQuery.refetch();
    } finally {
      setIsRefreshing(false);
    }
  }, [contactsQuery]);

  const contacts = contactsQuery.data?.contacts || [];
  const totalItems = contactsQuery.data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  // Missing location guard
  if (!locationId) {
    return (
      <div className="ghl-page flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-cyan-100 flex items-center justify-center mx-auto">
            <Search className="h-7 w-7 text-cyan-600" />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">All Contacts</h1>
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
      <div className="ghl-inner contacts-page-inner">
        {/* Page title */}
        <div className="flex items-center justify-between mb-5">
          <h1 className="contacts-page-title">All Contacts</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={handleFullRefresh}
            disabled={isRefreshing || contactsQuery.isLoading}
            className="gap-1.5 text-sm"
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>

        {/* Main card containing the table */}
        <Card className="contacts-table-card">
          {/* Search bar at the top */}
          <div className="contacts-search-container">
            <div className="contacts-search-input">
              <Search className="h-4 w-4 text-slate-400 shrink-0" />
              <Input
                type="text"
                placeholder="Search contacts by email, name, or phone..."
                value={searchQuery}
                onChange={e => handleSearchChange(e.target.value)}
                className="h-9 pl-2 pr-3 text-sm border-slate-200 focus-visible:ring-cyan-400"
              />
            </div>
          </div>

          {/* Table wrapper */}
          <div className="contacts-table-wrapper">
            <ContactTable
              contacts={contacts}
              loading={contactsQuery.isLoading}
              error={
                contactsQuery.error
                  ? "Failed to load contacts from GoHighLevel. Please check your connection and try again."
                  : null
              }
              locationId={locationId}
              onFullRefresh={handleFullRefresh}
            />
          </div>

          {/* Pagination at the bottom */}
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </Card>
      </div>
    </div>
  );
}
