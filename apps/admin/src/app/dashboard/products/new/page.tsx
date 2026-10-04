'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { DataState, Notice, PageHeader, Section } from '@/components/ui';
import { BasicsForm } from '@/components/product-workspace/Basics';
import type { ReferenceData } from '@/components/product-workspace/types';
import { useApi } from '@/lib/session';

const DRAFT_KEY = 'fcp_admin_new_product_draft';
const EMPTY = { styleCode: '', name: '', brandId: '', categoryId: '', season: '', collection: '', gender: '' };

function readDraft(): Record<string, string> | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : null;
  } catch {
    return null;
  }
}

/**
 * Step 1 of the product workspace for a new product. What the owner types is
 * kept in this browser until it is saved, so closing the tab or a failed
 * save loses nothing. Saving creates a DRAFT on the server; the rest of the
 * steps continue in the product's workspace.
 */
export default function NewProductPage() {
  const router = useRouter();
  const reference = useApi<ReferenceData>('/products/reference');
  const [initial, setInitial] = useState<Record<string, string> | null>(null);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const draft = readDraft();
    setRestored(Boolean(draft && Object.values(draft).some((v) => v)));
    setInitial({ ...EMPTY, ...(draft ?? {}) });
  }, []);

  const saveDraft = useCallback((form: Record<string, string>) => {
    try {
      if (Object.values(form).some((v) => v)) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } catch {
      // Storage may be unavailable (private window); the form still works.
    }
  }, []);

  return (
    <div style={{ maxWidth: 980 }}>
      <PageHeader
        title="New product"
        description="Start with the basics. Colours, sizes, photos and prices come next; nothing is visible to shoppers until you publish."
        breadcrumbs={[{ label: 'Merchandise' }, { label: 'Products', href: '/dashboard/products' }, { label: 'New product' }]}
      />
      {restored && (
        <Notice kind="info">
          Restored what you typed last time.{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              try {
                window.localStorage.removeItem(DRAFT_KEY);
              } catch {
                /* ignore */
              }
              setRestored(false);
              setInitial({ ...EMPTY });
            }}
          >
            Start again
          </button>
        </Notice>
      )}
      <DataState state={reference}>
        {(ref) =>
          initial && (
            <Section title="Basics">
              <BasicsForm
                key={JSON.stringify(initial)}
                reference={ref}
                initial={initial}
                isNew
                submitLabel="Save draft and continue"
                onDraftChange={saveDraft}
                onSaved={({ id }) => {
                  try {
                    window.localStorage.removeItem(DRAFT_KEY);
                  } catch {
                    /* ignore */
                  }
                  router.push(`/dashboard/products/${id}?step=variants&created=1`);
                }}
              />
            </Section>
          )
        }
      </DataState>
    </div>
  );
}
