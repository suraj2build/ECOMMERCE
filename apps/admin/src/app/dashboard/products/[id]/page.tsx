'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { DataState, Notice, PageHeader, Section, StatusBadge } from '@/components/ui';
import { BasicsForm, formFromStyle } from '@/components/product-workspace/Basics';
import { PhotosStep } from '@/components/product-workspace/Photos';
import { PricingStep, PreviewStep, PublishStep, ReadinessStep } from '@/components/product-workspace/Steps';
import { VariantsStep } from '@/components/product-workspace/Variants';
import { STEPS, type ReferenceData, type Readiness, type Step, type StyleDetail } from '@/components/product-workspace/types';
import { profileFor } from '@/lib/product-profiles';
import { useApi, useCan } from '@/lib/session';

/**
 * Admin Ops Phase 1 product workspace: Basics -> Colours & sizes -> Photos ->
 * Pricing -> Readiness -> Preview -> Publish, for new drafts and existing
 * products alike. The step is in the URL (?step=), so a draft can be left and
 * resumed; without one, the workspace opens at the first unfinished step.
 * Every save goes to the owning domain's route; the server decides.
 */
export default function ProductWorkspace() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const style = useApi<StyleDetail>(`/products/styles/${id}`);
  const readiness = useApi<Readiness>(`/products/styles/${id}/readiness`);
  const reference = useApi<ReferenceData>('/products/reference');
  const canWrite = useCan('product:write');

  const firstOpen = useMemo<Step>(() => {
    const r = readiness.data;
    if (!r) return 'basics';
    for (const s of ['basics', 'variants', 'photos', 'pricing'] as const) if (r.steps[s] === 'incomplete') return s;
    return r.published ? 'readiness' : 'publish';
  }, [readiness.data]);
  const requested = params.get('step') as Step | null;
  const step: Step = requested && STEPS.some((s) => s.key === requested) ? requested : firstOpen;

  const goTo = useCallback(
    (next: Step) => {
      router.replace(`/dashboard/products/${id}?step=${next}`, { scroll: false });
      window.scrollTo({ top: 0 });
    },
    [router, id],
  );
  const reload = useCallback(() => {
    style.reload();
    readiness.reload();
  }, [style, readiness]);

  return (
    <DataState state={style}>
      {(s) => (
        <DataState state={reference}>
          {(ref) => {
            const r = readiness.data;
            const profile = profileFor(r?.productType ?? s.category.productType);
            const stepIndex = STEPS.findIndex((x) => x.key === step);
            const nextStep = STEPS[stepIndex + 1];
            const props = { style: s, readiness: r, reference: ref, onChanged: reload, goTo };
            return (
              <div>
                <PageHeader
                  title={s.name}
                  breadcrumbs={[{ label: 'Merchandise' }, { label: 'Products', href: '/dashboard/products' }, { label: s.styleCode }]}
                  description={
                    <>
                      <span className="mono">{s.styleCode}</span> · {s.category.name} ({profile.label.toLowerCase()}) · <StatusBadge status={s.lifecycleState} />
                      {r && (
                        <>
                          {' '}
                          · {!r.purchasable.ok ? 'Not on sale' : r.stock.availableUnits === 0 ? 'On sale, sold out' : 'Can be bought'} · {r.stock.availableUnits} in stock
                        </>
                      )}
                    </>
                  }
                  actions={
                    <Link href="/dashboard/products/new" className="btn">
                      New product
                    </Link>
                  }
                />
                {params.get('created') === '1' && <Notice kind="success">Draft saved. It stays a draft, visible only here, until you publish it.</Notice>}
                {!canWrite && <Notice kind="info">You can view this product; changing it needs the product editing permission.</Notice>}
                <div className="workspace">
                  <nav className="stepper" aria-label="Product steps">
                    <ol>
                      {STEPS.map((x, i) => {
                        const state = x.key in (r?.steps ?? {}) ? r?.steps[x.key as keyof Readiness['steps']] : x.key === 'publish' && r?.published ? 'complete' : undefined;
                        return (
                          <li key={x.key}>
                            <button
                              type="button"
                              className={`step${x.key === step ? ' current' : ''}${state === 'complete' ? ' done' : state === 'incomplete' ? ' todo' : ''}`}
                              aria-current={x.key === step ? 'step' : undefined}
                              onClick={() => goTo(x.key)}
                            >
                              <span className="step-num" aria-hidden>
                                {state === 'complete' ? '✓' : i + 1}
                              </span>
                              <span>
                                {x.key === 'variants' ? `${profile.colourLabel}s & ${profile.sizeLabel.toLowerCase()}s` : x.label}
                                {state && <span className="sr-only">{state === 'complete' ? ' (done)' : ' (needs attention)'}</span>}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </nav>
                  <div className="workspace-body">
                    {step === 'basics' && (
                      <Section title="Basics">
                        <BasicsForm
                          key={s.id}
                          reference={ref}
                          initial={formFromStyle(s)}
                          styleId={s.id}
                          isNew={false}
                          submitLabel="Save basics"
                          onSaved={() => reload()}
                        />
                      </Section>
                    )}
                    {step === 'variants' && <VariantsStep {...props} />}
                    {step === 'photos' && <PhotosStep {...props} />}
                    {step === 'pricing' && <PricingStep {...props} />}
                    {step === 'readiness' && <ReadinessStep {...props} />}
                    {step === 'preview' && <PreviewStep {...props} />}
                    {step === 'publish' && <PublishStep {...props} />}
                    {nextStep && (
                      <div className="row step-nav">
                        <button type="button" className="btn" onClick={() => goTo(nextStep.key)}>
                          Next: {nextStep.label} →
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          }}
        </DataState>
      )}
    </DataState>
  );
}
