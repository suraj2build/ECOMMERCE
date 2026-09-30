'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiFetch, errorMessage } from './api';
import type { StaffSession } from './staff-auth';

const SessionContext = createContext<StaffSession | null>(null);

export const SessionProvider = SessionContext.Provider;

export function useSession(): StaffSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside the dashboard layout');
  return session;
}

/** True when the session holds any of the permissions. UX only - the API still decides. */
export function useCan(...anyOf: string[]): boolean {
  const session = useSession();
  return anyOf.some((p) => session.permissions.includes(p));
}

export interface ApiState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * GET `path` (or nothing when null) and keep the latest response. A
 * stale response for an earlier path is dropped so fast typing in a
 * filter never shows results for an old query.
 */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (path === null) {
      setData(undefined);
      setError(null);
      setLoading(false);
      return;
    }
    const call = ++latest.current;
    setLoading(true);
    setError(null);
    apiFetch<T>(path)
      .then((res) => {
        if (call === latest.current) setData(res);
      })
      .catch((err) => {
        if (call === latest.current) {
          setData(undefined);
          setError(errorMessage(err));
        }
      })
      .finally(() => {
        if (call === latest.current) setLoading(false);
      });
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export interface ActionState {
  busy: boolean;
  message: { kind: 'success' | 'error'; text: string } | null;
  run: (fn: () => Promise<unknown>, success?: string) => Promise<boolean>;
  clear: () => void;
}

/** One in-flight mutation at a time, with the server's own error text on failure. */
export function useAction(): ActionState {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ActionState['message']>(null);
  const run = useCallback(async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      if (success) setMessage({ kind: 'success', text: success });
      return true;
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  const clear = useCallback(() => setMessage(null), []);
  return { busy, message, run, clear };
}

/**
 * A filter value mirrored in the URL query string, so queue links from
 * the dashboard (e.g. ?status=PENDING) open pre-filtered and a filtered
 * view can be shared. Read after mount to keep server and client
 * renders identical.
 */
export function useUrlFilter(name: string, fallback = ''): [string, (v: string) => void, boolean] {
  const [value, setValue] = useState(fallback);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get(name);
    if (v !== null) setValue(v);
    setReady(true);
  }, [name]);
  const update = useCallback(
    (v: string) => {
      setValue(v);
      const url = new URL(window.location.href);
      if (v) url.searchParams.set(name, v);
      else url.searchParams.delete(name);
      window.history.replaceState(null, '', url.toString());
    },
    [name],
  );
  return [value, update, ready];
}
