'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { formatDate, formatDateTime, formatMoney, humanize } from '@/lib/format';
import { useCan } from '@/lib/session';

// ---------------------------------------------------------------- layout

export interface Crumb {
  label: string;
  href?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
}: {
  title: string;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
}) {
  return (
    <div>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="breadcrumbs">
          <ol>
            {breadcrumbs.map((c, i) => (
              <li key={`${c.label}-${i}`}>{c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</li>
            ))}
          </ol>
        </nav>
      )}
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card" aria-label={title}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- states

export function Notice({
  kind,
  children,
  reveal,
}: {
  kind: 'success' | 'error' | 'info' | 'warning';
  children: ReactNode;
  /** For errors: scroll the notice into view when it appears and whenever this value changes (pass the new message or result). */
  reveal?: unknown;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  // On a long form the notice can sit far above the button that was pressed; an error the
  // operator never sees reads as "nothing happened". 'nearest' leaves the page alone when the
  // notice is already visible.
  useEffect(() => {
    if (kind === 'error') ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [kind, reveal]);
  // Errors interrupt (alert); everything else is announced politely (status).
  return (
    <p ref={ref} className={`${kind}-banner`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

export function ActionMessage({ message }: { message: { kind: 'success' | 'error'; text: string } | null }) {
  if (!message) return null;
  return (
    <Notice kind={message.kind} reveal={message}>
      {message.text}
    </Notice>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="loading-state" role="status" aria-live="polite">
      {label}
    </p>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-banner" role="alert">
      {message}{' '}
      {onRetry && (
        <button type="button" className="link-button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

/** Loading / error / empty handling for one fetched value; renders children only when data is present. */
export function DataState<T>({
  state,
  empty,
  isEmpty,
  children,
}: {
  state: { data: T | undefined; error: string | null; loading: boolean; reload: () => void };
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;
  if (state.data === undefined) return state.loading ? <LoadingState /> : null;
  if (empty && isEmpty?.(state.data)) return <EmptyState>{empty}</EmptyState>;
  return <>{children(state.data)}</>;
}

// ---------------------------------------------------------------- data display

const STATUS_TONES: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  // lifecycle / generic
  DRAFT: 'neutral',
  READY_FOR_ENRICHMENT: 'info',
  READY_FOR_QA: 'info',
  PUBLISHED: 'success',
  UNPUBLISHED: 'warning',
  ARCHIVED: 'neutral',
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  DISABLED: 'danger',
  DEPLETED: 'neutral',
  // procurement
  SUBMITTED: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success',
  FULLY_RECEIVED: 'success',
  QC_PASSED: 'success',
  CLOSED: 'neutral',
  CANCELLED: 'neutral',
  PASS: 'success',
  FAIL: 'danger',
  PARTIAL: 'warning',
  // orders / fulfilment
  CONFIRMED: 'info',
  PROCESSING: 'info',
  ALLOCATED: 'info',
  PICKED: 'info',
  PACKED: 'info',
  READY_TO_SHIP: 'info',
  SHIPPED: 'info',
  BOOKED: 'warning',
  BOOKED_AWAITING_COLLECTION: 'warning',
  HANDED_OVER: 'info',
  IN_TRANSIT: 'info',
  OUT_FOR_DELIVERY: 'info',
  DELIVERED: 'success',
  COMPLETED: 'success',
  EXCEPTION: 'danger',
  SHORT_PICKED: 'warning',
  RTO: 'warning',
  RTO_INITIATED: 'warning',
  RTO_DELIVERED: 'warning',
  DELIVERY_FAILED: 'warning',
  PENDING: 'warning',
  ISSUED: 'success',
  FAILED: 'danger',
  CREATED: 'info',
  // post-purchase
  REQUESTED: 'warning',
  PICKUP_SCHEDULED: 'info',
  PICKED_UP: 'info',
  DISPOSITIONED: 'success',
  REPLACEMENT_ALLOCATED: 'info',
  QC_FAILED: 'danger',
  REPLACEMENT_UNAVAILABLE: 'danger',
  // channels
  NOT_PUBLISHED: 'neutral',
  AMBIGUOUS_RECONCILIATION_REQUIRED: 'danger',
  SUCCESS: 'success',
};

const STATUS_LABELS: Record<string, string> = {
  BOOKED: 'Booked — awaiting collection',
  BOOKED_AWAITING_COLLECTION: 'Booked — awaiting collection',
  HANDED_OVER: 'Handed over',
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="muted">—</span>;
  return <span className={`badge ${STATUS_TONES[status] ?? 'neutral'}`}>{STATUS_LABELS[status] ?? humanize(status)}</span>;
}

export function YesNo({ value }: { value: boolean }) {
  return <span className={`badge ${value ? 'success' : 'neutral'}`}>{value ? 'Yes' : 'No'}</span>;
}

export function Money({ value, currency }: { value: number | string | null | undefined; currency?: string }) {
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(value, currency)}</span>;
}

export function DateText({ value, withTime = false }: { value: string | Date | null | undefined; withTime?: boolean }) {
  if (!value) return <span className="muted">—</span>;
  const iso = typeof value === 'string' ? value : value.toISOString();
  return <time dateTime={iso}>{withTime ? formatDateTime(value) : formatDate(value)}</time>;
}

/** A business identifier (SKU code, PO number, order number) in monospace. */
export function Ident({ children }: { children: ReactNode }) {
  return <span className="mono">{children}</span>;
}

export function SkuText({ sku }: { sku: { skuCode: string; style?: { name?: string } | null; colour?: { name: string } | null; size?: { label: string } | null } }) {
  const detail = [sku.style?.name, sku.colour?.name, sku.size?.label].filter(Boolean).join(' · ');
  return (
    <span>
      <Ident>{sku.skuCode}</Ident>
      {detail && <span className="muted"> — {detail}</span>}
    </span>
  );
}

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  numeric?: boolean;
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  empty = 'Nothing to show.',
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
}) {
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col" className={c.numeric ? 'num' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <EmptyState>{empty}</EmptyState>
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={rowKey(r)}>
                {columns.map((c) => (
                  <td key={c.header} className={c.numeric ? 'num' : undefined}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ total, take, skip, onChange }: { total: number; take: number; skip: number; onChange: (skip: number) => void }) {
  const from = total === 0 ? 0 : skip + 1;
  const to = Math.min(skip + take, total);
  return (
    <nav className="pagination" aria-label="Pagination">
      <span>
        {from}–{to} of {total}
      </span>
      <span className="row">
        <button type="button" className="btn small" disabled={skip === 0} onClick={() => onChange(Math.max(0, skip - take))}>
          Previous
        </button>
        <button type="button" className="btn small" disabled={skip + take >= total} onClick={() => onChange(skip + take)}>
          Next
        </button>
      </span>
    </nav>
  );
}

// ---------------------------------------------------------------- forms

export function Field({ label, hint, children, id }: { label: string; hint?: ReactNode; id: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  type = 'text',
  required,
  placeholder,
  min,
  step,
  autoComplete,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  type?: string;
  required?: boolean;
  placeholder?: string;
  min?: number;
  step?: string;
  autoComplete?: string;
  /** Called on Enter instead of submitting the form (barcode scanners end each scan with Enter). */
  onEnter?: () => void;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} id={id}>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        min={min}
        step={step}
        autoComplete={autoComplete}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={
          onEnter
            ? (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onEnter();
                }
              }
            : undefined
        }
      />
    </Field>
  );
}

export function TextArea({ label, value, onChange, hint, required }: { label: string; value: string; onChange: (v: string) => void; hint?: ReactNode; required?: boolean }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} id={id}>
      <textarea id={id} value={value} required={required} aria-describedby={hint ? `${id}-hint` : undefined} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  hint,
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  hint?: ReactNode;
  required?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} id={id}>
      <select id={id} value={value} required={required} aria-describedby={hint ? `${id}-hint` : undefined} onChange={(e) => onChange(e.target.value)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="check">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

// ---------------------------------------------------------------- permissions

/** Renders children only when the session holds one of `anyOf`. The API still authorizes the action. */
export function Can({ anyOf, children }: { anyOf: string[]; children: ReactNode }) {
  const allowed = useCan(...anyOf);
  return allowed ? <>{children}</> : null;
}

// ---------------------------------------------------------------- dialogs

function useDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return ref;
}

/**
 * Confirmation for consequential actions. `requireText` makes the operator
 * type a word (e.g. RUN) before the confirm button enables - used for
 * privileged sweeps.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger,
  busy,
  requireText,
  confirmDisabled,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  requireText?: string;
  /** Keeps the confirm button disabled (the dialog explains why). */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useDialog(open);
  const titleId = useId();
  const inputId = useId();
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);
  const ready = !requireText || typed === requireText;
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <div className="modal-body">
        <h2 id={titleId}>{title}</h2>
        {children}
        {requireText && (
          <div className="field" style={{ marginTop: '0.75rem' }}>
            <label htmlFor={inputId}>Type {requireText} to confirm</label>
            <input id={inputId} value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
          </div>
        )}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={danger ? 'btn danger' : 'primary'} onClick={onConfirm} disabled={busy || !ready || confirmDisabled}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

export function Drawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useDialog(open);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="drawer-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="btn small" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="drawer-body">{open && children}</div>
    </dialog>
  );
}

export function Tabs<K extends string>({ tabs, active, onChange }: { tabs: Array<{ key: K; label: string }>; active: K; onChange: (k: K) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={active === t.key} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
