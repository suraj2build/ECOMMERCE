'use client';

import { useRef, useState } from 'react';
import { apiUpload, errorMessage } from '@/lib/api';
import { checkImageFile, displayImageUrl, IMAGE_ACCEPT, MAX_IMAGE_MB } from '@/lib/media';
import { useApi, useCan } from '@/lib/session';

interface Asset {
  id: string;
  url: string;
  altText: string | null;
}

/**
 * Choose an image for a banner or page: upload one from the computer, pick
 * one uploaded earlier, or paste an https address. Shows what is chosen.
 */
export function ImagePicker({ label, value, onChange }: { label: string; value: string; onChange: (url: string) => void }) {
  const canUpload = useCan('cms:manage');
  const assets = useApi<Asset[]>('/cms/assets');
  const [mode, setMode] = useState<'library' | 'url'>('library');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const preview = displayImageUrl(value);

  async function upload(file: File | undefined) {
    if (!file) return;
    const found = checkImageFile(file);
    setProblem(found);
    if (found) return;
    setBusy(true);
    try {
      const asset = await apiUpload<Asset>('POST', '/cms/assets', file, { altText: file.name.replace(/\.[a-z]+$/i, '') });
      assets.reload();
      onChange(asset.url);
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="fieldset">
      <legend>{label}</legend>
      <div className="row" style={{ alignItems: 'flex-start', gap: '1rem' }}>
        <div className="photo-frame" style={{ width: '9rem' }}>
          {preview ? (
            <img src={preview} alt="Chosen for this banner or page" />
          ) : (
            <span className="muted small">No image chosen</span>
          )}
        </div>
        <div className="stack" style={{ flex: 1 }}>
          <div className="row">
            {canUpload && (
              <>
                <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>
                  {busy ? 'Uploading…' : 'Upload from computer'}
                </button>
                <input ref={input} type="file" accept={IMAGE_ACCEPT} className="sr-only" aria-label={`Upload ${label}`} onChange={(e) => void upload(e.target.files?.[0])} />
              </>
            )}
            <button type="button" className="link-button" onClick={() => setMode(mode === 'library' ? 'url' : 'library')}>
              {mode === 'library' ? 'Use a web address instead' : 'Choose from uploaded images'}
            </button>
          </div>
          <span className="hint muted small">JPEG, PNG or WebP up to {MAX_IMAGE_MB} MB.</span>
          {problem && (
            <span className="field-error" role="alert">
              {problem}
            </span>
          )}
          {mode === 'url' ? (
            <div className="field">
              <label htmlFor={`url-${label}`}>Image address</label>
              <input id={`url-${label}`} value={value} placeholder="https://… or /placeholders/…" onChange={(e) => onChange(e.target.value)} />
            </div>
          ) : (
            <div className="picker-grid" role="group" aria-label="Uploaded images">
              {(assets.data ?? []).map((a) => (
                <button key={a.id} type="button" aria-pressed={a.url === value} onClick={() => onChange(a.url)} title={a.altText ?? ''}>
                  <img src={displayImageUrl(a.url) ?? ''} alt={a.altText ?? "Uploaded"} />
                </button>
              ))}
              {assets.data && assets.data.length === 0 && <span className="muted small">No images uploaded yet.</span>}
            </div>
          )}
        </div>
      </div>
    </fieldset>
  );
}
