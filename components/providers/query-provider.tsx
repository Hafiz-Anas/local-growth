"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiClientError } from "@/lib/api/client";
import { reportError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** Set when the component shows its own error UI for this mutation. */
      handlesErrors?: boolean;
    };
  }
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Latest translator for the (long-lived) mutation cache callbacks. */
const translator: { current: Translate } = { current: (key) => key };

/**
 * TanStack Query for every API call. Failed mutations are reported centrally
 * (toast, or the Connect Instagram prompt) unless they opt out with
 * `meta: { handlesErrors: true }`. Query errors are shown inline by each screen.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  useEffect(() => {
    translator.current = t;
  }, [t]);

  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // Don't retry client errors (404 for a disabled feature, 401, …).
            retry: (count, error) => !(error instanceof ApiClientError && error.status > 0 && error.status < 500) && count < 2,
          },
        },
        mutationCache: new MutationCache({
          onError: (error, _vars, _ctx, mutation) => {
            if (!mutation.meta?.handlesErrors) reportError(error, (key, vars) => translator.current(key, vars));
          },
        }),
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
