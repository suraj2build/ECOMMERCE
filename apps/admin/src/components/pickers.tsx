'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { apiFetch, errorMessage, qs } from '@/lib/api';
import { useApi, useCan, useDebounced } from '@/lib/session';
import { Field, SelectField } from './ui';

/**
 * Searchable single-select (WAI-ARIA combobox with a listbox popup). The
 * server does the searching - each keystroke (debounced) asks a bounded
 * lookup endpoint, so no picker ever loads a whole table.
 *
 * Keyboard: type to search, ArrowDown/ArrowUp to move, Enter to choose,
 * Escape to close.
 */
export function SearchableSelect<T>({
  label,
  value,
  onChange,
  search,
  optionKey,
  renderOption,
  renderSelected,
  placeholder = 'Type to search…',
  hint,
  required,
}: {
  label: string;
  value: T | null;
  onChange: (value: T | null) => void;
  search: (q: string) => Promise<T[]>;
  optionKey: (o: T) => string;
  renderOption: (o: T) => ReactNode;
  renderSelected?: (o: T) => ReactNode;
  placeholder?: string;
  hint?: ReactNode;
  required?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<T[]>([]);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const debounced = useDebounced(query, 200);
  const latest = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const term = debounced.trim();
    if (!term) {
      setOptions([]);
      return;
    }
    const call = ++latest.current;
    setLoading(true);
    setError(null);
    search(term)
      .then((rows) => {
        if (call !== latest.current) return;
        setOptions(rows);
        setActive(0);
      })
      .catch((err) => {
        if (call === latest.current) setError(errorMessage(err));
      })
      .finally(() => {
        if (call === latest.current) setLoading(false);
      });
    // search is recreated by callers each render; only the term drives a new request.
  }, [debounced]);

  function choose(o: T) {
    onChange(o);
    setQuery('');
    setOpen(false);
  }

  if (value) {
    return (
      <Field label={label} id={id} hint={hint}>
        <div className="combobox-selected">
          <span id={id} tabIndex={-1}>
            {(renderSelected ?? renderOption)(value)}
          </span>
          <button
            type="button"
            className="btn small"
            aria-label={`Change ${label}`}
            onClick={() => {
              onChange(null);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            Change
          </button>
        </div>
      </Field>
    );
  }

  const expanded = open && query.trim().length > 0;
  return (
    <Field label={label} id={id} hint={hint}>
      <div className="combobox">
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded && options[active] ? `${id}-opt-${active}` : undefined}
          aria-required={required}
          autoComplete="off"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, Math.max(options.length - 1, 0)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && expanded) {
              e.preventDefault();
              const o = options[active];
              if (o) choose(o);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        {expanded && (
          <ul id={listId} role="listbox" aria-label={`${label} results`} className="combobox-list">
            {loading && options.length === 0 && (
              <li role="option" aria-selected={false} aria-disabled="true" className="combobox-option muted">
                Searching…
              </li>
            )}
            {error && (
              <li role="option" aria-selected={false} aria-disabled="true" className="combobox-option" style={{ color: 'var(--color-danger)' }}>
                {error}
              </li>
            )}
            {!loading && !error && options.length === 0 && (
              <li role="option" aria-selected={false} aria-disabled="true" className="combobox-option muted">
                No matches
              </li>
            )}
            {options.map((o, i) => (
              // Mouse selection mirrors Enter on the input, which owns keyboard handling (combobox pattern).
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <li
                key={optionKey(o)}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className="combobox-option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
              >
                {renderOption(o)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  );
}

// ---------------------------------------------------------------- domain pickers

export interface SkuOption {
  id: string;
  skuCode: string;
  isActive: boolean;
  style: { id: string; styleCode: string; name: string; lifecycleState: string };
  colour: { name: string; colourCode: string };
  size: { label: string };
}

export function SkuPicker(props: { label?: string; value: SkuOption | null; onChange: (v: SkuOption | null) => void; hint?: ReactNode; required?: boolean }) {
  return (
    <SearchableSelect<SkuOption>
      label={props.label ?? 'SKU'}
      value={props.value}
      onChange={props.onChange}
      hint={props.hint ?? 'Search by SKU code, barcode, style code or style name.'}
      required={props.required}
      search={(q) => apiFetch<SkuOption[]>(`/admin/lookup/skus${qs({ q })}`)}
      optionKey={(o) => o.id}
      renderOption={(o) => (
        <span>
          <span className="mono">{o.skuCode}</span>{' '}
          <span className="muted">
            {o.style.name} · {o.colour.name} · {o.size.label}
            {!o.isActive && ' · inactive'}
          </span>
        </span>
      )}
    />
  );
}

export interface StyleOption {
  id: string;
  styleCode: string;
  name: string;
  lifecycleState: string;
}

export function StylePicker(props: { label?: string; value: StyleOption | null; onChange: (v: StyleOption | null) => void; hint?: ReactNode }) {
  return (
    <SearchableSelect<StyleOption>
      label={props.label ?? 'Style'}
      value={props.value}
      onChange={props.onChange}
      hint={props.hint ?? 'Search by style code or name.'}
      search={(q) => apiFetch<StyleOption[]>(`/admin/lookup/styles${qs({ q })}`)}
      optionKey={(o) => o.id}
      renderOption={(o) => (
        <span>
          <span className="mono">{o.styleCode}</span> <span className="muted">{o.name}</span>
        </span>
      )}
    />
  );
}

export interface SupplierOption {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
}

export function SupplierPicker(props: { label?: string; value: SupplierOption | null; onChange: (v: SupplierOption | null) => void; required?: boolean }) {
  return (
    <SearchableSelect<SupplierOption>
      label={props.label ?? 'Supplier'}
      value={props.value}
      onChange={props.onChange}
      required={props.required}
      hint="Search by supplier name or code."
      search={(q) => apiFetch<SupplierOption[]>(`/admin/lookup/suppliers${qs({ q })}`)}
      optionKey={(o) => o.id}
      renderOption={(o) => (
        <span>
          {o.name} <span className="mono muted">{o.code}</span>
          {!o.isActive && <span className="muted"> · inactive</span>}
        </span>
      )}
    />
  );
}

export interface LocationOption {
  id: string;
  code: string;
  name: string;
  type: string;
}

/** Active locations (a small reference table, GET /organization/locations). */
export function LocationSelect({
  label = 'Location',
  value,
  onChange,
  required,
  allowAny,
  hint,
}: {
  label?: string;
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
  allowAny?: string;
  hint?: ReactNode;
}) {
  const locations = useApi<LocationOption[]>('/organization/locations');
  if (locations.error) return <p className="error-banner">{locations.error}</p>;
  return (
    <SelectField
      label={label}
      value={value}
      onChange={onChange}
      required={required}
      hint={hint}
      placeholder={allowAny ?? (locations.data ? 'Choose a location' : 'Loading…')}
      options={(locations.data ?? []).map((l) => ({ value: l.id, label: `${l.name} (${l.code})` }))}
    />
  );
}

/** Mirrors STAFF_CAPABILITIES in services/commerce-api/src/modules/admin-queries/service.ts. */
const CAPABILITY_REQUIRES = {
  'inventory-coapprover': 'inventory:adjust',
  'grn-qc-signoff': 'grn:create',
  'pick-shortfall-coapprover': 'warehouse:pick',
} as const;

/**
 * Staff who can approve/sign off, for co-approval fields. The list comes
 * from GET /admin/lookup/staff, which returns identity only; the API
 * re-checks the chosen person's permission when the action is submitted.
 */
export function StaffSelect({
  label,
  capability,
  value,
  onChange,
  hint,
}: {
  label: string;
  capability: 'inventory-coapprover' | 'grn-qc-signoff' | 'pick-shortfall-coapprover';
  value: string;
  onChange: (id: string) => void;
  hint?: ReactNode;
}) {
  // Only staff who may perform the action can list its approvers (the API
  // enforces the same rule); others get no picker and no denied request.
  const allowed = useCan(CAPABILITY_REQUIRES[capability]);
  const staff = useApi<Array<{ id: string; fullName: string; self?: boolean }>>(allowed ? `/admin/lookup/staff${qs({ capability })}` : null);
  if (!allowed) return null;
  if (staff.error) return <p className="error-banner">{staff.error}</p>;
  return (
    <SelectField
      label={label}
      value={value}
      onChange={onChange}
      hint={hint}
      placeholder="None"
      options={(staff.data ?? []).map((s) => ({ value: s.id, label: s.self ? `${s.fullName} (me, owner approval)` : s.fullName }))}
    />
  );
}
