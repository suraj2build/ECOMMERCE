'use client';

import { useEffect, useState } from 'react';
import { ActionMessage, Can, Checkbox, DataState, DataTable, DateText, Notice, PageHeader, Section, StatusBadge, TextField } from '@/components/ui';
import { apiSend, qs } from '@/lib/api';
import { useAction, useApi, useCan } from '@/lib/session';

interface Policy {
  ownerApprovalEnabled: boolean;
  owners: Array<{ id: string; fullName: string; isActive: boolean }>;
  updatedAt: string | null;
  updatedBy: string | null;
  viewerIsOwner: boolean;
  minReasonLength: number;
}

interface ApprovalLog {
  total: number;
  records: Array<{
    id: string;
    kind: 'PURCHASE_ORDER' | 'STOCK_ADJUSTMENT' | 'RECEIVING_QC' | 'PICK_SHORTFALL';
    entityType: string;
    entityId: string;
    requestedBy: string;
    approvedBy: string;
    selfApproved: boolean;
    reason: string | null;
    createdAt: string;
  }>;
}

const KIND_LABEL: Record<ApprovalLog['records'][number]['kind'], string> = {
  PURCHASE_ORDER: 'Purchase order',
  STOCK_ADJUSTMENT: 'Stock adjustment',
  RECEIVING_QC: 'Receiving QC sign-off',
  PICK_SHORTFALL: 'Pick shortfall',
};

/**
 * Approvals (AO-D4, docs/admin/APPROVALS.md). Purchase orders, large stock
 * adjustments, receiving QC sign-off and large pick shortfalls need a
 * second person. Owner approval lets named owners approve their own work
 * with a reason and their password; everything is listed in the log.
 */
export default function ApprovalsPage() {
  const policy = useApi<Policy>('/approvals/policy');
  const canManage = useCan('org:manage');
  const canLog = useCan('org:manage', 'audit:read');
  const staff = useApi<Array<{ id: string; fullName: string }>>(canManage ? '/approvals/staff' : null);
  const [selfOnly, setSelfOnly] = useState(false);
  const log = useApi<ApprovalLog>(canLog ? `/approvals/records${qs({ selfApproved: selfOnly ? 'true' : undefined })}` : null);
  const action = useAction();
  const [enabled, setEnabled] = useState(false);
  const [owners, setOwners] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');

  useEffect(() => {
    if (!policy.data) return;
    setEnabled(policy.data.ownerApprovalEnabled);
    setOwners(policy.data.owners.map((o) => o.id));
  }, [policy.data]);

  return (
    <div>
      <PageHeader
        title="Approvals"
        breadcrumbs={[{ label: 'Setup' }, { label: 'Approvals' }]}
        description="Who may approve purchase orders, large stock adjustments, receiving QC failures and large pick shortfalls."
      />
      <DataState state={policy}>
        {(p) => (
          <Section title="Approval rule">
            <p style={{ marginTop: 0 }}>
              By default every approval comes from someone other than the person who made the request, and that person must hold the approving
              permission. This stays available whatever you choose below.
            </p>
            <p>
              Owner approval is <strong>{p.ownerApprovalEnabled ? 'on' : 'off'}</strong>
              {p.ownerApprovalEnabled && p.owners.length > 0 && <> for {p.owners.map((o) => o.fullName).join(', ')}</>}.
              {p.updatedBy && (
                <span className="muted">
                  {' '}
                  Last changed by {p.updatedBy}, <DateText value={p.updatedAt} withTime />.
                </span>
              )}
            </p>
            <Can anyOf={['org:manage']}>
              <ActionMessage message={action.message} />
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const ok = await action.run(
                    () => apiSend('PUT', '/approvals/policy', { ownerApprovalEnabled: enabled, ownerStaffIds: owners, confirmation: { password, ...(mfaCode ? { mfaCode } : {}) } }),
                    'Approval rule saved.',
                  );
                  setPassword('');
                  setMfaCode('');
                  if (ok) {
                    policy.reload();
                    log.reload();
                  }
                }}
              >
                <Checkbox label="Turn on owner approval" checked={enabled} onChange={setEnabled} />
                <p className="muted">
                  When on, the owners chosen here may approve their own requests. Each time they must give a reason (at least {p.minReasonLength}{' '}
                  characters) and re-enter their password. Every such approval is marked as a self-approval in the log below.
                </p>
                <fieldset>
                  <legend>Owners</legend>
                  <DataState state={staff}>
                    {(rows) => (
                      <div>
                        {rows.map((s) => (
                          <Checkbox
                            key={s.id}
                            label={s.fullName}
                            checked={owners.includes(s.id)}
                            onChange={(on) => setOwners((cur) => (on ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
                          />
                        ))}
                      </div>
                    )}
                  </DataState>
                </fieldset>
                {enabled && owners.length === 0 && <Notice kind="warning">Choose at least one owner.</Notice>}
                <div className="form-row">
                  <TextField label="Your password, to confirm" type="password" value={password} onChange={setPassword} required autoComplete="current-password" />
                  <TextField label="Authenticator code (if you use one)" value={mfaCode} onChange={setMfaCode} autoComplete="one-time-code" />
                </div>
                <button className="primary" type="submit" disabled={action.busy}>
                  Save approval rule
                </button>
              </form>
            </Can>
          </Section>
        )}
      </DataState>

      {canLog && (
        <Section
          title="Approval log"
          actions={<Checkbox label="Self-approvals only" checked={selfOnly} onChange={setSelfOnly} />}
        >
          <DataState state={log}>
            {(l) => (
              <DataTable
                caption="Approval log"
                rows={l.records}
                rowKey={(r) => r.id}
                empty={selfOnly ? 'No self-approvals.' : 'No approvals yet.'}
                columns={[
                  { header: 'When', cell: (r) => <DateText value={r.createdAt} withTime /> },
                  { header: 'What', cell: (r) => KIND_LABEL[r.kind] },
                  { header: 'Requested by', cell: (r) => r.requestedBy },
                  { header: 'Approved by', cell: (r) => r.approvedBy },
                  { header: 'Type', cell: (r) => <StatusBadge status={r.selfApproved ? 'SELF_APPROVED' : 'INDEPENDENT'} /> },
                  { header: 'Reason', cell: (r) => r.reason ?? '—' },
                ]}
              />
            )}
          </DataState>
        </Section>
      )}
    </div>
  );
}
