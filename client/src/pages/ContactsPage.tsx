import { useMemo, useState, useEffect } from "react";
import {
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Search,
  X,
  AlertCircle,
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import {
  calculateReviewContactStatus,
  findReviewPipelineId,
  type ReviewContactStatus,
} from "@shared/reviewStatus";

const STATUS_FILTERS = [
  { key: "stopped", label: "Stopped" },
  { key: "clicked", label: "Clicked" },
  { key: "dnc", label: "Do Not Contact" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["key"];
type ContactStatus = "Follow up" | "Clicked" | "Do Not Contact" | "Finished" | "DND" | "";

function statusStyles(status: ContactStatus) {
  switch (status) {
    case "Follow up":
      return {
        label: "Follow Up",
        icon: RefreshCw,
        className: "bg-blue-50 text-blue-700 border-blue-200",
      };
    case "Clicked":
      return {
        label: "Clicked",
        icon: CheckCircle2,
        className: "bg-emerald-50 text-emerald-700 border-emerald-200",
      };
    case "Do Not Contact":
    case "DND":
      return {
        label: "Do Not Contact",
        icon: Ban,
        className: "bg-orange-50 text-orange-700 border-orange-200",
      };
    case "Finished":
    default:
      return {
        label: "Finished",
        icon: CircleDot,
        className: "bg-slate-100 text-slate-700 border-slate-200",
      };
  }
}

function StatusBadge({ status }: { status: ContactStatus }) {
  const style = statusStyles(status);
  const Icon = style.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${style.className}`}
    >
      <Icon className="h-3 w-3" />
      {style.label}
    </span>
  );
}

// Enhanced contact type with calculated status
interface EnhancedContact {
  id: string;
  name: string;
  phone: string;
  email: string;
  smsStatus: ContactStatus;
  emailStatus: ContactStatus;
  dateAdded: string;
}

export default function ContactsPage() {
  const locationId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("locationId") || "";
  }, []);

  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<StatusFilter[]>([]);
  const [cursorHistory, setCursorHistory] = useState<(string[] | undefined)[]>([]);
  const [enhancedContacts, setEnhancedContacts] = useState<Map<string, ContactStatus>>(new Map());
  const [reviewPipelineId, setReviewPipelineId] = useState<string | null>(null);

  const currentCursor = cursorHistory[cursorHistory.length - 1];

  const connectionQuery = trpc.ghl.connectionStatus.useQuery(
    { locationId },
    { enabled: !!locationId, refetchInterval: 60000 }
  );

  // Fetch pipelines to find Review pipeline ID
  const pipelinesQuery = trpc.ghl.getPipelines.useQuery(
    { locationId },
    {
      enabled: !!locationId && connectionQuery.data?.connected === true,
      refetchOnWindowFocus: false,
    }
  );

  // Update reviewPipelineId when pipelines are fetched
  useEffect(() => {
    if (pipelinesQuery.data) {
      const reviewId = findReviewPipelineId(pipelinesQuery.data);
      setReviewPipelineId(reviewId);
    }
  }, [pipelinesQuery.data]);

  const contactsQuery = trpc.ghl.listContacts.useQuery(
    {
      locationId,
      query: appliedSearch,
      pageLimit: 25,
      searchAfter: currentCursor,
      statusFilters: activeFilters,
    },
    {
      enabled: !!locationId && connectionQuery.data?.connected === true,
      refetchOnWindowFocus: false,
      placeholderData: (previousData) => previousData,
    }
  );

  // Query for checking won opportunities (needs to be called per contact)
  const wonOpportunityQuery = trpc.ghl.hasWonOpportunity.useQuery(
    {
      locationId,
      contactId: "",
      pipelineId: reviewPipelineId || "",
    },
    {
      enabled: false, // We'll call this manually for each contact
    }
  );

  // Enhance contacts with opportunity-based status
  useEffect(() => {
    const enhanceContacts = async () => {
      if (!contactsQuery.data?.contacts || !reviewPipelineId) return;

      const enhanced = new Map<string, ContactStatus>();

      for (const contact of contactsQuery.data.contacts) {
        try {
          // Fetch won opportunity status for this contact
          const response = await fetch("/api/trpc/ghl.hasWonOpportunity", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              input: {
                locationId,
                contactId: contact.id,
                pipelineId: reviewPipelineId,
              },
            }),
          });

          let hasWon = false;
          if (response.ok) {
            const data = (await response.json()) as any;
            hasWon = data.result?.data?.hasWon ?? false;
          }

          // Calculate status with opportunity information
          const contact_obj = contact as any;
          const reviewStatus = calculateReviewContactStatus({
            contact: contact_obj,
            isWonInReviewPipeline: hasWon,
          });

          // Map to ContactStatus type for display
          const displayStatus: ContactStatus =
            reviewStatus === ""
              ? (contact.smsStatus as ContactStatus)
              : (reviewStatus as ContactStatus);

          enhanced.set(contact.id, displayStatus);
        } catch (error) {
          console.error(
            `[Contacts] Error checking won opportunities for contact ${contact.id}:`,
            error
          );
          // Fall back to default status
          enhanced.set(contact.id, contact.smsStatus as ContactStatus);
        }
      }

      setEnhancedContacts(enhanced);
    };

    enhanceContacts();
  }, [contactsQuery.data?.contacts, reviewPipelineId, locationId]);

  const isLoading = connectionQuery.isLoading || contactsQuery.isLoading;
  const isError = connectionQuery.isError || contactsQuery.isError;
  const errorMessage =
    (connectionQuery.error instanceof Error && connectionQuery.error.message) ||
    (contactsQuery.error instanceof Error && contactsQuery.error.message) ||
    undefined;

  const totalContacts = contactsQuery.data?.pagination.total ?? 0;
  const canGoNext = Boolean(contactsQuery.data?.pagination.searchAfter?.length);
  const canGoPrev = cursorHistory.length > 0;
  const contacts = contactsQuery.data?.contacts ?? [];

  // Map base contacts to enhanced contacts
  const displayContacts: EnhancedContact[] = contacts.map((contact) => ({
    ...contact,
    smsStatus: enhancedContacts.get(contact.id) || (contact.smsStatus as ContactStatus),
    emailStatus: enhancedContacts.get(contact.id) || (contact.emailStatus as ContactStatus),
  }));

  const handleSearch = () => {
    setAppliedSearch(searchInput.trim());
    setCursorHistory([]);
  };

  const handleClear = () => {
    setSearchInput("");
    setAppliedSearch("");
    setActiveFilters([]);
    setCursorHistory([]);
  };

  const toggleFilter = (filter: StatusFilter) => {
    setCursorHistory([]);
    setActiveFilters((current) =>
      current.includes(filter)
        ? current.filter((item) => item !== filter)
        : [...current, filter]
    );
  };

  if (!locationId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Link2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">ReviewHarvest Contacts</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This page is designed to be embedded inside GoHighLevel. Add it as a
            Custom Menu Link with the <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">?locationId=YOUR_LOCATION_ID&amp;view=contacts</code>
            parameter.
          </p>
          <div className="bg-muted/50 border rounded-lg p-4 text-left">
            <p className="text-xs font-medium text-foreground mb-2">Example URL:</p>
            <code className="text-xs text-muted-foreground break-all">
              {window.location.origin}/?locationId=abc123xyz&amp;view=contacts
            </code>
          </div>
        </div>
      </div>
    );
  }

  if (connectionQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Checking connection...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-rose-100 flex items-center justify-center mx-auto">
            <AlertCircle className="h-7 w-7 text-rose-600" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">API Connection Error</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            We were unable to contact the backend to load the contacts page.
          </p>
          {errorMessage ? <p className="text-xs text-muted-foreground">{errorMessage}</p> : null}
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" onClick={() => connectionQuery.refetch()}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!connectionQuery.data?.connected) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
            <AlertCircle className="h-7 w-7 text-amber-600" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">App Not Connected</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This GoHighLevel sub-account (<code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">{locationId}</code>) has not installed the app yet.
          </p>
          <Button variant="outline" onClick={() => connectionQuery.refetch()} className="mt-2">
            Check Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-foreground leading-none">Contacts</h1>
              <p className="text-xs text-muted-foreground truncate">Location {locationId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{totalContacts} total contacts</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <section className="rounded-xl border bg-card p-4 shadow-sm space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex-1 flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleSearch();
                  }}
                  placeholder="Search contacts..."
                  className="pl-9"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSearch} className="gap-2">
                  <Search className="h-4 w-4" />
                  Search
                </Button>
                <Button variant="outline" onClick={handleClear} className="gap-2">
                  <X className="h-4 w-4" />
                  Clear All
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Filters:</span>
              <span className="font-medium text-foreground">({totalContacts} total contacts)</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((filter) => {
              const active = activeFilters.includes(filter.key);
              return (
                <Button
                  key={filter.key}
                  type="button"
                  variant={active ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleFilter(filter.key)}
                  className="rounded-full"
                >
                  {filter.label}
                </Button>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>SMS Status</TableHead>
                <TableHead>Email Status</TableHead>
                <TableHead>Date Added</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-16 text-center text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading contacts...
                    </div>
                  </TableCell>
                </TableRow>
              ) : displayContacts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-16 text-center text-muted-foreground">
                    No contacts found for the current search and filters.
                  </TableCell>
                </TableRow>
              ) : (
                displayContacts.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell className="font-medium text-foreground">{contact.name}</TableCell>
                    <TableCell>{contact.phone || "-"}</TableCell>
                    <TableCell>{contact.email || "-"}</TableCell>
                    <TableCell><StatusBadge status={contact.smsStatus} /></TableCell>
                    <TableCell><StatusBadge status={contact.emailStatus} /></TableCell>
                    <TableCell>
                      {new Date(contact.dateAdded).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
            <div>
              Showing {displayContacts.length} contact{displayContacts.length === 1 ? "" : "s"}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setCursorHistory((current) => current.slice(0, -1))} disabled={!canGoPrev} className="gap-2">
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const nextCursor = contactsQuery.data?.pagination.searchAfter;
                  if (!nextCursor) return;
                  setCursorHistory((current) => [...current, nextCursor]);
                }}
                disabled={!canGoNext}
                className="gap-2"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
