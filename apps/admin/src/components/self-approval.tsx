'use client';

import { useState } from 'react';
import { Notice, TextArea, TextField } from '@/components/ui';
import { useApi } from '@/lib/session';

export interface SelfApproval {
  reason: string;
  password: string;
  mfaCode?: string;
}

interface Policy {
  ownerApprovalEnabled: boolean;
  viewerIsOwner: boolean;
  minReasonLength: number;
}

/** Holds the owner-approval inputs for one form. */
export function useSelfApproval() {
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  return {
    value: { reason, password, ...(mfaCode ? { mfaCode } : {}) } as SelfApproval,
    reason,
    setReason,
    password,
    setPassword,
    mfaCode,
    setMfaCode,
    reset: () => {
      setReason('');
      setPassword('');
      setMfaCode('');
    },
  };
}

/**
 * Shown when the signed-in person is about to approve their own action
 * (AO-D4, docs/admin/APPROVALS.md). With owner approval on and the person
 * a named owner, it asks for a reason and their password; otherwise it
 * explains that someone else has to approve. The server enforces both.
 */
export function SelfApprovalFields({ what, state }: { what: string; state: ReturnType<typeof useSelfApproval> }) {
  const policy = useApi<Policy>('/approvals/policy');
  if (!policy.data) return null;
  if (!policy.data.ownerApprovalEnabled || !policy.data.viewerIsOwner) {
    return (
      <Notice kind="warning">
        You are approving your own {what}. That needs someone else, unless an owner turns on owner approval on the Approvals page.
      </Notice>
    );
  }
  return (
    <fieldset className="self-approval">
      <legend>Owner approval: you are approving your own {what}</legend>
      <p className="muted" style={{ marginTop: 0 }}>
        This is recorded in the approval log with your reason. Re-enter your password to confirm.
      </p>
      <TextArea
        label="Reason"
        value={state.reason}
        onChange={state.setReason}
        required
        hint={`At least ${policy.data.minReasonLength} characters, for example why no one else can approve this.`}
      />
      <div className="form-row">
        <TextField label="Your password" type="password" value={state.password} onChange={state.setPassword} required autoComplete="current-password" />
        <TextField label="Authenticator code (if you use one)" value={state.mfaCode} onChange={state.setMfaCode} autoComplete="one-time-code" />
      </div>
    </fieldset>
  );
}
