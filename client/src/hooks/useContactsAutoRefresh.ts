import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Hook that provides an immediate auto-refresh function for the Contacts page.
 * After any contact mutation (create, update, delete, tag change, DND toggle),
 * this hook FORCES a fresh network refetch so the UI always shows latest data.
 *
 * Uses `refetchQueries` (not `invalidateQueries`) to guarantee an actual
 * network request is made — this ensures the user never sees stale data.
 * No debounce: every mutation triggers an immediate refetch.
 */
export function useContactsAutoRefresh(locationId: string) {
  const queryClient = useQueryClient();

  const invalidateContacts = useCallback(() => {
    if (!locationId) return;

    // refetchQueries forces an actual network request, unlike invalidateQueries
    // which only marks data as stale (and may not refetch if staleTime hasn't passed).
    queryClient.refetchQueries({
      predicate: (query) => {
        const key = query.queryKey;
        if (!Array.isArray(key) || key.length < 3) return false;
        // tRPC query key shape: ["contacts", "getContacts", { ...input }]
        if (key[0] !== "contacts" || key[1] !== "getContacts") return false;
        const input = key[2] as any;
        return input?.locationId === locationId;
      },
      type: "active",
    });
  }, [queryClient, locationId]);

  return invalidateContacts;
}
