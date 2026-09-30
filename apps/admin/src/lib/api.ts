'use client';

import { API_URL, getStoredSession, clearSession } from './staff-auth';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * Authenticated fetch wrapper for every admin-app call to commerce-api's
 * staff-gated routes. A 401 clears the local session (server-side
 * authorization is authoritative - the client never guesses whether a
 * token is still valid, it just reacts to what the server says). A 403
 * is returned to the caller as an `ApiError`, never swallowed, so a
 * screen can show the real "Forbidden" outcome FLOW 19 requires -
 * proving rejection is server-side, not a client-side guess about what
 * the UI should or shouldn't render.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = getStoredSession();
  const headers: Record<string, string> = {
    ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };
  if (session) headers.authorization = `Bearer ${session.token}`;

  const res = await fetch(`${API_URL}/api/v1${path}`, { ...init, headers });

  if (res.status === 401) {
    clearSession();
    throw new ApiError(401, 'Your session has expired. Please sign in again.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
    throw new ApiError(res.status, body?.error?.message ?? `Request failed (${res.status})`, body?.error?.code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** POST/PATCH/PUT helper: the body is always JSON, and an empty body is sent as `{}`. */
export function apiSend<T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method, ...(method === 'DELETE' && body === undefined ? {} : { body: JSON.stringify(body ?? {}) }) });
}

/** Query string from a params object, dropping empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

/** A human message for any thrown value; 403s are labelled so the operator knows the server refused. */
export function errorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (err instanceof ApiError && err.status === 403) return `Forbidden: ${err.message}`;
  if (err instanceof Error) return err.message;
  return fallback;
}

/** A fresh idempotency key for one user-initiated action. Retrying the same action reuses it. */
export function newIdempotencyKey(prefix: string): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `admin-${prefix}-${rand}`;
}

export interface Page<T> {
  items: T[];
  total: number;
}
