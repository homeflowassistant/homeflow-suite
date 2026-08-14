import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { trpc } from "@/lib/trpc";

/**
 * Hook that provides an auto-refresh function for the Contacts page.
 *
 * After any contact mutation (create, update, delete, tag change, DND toggle),
 * this hook marks the contacts query stale and forces a fresh network
 * refetch so the UI always shows the latest data.
 *
 * APPROACH:
 * We use tRPC's built-in getQueryKey helper to get the EXACT query key
 * that tRPC uses internally. This avoids any guesswork about the key format.
 * We then invalidate the query (matches it regardless of the current
 * page/search input, since input is omitted) and explicitly refetch any
 * currently-mounted/active instance of it so the table reflects the latest
 * server data immediately — without waiting for a remount or window focus.
 *
 * NOTE: Previously this used `removeQueries` followed by `resetQueries` on
 * the same key. `removeQueries` deletes the query from the cache entirely,
 * so the subsequent `resetQueries` had nothing left to find/reset and was
 * a no-op — no refetch was ever triggered, which is why the table used to
 * keep showing stale data after applying a tag or toggling DND.
 */
export function useContactsAutoRefresh(locationId: string) {
  const queryClient = useQueryClient();

  // Get the exact query key that tRPC uses for getContacts
  const queryKey = getQueryKey(trpc.contacts.getContacts, undefined, "query");

  const refreshContacts = useCallback(() => {
    if (!locationId) return;

    // Mark all getContacts queries (any page/search variant) as stale and
    // refetch the ones that are currently active (i.e. mounted on screen).
    // This is the standard, reliable way to force fresh data after a
    // mutation in TanStack Query — unlike remove+reset, it's guaranteed to
    // trigger a network refetch on the live query.
    void queryClient.invalidateQueries({
      queryKey,
      refetchType: "active",
    });
  }, [queryClient, queryKey]);

  return refreshContacts;
}
