'use client';

import { useEffect, useState } from 'react';
import { ActionMessage, Can, Checkbox, DataState, DataTable, DateText, Notice, PageHeader, Section, SelectField, StatusBadge, TextField } from '@/components/ui';
import { apiSend } from '@/lib/api';
import { useAction, useApi, useCan } from '@/lib/session';

interface LegalEntity {
  id: string;
  legalName: string;
  pan: string | null;
  cin: string | null;
  registeredAddressLine1: string | null;
  registeredAddressLine2: string | null;
  registeredCity: string | null;
  registeredState: string | null;
  registeredPinCode: string | null;
}

interface GstRegistration {
  id: string;
  legalEntityId: string;
  gstin: string;
  stateCode: string;
  stateName: string;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

interface Location {
  id: string;
  code: string;
  name: string;
  type: 'WAREHOUSE' | 'STORE';
  isActive: boolean;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pinCode: string | null;
  gstRegistrationId: string | null;
}

type EntityForm = Record<Exclude<keyof LegalEntity, 'id'>, string>;
const EMPTY_ENTITY: EntityForm = { legalName: '', pan: '', cin: '', registeredAddressLine1: '', registeredAddressLine2: '', registeredCity: '', registeredState: '', registeredPinCode: '' };
const toForm = (e: LegalEntity): EntityForm => ({
  legalName: e.legalName,
  pan: e.pan ?? '',
  cin: e.cin ?? '',
  registeredAddressLine1: e.registeredAddressLine1 ?? '',
  registeredAddressLine2: e.registeredAddressLine2 ?? '',
  registeredCity: e.registeredCity ?? '',
  registeredState: e.registeredState ?? '',
  registeredPinCode: e.registeredPinCode ?? '',
});
/** Blank optional fields are sent as null so an edit can clear them. */
const entityBody = (f: EntityForm, isNew: boolean) =>
  Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() === '' ? (isNew ? undefined : k === 'legalName' ? v : null) : v.trim()]));

/**
 * Business & warehouse (AO-D3, Product Owner 2026-10-05: routine
 * operational configuration should not need server access). The legal
 * business details and GST registrations invoices are issued under, and
 * the warehouse address couriers collect from. Values are the owner's own
 * registrations; nothing is filled in or checked against a government
 * service here.
 */
export default function BusinessPage() {
  const canTax = useCan('tax:read', 'tax:manage');
  const entities = useApi<LegalEntity[]>(canTax ? '/tax/legal-entities' : null);
  const registrations = useApi<GstRegistration[]>(canTax ? '/tax/gst-registrations' : null);
  const locations = useApi<Location[]>('/organization/locations');

  return (
    <div>
      <PageHeader
        title="Business & warehouse"
        breadcrumbs={[{ label: 'Setup' }, { label: 'Business & warehouse' }]}
        description="Your registered business details, GST registrations and the warehouse address. Invoices and courier pickups use these."
      />
      {canTax && (
        <>
          <DataState state={entities}>{(rows) => <BusinessDetails entity={rows[0] ?? null} onSaved={entities.reload} />}</DataState>
          <DataState state={entities}>
            {(rows) =>
              rows[0] ? (
                <DataState state={registrations}>
                  {(regs) => <GstRegistrations entityId={rows[0]!.id} rows={regs.filter((r) => r.legalEntityId === rows[0]!.id)} onSaved={() => { registrations.reload(); locations.reload(); }} />}
                </DataState>
              ) : null
            }
          </DataState>
        </>
      )}
      <DataState state={locations}>
        {(rows) => <Warehouses rows={rows} registrations={registrations.data ?? []} onSaved={locations.reload} />}
      </DataState>
      <DispatchChecks />
    </div>
  );
}

interface DispatchSettings {
  requireScanAtPick: boolean;
  requireScanAtPack: boolean;
  requireParcelMeasurements: boolean;
}

/** The owner's dispatch checks (B-2, B-3; docs/admin/DISPATCH.md). All off by default. */
function DispatchChecks() {
  const settings = useApi<DispatchSettings>('/dispatch/settings');
  const canManage = useCan('org:manage');
  const action = useAction();
  const [value, setValue] = useState<DispatchSettings | null>(null);
  useEffect(() => {
    if (settings.data) setValue(settings.data);
  }, [settings.data]);
  return (
    <Section title="Dispatch checks">
      <p className="muted" style={{ marginTop: 0 }}>
        A scan or measurement that is entered is always checked. These choose whether one is required before a pick or pack is accepted.
      </p>
      <ActionMessage message={action.message} />
      {value && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await action.run(() => apiSend('PUT', '/dispatch/settings', value), 'Dispatch checks saved.');
            if (ok) settings.reload();
          }}
        >
          <Checkbox label="Require a barcode scan at pick" checked={value.requireScanAtPick} onChange={(v) => canManage && setValue({ ...value, requireScanAtPick: v })} />
          <Checkbox label="Require every unit to be scanned at pack" checked={value.requireScanAtPack} onChange={(v) => canManage && setValue({ ...value, requireScanAtPack: v })} />
          <Checkbox
            label="Require parcel weight and dimensions at pack"
            checked={value.requireParcelMeasurements}
            onChange={(v) => canManage && setValue({ ...value, requireParcelMeasurements: v })}
          />
          <Can anyOf={['org:manage']}>
            <button className="primary" type="submit" disabled={action.busy}>
              Save dispatch checks
            </button>
          </Can>
        </form>
      )}
    </Section>
  );
}

function BusinessDetails({ entity, onSaved }: { entity: LegalEntity | null; onSaved: () => void }) {
  const action = useAction();
  const [form, setForm] = useState<EntityForm>(entity ? toForm(entity) : EMPTY_ENTITY);
  useEffect(() => setForm(entity ? toForm(entity) : EMPTY_ENTITY), [entity]);
  const set = (k: keyof EntityForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Section title="Business details">
      <p className="muted" style={{ marginTop: 0 }}>
        Exactly as registered; these appear on tax invoices.
      </p>
      <ActionMessage message={action.message} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await action.run(
            () => (entity ? apiSend('PATCH', `/tax/legal-entities/${entity.id}`, entityBody(form, false)) : apiSend('POST', '/tax/legal-entities', entityBody(form, true))),
            'Business details saved.',
          );
          if (ok) onSaved();
        }}
      >
        <div className="form-row">
          <TextField label="Legal business name" value={form.legalName} onChange={set('legalName')} required />
          <TextField label="PAN" value={form.pan} onChange={set('pan')} />
          <TextField label="CIN (companies only)" value={form.cin} onChange={set('cin')} />
        </div>
        <div className="form-row">
          <TextField label="Registered address line 1" value={form.registeredAddressLine1} onChange={set('registeredAddressLine1')} />
          <TextField label="Registered address line 2" value={form.registeredAddressLine2} onChange={set('registeredAddressLine2')} />
        </div>
        <div className="form-row">
          <TextField label="City" value={form.registeredCity} onChange={set('registeredCity')} />
          <TextField label="State" value={form.registeredState} onChange={set('registeredState')} />
          <TextField label="PIN code" value={form.registeredPinCode} onChange={set('registeredPinCode')} />
        </div>
        <Can anyOf={['tax:manage']}>
          <button className="primary" type="submit" disabled={action.busy}>
            {entity ? 'Save business details' : 'Add business details'}
          </button>
        </Can>
      </form>
    </Section>
  );
}

function GstRegistrations({ entityId, rows, onSaved }: { entityId: string; rows: GstRegistration[]; onSaved: () => void }) {
  const action = useAction();
  const [gstin, setGstin] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [stateName, setStateName] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  return (
    <Section title="GST registrations">
      <ActionMessage message={action.message} />
      <DataTable
        caption="GST registrations"
        rows={rows}
        rowKey={(r) => r.id}
        empty="No GST registration yet. Invoices cannot be issued without an active one."
        columns={[
          { header: 'GSTIN', cell: (r) => <span className="mono">{r.gstin}</span> },
          { header: 'State', cell: (r) => `${r.stateName} (${r.stateCode})` },
          { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
          { header: 'From', cell: (r) => <DateText value={r.effectiveFrom} /> },
          {
            header: 'Change status',
            cell: (r) => (
              <Can anyOf={['tax:manage']}>
                <select
                  aria-label={`Status of ${r.gstin}`}
                  value={r.status}
                  disabled={action.busy}
                  onChange={async (e) => {
                    const ok = await action.run(() => apiSend('PATCH', `/tax/gst-registrations/${r.id}`, { status: e.target.value }), 'Registration updated.');
                    if (ok) onSaved();
                  }}
                >
                  {['PENDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED'].map((s) => (
                    <option key={s} value={s}>
                      {s.toLowerCase()}
                    </option>
                  ))}
                </select>
              </Can>
            ),
          },
        ]}
      />
      <Can anyOf={['tax:manage']}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await action.run(
              () => apiSend('POST', '/tax/gst-registrations', { legalEntityId: entityId, gstin: gstin.trim().toUpperCase(), stateCode: stateCode.trim(), stateName: stateName.trim(), status: 'ACTIVE', effectiveFrom }),
              'GST registration added.',
            );
            if (ok) {
              setGstin('');
              setStateCode('');
              setStateName('');
              setEffectiveFrom('');
              onSaved();
            }
          }}
        >
          <h3>Add a registration</h3>
          <div className="form-row">
            <TextField label="GSTIN" value={gstin} onChange={setGstin} required />
            <TextField label="State code" value={stateCode} onChange={setStateCode} required hint="The two-digit code at the start of the GSTIN, e.g. 07." />
            <TextField label="State name" value={stateName} onChange={setStateName} required />
            <TextField label="Registered from" type="date" value={effectiveFrom} onChange={setEffectiveFrom} required />
          </div>
          <button className="primary" type="submit" disabled={action.busy}>
            Add GST registration
          </button>
        </form>
      </Can>
    </Section>
  );
}

function Warehouses({ rows, registrations, onSaved }: { rows: Location[]; registrations: GstRegistration[]; onSaved: () => void }) {
  const warehouses = rows.filter((l) => l.type === 'WAREHOUSE');
  return (
    <Section title="Warehouse and pickup address">
      <p className="muted" style={{ marginTop: 0 }}>
        Stock is held, packed and handed to couriers here. The GST registration decides the place of supply on invoices.
      </p>
      {warehouses.length === 0 && <Notice kind="warning">No warehouse yet. Add one below.</Notice>}
      {warehouses.map((l) => (
        <WarehouseForm key={l.id} location={l} registrations={registrations} onSaved={onSaved} />
      ))}
      <Can anyOf={['org:manage']}>
        <WarehouseForm location={null} registrations={registrations} onSaved={onSaved} />
      </Can>
    </Section>
  );
}

function WarehouseForm({ location, registrations, onSaved }: { location: Location | null; registrations: GstRegistration[]; onSaved: () => void }) {
  const action = useAction();
  const canTax = useCan('tax:manage');
  const blank = { code: '', name: '', addressLine1: '', addressLine2: '', city: '', state: '', pinCode: '' };
  const fromLocation = (l: Location) => ({ code: l.code, name: l.name, addressLine1: l.addressLine1 ?? '', addressLine2: l.addressLine2 ?? '', city: l.city ?? '', state: l.state ?? '', pinCode: l.pinCode ?? '' });
  const [form, setForm] = useState(location ? fromLocation(location) : blank);
  const [gst, setGst] = useState(location?.gstRegistrationId ?? '');
  const set = (k: keyof typeof blank) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const label = location ? `${location.name} (${location.code})` : 'New warehouse';
  return (
    <form
      className="card"
      aria-label={label}
      onSubmit={async (e) => {
        e.preventDefault();
        const address = {
          name: form.name,
          addressLine1: form.addressLine1,
          addressLine2: form.addressLine2.trim() ? form.addressLine2 : location ? null : undefined,
          city: form.city,
          state: form.state,
          pinCode: form.pinCode,
        };
        const ok = await action.run(async () => {
          const saved = location
            ? await apiSend<Location>('PATCH', `/organization/locations/${location.id}`, address)
            : await apiSend<Location>('POST', '/organization/locations', { ...address, code: form.code, type: 'WAREHOUSE' });
          if (canTax && gst && gst !== (location?.gstRegistrationId ?? '')) {
            await apiSend('POST', `/tax/locations/${saved.id}/gst-registration`, { gstRegistrationId: gst });
          }
        }, location ? 'Warehouse saved.' : 'Warehouse added.');
        if (ok) {
          if (!location) setForm(blank);
          onSaved();
        }
      }}
    >
      <h3>{label}</h3>
      <ActionMessage message={action.message} />
      <div className="form-row">
        {!location && <TextField label="Code" value={form.code} onChange={set('code')} required hint="A short reference, e.g. WH1." />}
        <TextField label="Name" value={form.name} onChange={set('name')} required />
      </div>
      <div className="form-row">
        <TextField label="Address line 1" value={form.addressLine1} onChange={set('addressLine1')} required />
        <TextField label="Address line 2" value={form.addressLine2} onChange={set('addressLine2')} />
      </div>
      <div className="form-row">
        <TextField label="City" value={form.city} onChange={set('city')} required />
        <TextField label="State" value={form.state} onChange={set('state')} required />
        <TextField label="PIN code" value={form.pinCode} onChange={set('pinCode')} required />
      </div>
      {canTax && (
        <SelectField
          label="Ships under GST registration"
          value={gst}
          onChange={setGst}
          placeholder="Choose a registration"
          options={registrations.filter((r) => r.status === 'ACTIVE').map((r) => ({ value: r.id, label: `${r.gstin} · ${r.stateName}` }))}
        />
      )}
      <Can anyOf={['org:manage']}>
        <button className="primary" type="submit" disabled={action.busy}>
          {location ? 'Save warehouse' : 'Add warehouse'}
        </button>
      </Can>
    </form>
  );
}
