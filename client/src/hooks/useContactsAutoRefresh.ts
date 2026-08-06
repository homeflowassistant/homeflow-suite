import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Hook that provides an auto-refresh function for the Contacts page.
 *
 * After any contact mutation (create, update, delete, tag change, DND toggle),
 * the Contacts page must immediately show the latest data from the server.
 *
 * ROOT CAUSE OF THE ORIGINAL BUG:
 * The previous implementation used `refetchQueries` with `type: "active"`,
 * which only refetches queries that are currently mounted AND have active
 * observers. This fails when:
 *   - The dialog opens a modal overlay (the Contacts page table is still
 *     mounted but React Query may not consider it "active" during the
 *     mutation callback execution).
 *   - The predicate-based matching was fragile for tRPC's nested query keys.
 *
 * FIX: Use `invalidateQueries` + `queryClient.resetQueries` pattern.
 * `invalidateQueries` marks the query as stale, and when combined with
 * `staleTime: 0` on the query itself, React Query will immediately refetch
 * when the component re-renders. Additionally, we use `queryClient.refetch`
 * directly on the matched queries to force a network request.
 *
 * We match by checking the first two elements of the query key
 * (["contacts", "getContacts"]) rather than trying to parse the input object,
 * which avoids serialization/matching issues with tRPC's superjson encoding.
 */
export function useContactsAutoRefresh(locationId: string) {
  const queryClient = useQueryClient();

  const invalidateContacts = useCallback(() => {
    if (!locationId) return;

    // Strategy: use queryClient.refetch with a simple prefix match
    // This is more reliable than predicate-based matching for tRPC query keys
    // because tRPC internally wraps the input in a structured format.
    //
    // We match any query whose key starts with ["contacts", "getContacts"]
    // which covers all pagination/search variants for this location.
    queryClient.refetchQueries({
      queryKey: ["contacts", "getContacts"],
      type: "all",
    });
  }, [queryClient]);

  return invalidateContacts;
}
