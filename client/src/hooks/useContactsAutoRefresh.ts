import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Hook that provides a shared auto-refresh function for the Contacts page.
 * After any contact mutation (create, update, delete, tag change, DND toggle),
 * this hook invalidates the getContacts query so the UI refetches automatically.
 *
 * Instead of relying on callback chains through multiple component layers,
 * mutations can call `invalidateContacts()` to trigger a fresh fetch.
 *
 * Debouncing: Uses a ref-based debounce (300ms) to prevent multiple
 * invalidations from rapid successive mutations (e.g., batch tag operations).
 */
export function useContactsAutoRefresh(locationId: string) {
  const queryClient = useQueryClient();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const invalidateContacts = useCallback(() => {
    if (!locationId) return;

    // Clear any pending debounce
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // Debounce to 300ms to batch rapid mutations into a single refetch
    debounceTimer.current = setTimeout(() => {
      // Use predicate-based invalidation to target all getContacts queries
      // for this specific locationId, regardless of page/search params.
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          if (!Array.isArray(key) || key.length < 3) return false;
          // tRPC query key shape: ["contacts", "getContacts", { ...input }]
          if (key[0] !== "contacts" || key[1] !== "getContacts") return false;
          const input = key[2] as any;
          return input?.locationId === locationId;
        },
      });
    }, 300);
  }, [queryClient, locationId]);

  return invalidateContacts;
}
