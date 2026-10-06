'use client';

import { useState } from 'react';
import { ActionMessage, Checkbox, ConfirmDialog, DataState, DataTable, DateText, Notice, PageHeader, Section, TextField } from '@/components/ui';
import { apiSend } from '@/lib/api';
import { useAction, useApi, useSession } from '@/lib/session';

interface StaffRow {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  isApprovalOwner: boolean;
  roles: string[];
}

interface RoleOption {
  key: string;
  name: string;
  description: string | null;
}

type Dialog = { kind: 'roles' | 'reset' | 'deactivate' | 'reactivate'; person: StaffRow } | null;

/**
 * Staff management (AO-D7, docs/admin/STAFF.md): add people, give them
 * roles, reset a forgotten password and deactivate someone who has left.
 * Temporary passwords are shown here once; the person must choose their
 * own at first sign-in. The server protects the last active Super Admin
 * and the configured approval owners, and ends the person's sessions on
 * a reset, deactivation or role change.
 */
export default function StaffPage() {
  const session = useSession();
  const staff = useApi<StaffRow[]>('/staff');
  const roles = useApi<RoleOption[]>('/staff/roles');
  const action = useAction();
  const dialogAction = useAction();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [newRoles, setNewRoles] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [editRoles, setEditRoles] = useState<string[]>([]);
  // Shown once, right after it is created; never kept anywhere else.
  const [shown, setShown] = useState<{ email: string; password: string; reason: string } | null>(null);

  const roleName = (key: string) => roles.data?.find((r) => r.key === key)?.name ?? key;
  const toggle = (list: string[], key: string, on: boolean) => (on ? [...new Set([...list, key])] : list.filter((k) => k !== key));

  async function addPerson(e: React.FormEvent) {
    e.preventDefault();
    let created: { temporaryPassword: string; email: string } | null = null;
    const ok = await action.run(async () => {
      created = await apiSend<{ temporaryPassword: string; email: string }>('POST', '/staff', { email, fullName, roleKeys: newRoles });
    });
    if (ok && created) {
      const c = created as { temporaryPassword: string; email: string };
      setShown({ email: c.email, password: c.temporaryPassword, reason: `${fullName.trim()} was added.` });
      setEmail('');
      setFullName('');
      setNewRoles([]);
      staff.reload();
    }
  }

  async function confirmDialog() {
    if (!dialog) return;
    const { kind, person } = dialog;
    let reset: { temporaryPassword: string } | null = null;
    const ok = await dialogAction.run(async () => {
      if (kind === 'roles') await apiSend('PUT', `/staff/${person.id}/roles`, { roleKeys: editRoles });
      else if (kind === 'reset') reset = await apiSend<{ temporaryPassword: string }>('POST', `/staff/${person.id}/reset-password`);
      else await apiSend('POST', `/staff/${person.id}/${kind}`);
    });
    if (!ok) return;
    setDialog(null);
    staff.reload();
    if (kind === 'reset' && reset) {
      setShown({ email: person.email, password: (reset as { temporaryPassword: string }).temporaryPassword, reason: `${person.fullName}'s password was reset and they were signed out.` });
    } else {
      setShown(null);
      action.clear();
      const text =
        kind === 'roles'
          ? `${person.fullName}'s roles were changed. They were signed out and see the new roles when they sign in again.`
          : kind === 'deactivate'
            ? `${person.fullName} was deactivated and signed out. They can no longer sign in.`
            : `${person.fullName} was reactivated and can sign in again.`;
      await action.run(async () => undefined, text);
    }
  }

  const dialogTitle = dialog
    ? { roles: `Change roles: ${dialog.person.fullName}`, reset: `Reset password: ${dialog.person.fullName}`, deactivate: `Deactivate ${dialog.person.fullName}`, reactivate: `Reactivate ${dialog.person.fullName}` }[dialog.kind]
    : '';
  const dialogConfirm = dialog ? { roles: 'Save roles', reset: 'Reset password', deactivate: 'Deactivate', reactivate: 'Reactivate' }[dialog.kind] : 'Confirm';

  return (
    <div>
      <PageHeader title="Staff" description="Add people, give them roles, reset a forgotten password and deactivate someone who has left." />

      {shown && (
        <Notice kind="success" reveal={shown}>
          {shown.reason} Give them this temporary password; it is shown only now. They must choose their own when they first sign in.
          <dl style={{ margin: '0.5rem 0 0' }}>
            <dt>Email</dt>
            <dd className="mono">{shown.email}</dd>
            <dt>Temporary password</dt>
            <dd className="mono" aria-label="Temporary password">
              {shown.password}
            </dd>
          </dl>
          <button type="button" className="link-button" onClick={() => setShown(null)}>
            I have passed it on - hide it
          </button>
        </Notice>
      )}
      <ActionMessage message={action.message} />

      <Section title="People">
        <DataState state={staff}>
          {(rows) => (
            <DataTable
              caption="Staff"
              rows={rows}
              rowKey={(r) => r.id}
              columns={[
                {
                  header: 'Name',
                  cell: (r) => (
                    <>
                      {r.fullName}
                      {r.id === session.staffUserId && <span className="muted"> (you)</span>}
                      <div className="muted">{r.email}</div>
                    </>
                  ),
                },
                { header: 'Roles', cell: (r) => r.roles.map(roleName).join(', ') },
                {
                  header: 'Status',
                  cell: (r) => (
                    <>
                      <span className={`badge ${r.isActive ? 'success' : 'neutral'}`}>{r.isActive ? 'Active' : 'Deactivated'}</span>
                      {r.mustChangePassword && r.isActive && <div className="muted">Temporary password not changed yet</div>}
                      {r.isApprovalOwner && <div className="muted">Approval owner</div>}
                    </>
                  ),
                },
                { header: 'Last sign-in', cell: (r) => <DateText value={r.lastSignInAt} withTime /> },
                {
                  header: 'Actions',
                  cell: (r) =>
                    r.id === session.staffUserId ? (
                      <span className="muted">Change your own password from the sidebar</span>
                    ) : (
                      <span className="row">
                        {r.isActive && (
                          <>
                            <button
                              type="button"
                              className="btn small"
                              onClick={() => {
                                dialogAction.clear();
                                setEditRoles(r.roles);
                                setDialog({ kind: 'roles', person: r });
                              }}
                            >
                              Change roles
                            </button>
                            <button type="button" className="btn small" onClick={() => { dialogAction.clear(); setDialog({ kind: 'reset', person: r }); }}>
                              Reset password
                            </button>
                          </>
                        )}
                        <button type="button" className="btn small" onClick={() => { dialogAction.clear(); setDialog({ kind: r.isActive ? 'deactivate' : 'reactivate', person: r }); }}>
                          {r.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </span>
                    ),
                },
              ]}
            />
          )}
        </DataState>
      </Section>

      <Section title="Add a person">
        <form onSubmit={addPerson}>
          <div className="form-row">
            <TextField label="Full name" value={fullName} onChange={setFullName} required />
            <TextField label="Email" type="email" value={email} onChange={setEmail} required />
          </div>
          <fieldset>
            <legend>Roles</legend>
            {(roles.data ?? []).map((r) => (
              <Checkbox key={r.key} label={r.name} checked={newRoles.includes(r.key)} onChange={(on) => setNewRoles((cur) => toggle(cur, r.key, on))} />
            ))}
          </fieldset>
          <button className="primary" type="submit" disabled={action.busy || newRoles.length === 0}>
            Add person
          </button>
          {newRoles.length === 0 && <p className="muted">Choose at least one role.</p>}
        </form>
      </Section>

      <ConfirmDialog
        open={dialog !== null}
        title={dialogTitle}
        confirmLabel={dialogConfirm}
        danger={dialog?.kind === 'deactivate' || dialog?.kind === 'reset'}
        busy={dialogAction.busy}
        confirmDisabled={dialog?.kind === 'roles' && editRoles.length === 0}
        onCancel={() => {
          dialogAction.clear();
          setDialog(null);
        }}
        onConfirm={() => void confirmDialog()}
      >
        {dialog?.kind === 'roles' && (
          <fieldset>
            <legend>Roles</legend>
            {(roles.data ?? []).map((r) => (
              <Checkbox key={r.key} label={r.name} checked={editRoles.includes(r.key)} onChange={(on) => setEditRoles((cur) => toggle(cur, r.key, on))} />
            ))}
            <p className="muted">They are signed out and see the new roles when they sign in again.</p>
          </fieldset>
        )}
        {dialog?.kind === 'reset' && <p>A new temporary password is shown once. {dialog.person.fullName} is signed out everywhere and must choose a new password at the next sign-in.</p>}
        {dialog?.kind === 'deactivate' && <p>{dialog.person.fullName} is signed out everywhere and can no longer sign in. Their history stays. You can reactivate them later.</p>}
        {dialog?.kind === 'reactivate' && <p>{dialog.person.fullName} can sign in again with their existing password.</p>}
        {dialogAction.message?.kind === 'error' && <ActionMessage message={dialogAction.message} />}
      </ConfirmDialog>
    </div>
  );
}
