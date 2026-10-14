'use client';

import { useRef, useState } from 'react';
import { ActionMessage, Can, ConfirmDialog, Notice, Section } from '@/components/ui';
import { apiSend, apiUpload, errorMessage } from '@/lib/api';
import { checkImageFile, displayImageUrl, IMAGE_ACCEPT, MAX_IMAGE_MB } from '@/lib/media';
import { useAction, useCan } from '@/lib/session';
import { profileFor } from '@/lib/product-profiles';
import type { StepProps, StyleDetail } from './types';

type Media = StyleDetail['media'][number];

/**
 * Photos: upload from the computer (several at once, or drag and drop),
 * choose the listing photo, assign each photo to a colour or to all colours,
 * order them, and replace or remove one. A replacement is saved before the
 * old photo is swapped out, so a failed upload never loses the current one.
 */
export function PhotosStep({ style, readiness, onChanged }: StepProps) {
  const profile = profileFor(readiness?.productType ?? style.category.productType);
  const canWrite = useCan('product:write');
  const action = useAction();
  const [colourForUpload, setColourForUpload] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number; failed: string[] } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState<Media | null>(null);
  const [alt, setAlt] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const media = [...style.media].sort((a, b) => a.sortOrder - b.sortOrder);
  const coverId = readiness?.coverMediaId ?? null;

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    const failed: string[] = [];
    setProgress({ done: 0, total: files.length, failed });
    for (const [i, file] of files.entries()) {
      const problem = checkImageFile(file);
      if (problem) failed.push(problem);
      else {
        try {
          await apiUpload('POST', `/products/styles/${style.id}/media/upload`, file, {
            ...(colourForUpload ? { colourId: colourForUpload } : {}),
            altText: `${style.name}${colourForUpload ? ` - ${style.colours.find((c) => c.id === colourForUpload)?.name ?? ''}` : ''}`,
          });
        } catch (err) {
          failed.push(`${file.name}: ${errorMessage(err)}`);
        }
      }
      setProgress({ done: i + 1, total: files.length, failed: [...failed] });
    }
    onChanged();
  }

  async function move(index: number, delta: -1 | 1) {
    const order = media.map((m) => m.id);
    const [item] = order.splice(index, 1);
    order.splice(index + delta, 0, item!);
    if (await action.run(() => apiSend('POST', `/products/styles/${style.id}/media/order`, { mediaIds: order }))) onChanged();
  }

  return (
    <div className="stack">
      <Section title="Upload photos">
        <Can anyOf={['product:write']}>
          <div
            className={`dropzone${dragging ? ' active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void uploadFiles([...e.dataTransfer.files]);
            }}
          >
            <p style={{ margin: 0 }}>
              Drag photos here, or{' '}
              <button type="button" className="link-button" onClick={() => fileInput.current?.click()}>
                choose files from your computer
              </button>
              . JPEG, PNG or WebP, up to {MAX_IMAGE_MB} MB each.
            </p>
            <input
              ref={fileInput}
              type="file"
              accept={IMAGE_ACCEPT}
              multiple
              className="sr-only"
              aria-label="Choose photos to upload"
              onChange={(e) => {
                void uploadFiles([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
            <div className="field" style={{ marginTop: '0.75rem', maxWidth: 320 }}>
              <label htmlFor="upload-colour">New photos show for</label>
              <select id="upload-colour" value={colourForUpload} onChange={(e) => setColourForUpload(e.target.value)}>
                <option value="">All {profile.colourLabel.toLowerCase()}s</option>
                {style.colours.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} only
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Can>
        {progress && (
          <Notice kind={progress.failed.length ? 'warning' : progress.done === progress.total ? 'success' : 'info'}>
            {progress.done < progress.total ? `Uploading ${progress.done + 1} of ${progress.total}…` : `${progress.total - progress.failed.length} of ${progress.total} uploaded.`}
            {progress.failed.length > 0 && (
              <>
                {' '}
                Not uploaded: {progress.failed.join('; ')}
              </>
            )}
          </Notice>
        )}
      </Section>

      <Section title={`Photos (${media.length})`}>
        <ActionMessage message={action.message} />
        {media.length === 0 ? (
          <p className="muted">No photos yet. A product needs at least one photo to be published.</p>
        ) : (
          <ul className="photo-grid" aria-label="Product photos in display order">
            {media.map((m, index) => {
              const src = displayImageUrl(m.url);
              const isCover = m.id === coverId;
              return (
                <li key={m.id} className={`photo-card${isCover ? ' cover' : ''}`}>
                  <div className="photo-frame">
                    {src && m.type === 'IMAGE' ? (
                      <img src={src} alt={m.altText ?? ''} loading="lazy" />
                    ) : (
                      <span className="muted">{m.type === 'VIDEO' ? 'Video' : 'No preview'}</span>
                    )}
                    {isCover && <span className="badge success photo-flag">Listing photo</span>}
                  </div>
                  <div className="photo-meta">
                    <span className="muted small">
                      {index + 1}. {m.colourId ? style.colours.find((c) => c.id === m.colourId)?.name : `All ${profile.colourLabel.toLowerCase()}s`}
                      {m.byteSize ? ` · ${m.byteSize < 1024 ? 'under 1 KB' : `${Math.round(m.byteSize / 1024)} KB`}` : ''}
                    </span>
                    {canWrite && (
                      <>
                        <label className="sr-only" htmlFor={`colour-${m.id}`}>
                          Show photo {index + 1} for
                        </label>
                        <select
                          id={`colour-${m.id}`}
                          value={m.colourId ?? ''}
                          onChange={async (e) => {
                            if (await action.run(() => apiSend('PATCH', `/products/media/${m.id}`, { colourId: e.target.value || null }), 'Photo colour saved.')) onChanged();
                          }}
                        >
                          <option value="">All {profile.colourLabel.toLowerCase()}s</option>
                          {style.colours.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <form
                          className="row"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (await action.run(() => apiSend('PATCH', `/products/media/${m.id}`, { altText: alt[m.id] ?? '' }), 'Description saved.')) onChanged();
                          }}
                        >
                          <label className="sr-only" htmlFor={`alt-${m.id}`}>
                            Description of photo {index + 1}
                          </label>
                          <input
                            id={`alt-${m.id}`}
                            className="input compact"
                            placeholder="Describe the photo"
                            value={alt[m.id] ?? m.altText ?? ''}
                            onChange={(e) => setAlt((a) => ({ ...a, [m.id]: e.target.value }))}
                          />
                          {(alt[m.id] ?? m.altText ?? '') !== (m.altText ?? '') && (
                            <button type="submit" className="btn small">
                              Save
                            </button>
                          )}
                        </form>
                        <div className="row photo-actions">
                          <button type="button" className="btn small" aria-label={`Move photo ${index + 1} earlier`} disabled={index === 0 || action.busy} onClick={() => void move(index, -1)}>
                            ←
                          </button>
                          <button type="button" className="btn small" aria-label={`Move photo ${index + 1} later`} disabled={index === media.length - 1 || action.busy} onClick={() => void move(index, 1)}>
                            →
                          </button>
                          {!isCover && m.type === 'IMAGE' && (
                            <button
                              type="button"
                              className="btn small"
                              disabled={action.busy}
                              onClick={async () => {
                                if (await action.run(() => apiSend('POST', `/products/media/${m.id}/cover`), 'Listing photo set.')) onChanged();
                              }}
                            >
                              Use as listing photo
                            </button>
                          )}
                          <ReplaceButton mediaId={m.id} index={index} disabled={action.busy || m.type !== 'IMAGE'} onDone={onChanged} />
                          <button type="button" className="btn small danger" disabled={action.busy} onClick={() => setRemoving(m)}>
                            Remove
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <ConfirmDialog
          open={removing !== null}
          title="Remove this photo?"
          confirmLabel="Remove photo"
          danger
          busy={action.busy}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const ok = await action.run(() => apiSend('DELETE', `/products/media/${removing!.id}`), 'Photo removed.');
            setRemoving(null);
            if (ok) onChanged();
          }}
        >
          <p>It stops showing on the storefront. A published product must keep at least one photo; to swap a photo use Replace instead.</p>
        </ConfirmDialog>
      </Section>
    </div>
  );
}

function ReplaceButton({ mediaId, index, disabled, onDone }: { mediaId: string; index: number; disabled: boolean; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const action = useAction();
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <>
      <button type="button" className="btn small" disabled={disabled || action.busy} onClick={() => input.current?.click()}>
        {action.busy ? 'Replacing…' : 'Replace'}
      </button>
      <input
        ref={input}
        type="file"
        accept={IMAGE_ACCEPT}
        className="sr-only"
        aria-label={`Choose a replacement for photo ${index + 1}`}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const found = checkImageFile(file);
          setProblem(found);
          if (found) return;
          if (await action.run(() => apiUpload('PUT', `/products/media/${mediaId}/file`, file), 'Photo replaced.')) onDone();
        }}
      />
      {(problem ?? (action.message?.kind === 'error' ? action.message.text : null)) && (
        <span className="field-error" role="alert">
          {problem ?? action.message?.text}
        </span>
      )}
      {!problem && action.message?.kind === 'success' && (
        <span className="small" role="status">
          {action.message.text}
        </span>
      )}
    </>
  );
}
