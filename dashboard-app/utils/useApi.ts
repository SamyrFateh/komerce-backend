// Komerce Dashboard — useApi hook
// Fetches data from the API with loading/error states and mock fallback

import { useState, useEffect, useCallback, useRef } from 'react';

export interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  usingMock: boolean;
}

/**
 * React hook for fetching API data with graceful fallback to mock data.
 *
 * @param fetcher — async function that calls the API (e.g., () => api.ops())
 * @param fallback — mock data to use if the API call fails
 * @param autoRefreshMs — optional auto-refresh interval in ms (default: 0 = disabled)
 */
export function useApi<T>(
  fetcher: () => Promise<T>,
  fallback: T,
  autoRefreshMs = 0,
): UseApiResult<T> {
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingMock, setUsingMock] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    fetcherRef.current()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setUsingMock(false);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Erreur inconnue');
          setData(fallback);
          setUsingMock(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefreshMs <= 0) return;
    const interval = setInterval(reload, autoRefreshMs);
    return () => clearInterval(interval);
  }, [autoRefreshMs, reload]);

  return { data, loading, error, reload, usingMock };
}
