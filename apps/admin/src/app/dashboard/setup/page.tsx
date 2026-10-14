'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DataState, Notice, PageHeader } from '@/components/ui';
import { apiSend } from '@/lib/api';
import { useAction, useApi } from '@/lib/session';

interface Area {
  key: string;
  title: string;
  status: 'configured' | 'incomplete' | 'test_failed' | 'unavailable';
  kind: 'business' | 'deployment' | 'both';
  summary: string;
  missing: string[];
  impact: string;
  next: { label: string; href?: string } | null;
  details: Array<{ label: string; value: string }>;
}

const STATUS_LABEL: Record<Area['status'], string> = {
  configured: 'Configured',
  incomplete: 'Incomplete',
  test_failed: 'Test failed',
  unavailable: 'Unavailable',
};
const STATUS_TONE: Record<Area['status'], string> = { configured: 'success', incomplete: 'warning', test_failed: 'danger', unavailable: 'danger' };
const KIND_LABEL: Record<Area['kind'], string> = {
  business: 'Set in admin',
  deployment: 'Set on the server (environment); never in admin',
  both: 'Partly in admin, partly on the server',
};

/**
 * Setup & health (Admin Ops Phase 1): what is set up, what is missing, what
 * it means for the business and what to do next. Server settings and
 * credentials are shown only as present or missing; a provider is never
 * shown as connected unless a real test says so.
 */
export default function SetupPage() {
  const setup = useApi<{ areas: Area[]; environment: { stage: string; mocksAllowed: boolean } }>('/admin/setup');
  const test = useAction();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  return (
    <div>
      <PageHeader
        title="Setup & health"
        breadcrumbs={[{ label: 'Setup' }, { label: 'Setup & health' }]}
        description="Everything the shop needs to run, in one place. Work through anything marked incomplete or unavailable."
        actions={
          <button type="button" className="btn" onClick={setup.reload}>
            Refresh
          </button>
        }
      />
      <DataState state={setup}>
        {(data) => {
          const open = data.areas.filter((a) => a.status !== 'configured').length;
          return (
            <>
              <Notice kind={open ? 'warning' : 'success'}>
                {open ? `${open} of ${data.areas.length} areas need attention.` : 'Every area is configured.'}{' '}
                {data.environment.mocksAllowed ? 'This is a test or preview environment: test providers are allowed here, and refused in production.' : 'This is production.'}
              </Notice>
              <div className="setup-areas">
                {data.areas.map((a) => (
                  <section key={a.key} className={`setup-area ${a.status}`} aria-label={a.title}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <h2>{a.title}</h2>
                      <span className={`badge ${STATUS_TONE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                    </div>
                    <p style={{ margin: '0.2rem 0' }}>{a.summary}</p>
                    <p className="muted small" style={{ margin: '0.2rem 0' }}>
                      {KIND_LABEL[a.kind]}
                    </p>
                    {a.missing.length > 0 && (
                      <>
                        <strong className="small">Missing</strong>
                        <ul className="issue-list small">
                          {a.missing.map((m) => (
                            <li key={m}>{m}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    <p className="small">
                      <strong>Why it matters:</strong> {a.impact}
                    </p>
                    {a.details.length > 0 && (
                      <details>
                        <summary className="small">Details</summary>
                        <dl className="dl small">
                          {a.details.map((d) => (
                            <div key={d.label} style={{ display: 'contents' }}>
                              <dt>{d.label}</dt>
                              <dd>{d.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    )}
                    {a.key === 'media' ? (
                      <div className="stack">
                        <button
                          type="button"
                          className="btn small"
                          disabled={test.busy}
                          onClick={() =>
                            void test.run(async () => {
                              setResult(await apiSend<{ ok: boolean; message: string }>('POST', '/admin/setup/media-storage/test'));
                            })
                          }
                        >
                          {test.busy ? 'Testing…' : 'Run storage test'}
                        </button>
                        {result && <Notice kind={result.ok ? 'success' : 'error'}>{result.message}</Notice>}
                        {test.message?.kind === 'error' && <Notice kind="error">{test.message.text}</Notice>}
                      </div>
                    ) : (
                      a.next && (
                        <p className="small" style={{ marginBottom: 0 }}>
                          <strong>Next:</strong> {a.next.href ? <Link href={a.next.href}>{a.next.label}</Link> : a.next.label}
                        </p>
                      )
                    )}
                  </section>
                ))}
              </div>
            </>
          );
        }}
      </DataState>
    </div>
  );
}
