import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { trpc } from "@/lib/trpc";

/**
 * Hook that provides an auto-refresh function for the Contacts page.
 *
 * After any contact mutation (create, update, delete, tag change, DND toggle),
 * this hook completely resets the contacts query cache and forces a fresh
 * network refetch so the UI always shows the latest data.
 *
 * APPROACH:
 * We use tRPC's built-in getQueryKey helper to get the EXACT query key
 * that tRPC uses internally. This avoids any guesswork about the key format.
 * Then we reset the query (clears cached data entirely) and refetch it
 * immediately so the table always shows fresh data from the server.
 */
export function useContactsAutoRefresh(locationId: string) {
  const queryClient = useQueryClient();

  // Get the exact query key that tRPC uses for getContacts
  const queryKey = getQueryKey(trpc.contacts.getContacts, undefined, "query");

  const refreshContacts = useCallback(() => {
    if (!locationId) return;

    // Step 1: Remove all cached data for this query so it cannot serve stale results
    queryClient.removeQueries({ queryKey });

    // Step 2: Reset the query state so it will automatically refetch
    // when the component re-renders (driven by staleTime: 0)
    queryClient.resetQueries({ queryKey });
  }, [queryClient, queryKey]);

  return refreshContacts;
}
