'use client';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui';
import { apiFetch, errorMessage } from '@/lib/api';
import { API_URL, getStoredSession } from '@/lib/staff-auth';

type Item = { styleId: string; colourId: string };
type Look = {
  model?: string;
  title: string;
  caption: string;
  image: string;
  alt: string;
  items: Item[];
};
type Document = {
  slug: string;
  department: 'women' | 'men';
  title: string;
  intro: string;
  occasion: string;
  model: string;
  cover: string;
  presentation: 'story' | 'book';
  showOnHome: boolean;
  sortOrder: number;
  looks: Look[];
};
type RecordRow = {
  id: string;
  revision: number;
  draft: Document;
  published: Document | null;
  isPublished: boolean;
};
type Product = {
  id: string;
  name: string;
  styleCode: string;
  colours: { id: string; name: string }[];
};
const blankLook = (): Look => ({ title: '', caption: '', image: '', alt: '', items: [] });
const blank = (): Document => ({
  slug: '',
  department: 'women',
  title: '',
  intro: '',
  occasion: 'Everyday',
  model: '',
  cover: '',
  presentation: 'story',
  showOnHome: true,
  sortOrder: 0,
  looks: [blankLook()],
});
const site = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? 'http://localhost:3000';
const imageSource = (url: string) =>
  url.startsWith('/lookbook-media/')
    ? API_URL + '/api/v1/storefront/lookbooks/images/' + url.split('/').at(-1)
    : url.startsWith('/')
      ? site + url
      : url;

export default function LookbooksPage() {
  const [templates, setTemplates] = useState<{ document: Document; missing: string[] }[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [doc, setDoc] = useState<Document>(blank);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [known, setKnown] = useState<Record<string, Product>>({});
  const [query, setQuery] = useState('');
  const [skip, setSkip] = useState(0);
  const [total, setTotal] = useState(0);
  const [picker, setPicker] = useState<number | null>(null);
  const [selected, setSelected] = useState('');
  const [colour, setColour] = useState('');
  const [canManage, setCanManage] = useState(false);
  async function load() {
    setRecords(await apiFetch<RecordRow[]>('/cms/lookbooks'));
  }
  useEffect(() => {
    setCanManage(getStoredSession()?.permissions.includes('cms:manage') ?? false);
    void load().catch((e) => setError(errorMessage(e)));
    void apiFetch<{ document: Document; missing: string[] }[]>('/cms/lookbooks/templates')
      .then(setTemplates)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  useEffect(() => {
    if (picker === null) return;
    let active = true;
    const timer = setTimeout(() => {
      void apiFetch<{ items: Product[]; total: number }>(
        `/cms/lookbooks/products?department=${doc.department}&q=${encodeURIComponent(query)}&skip=${skip}`,
      )
        .then((r) => {
          if (!active) return;
          setProducts(r.items);
          setTotal(r.total);
          setKnown((old) => ({ ...old, ...Object.fromEntries(r.items.map((p) => [p.id, p])) }));
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, skip, doc.department, picker]);
  const linkedKey = [...new Set(doc.looks.flatMap((l) => l.items.map((i) => i.styleId)))]
    .sort()
    .join(',');
  useEffect(() => {
    if (!linkedKey) return;
    let active = true;
    void apiFetch<Product[]>('/cms/lookbooks/products/linked', {
      method: 'POST',
      body: JSON.stringify({ ids: linkedKey.split(',') }),
    })
      .then((items) => {
        if (active)
          setKnown((old) => ({ ...old, ...Object.fromEntries(items.map((p) => [p.id, p])) }));
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [linkedKey]);
  function change(patch: Partial<Document>) {
    setDoc((old) => ({ ...old, ...patch }));
    setDirty(true);
    setNotice('');
  }
  function changeLook(index: number, patch: Partial<Look>) {
    change({ looks: doc.looks.map((look, i) => (i === index ? { ...look, ...patch } : look)) });
  }
  function open(row?: RecordRow) {
    if (dirty && !window.confirm('Discard unsaved lookbook changes?')) return;
    setDoc(row?.draft ?? blank());
    setRevision(row?.revision ?? 0);
    setDirty(false);
    setPicker(null);
    setError('');
    setNotice('');
  }
  async function save(action: 'save' | 'publish' | 'unpublish') {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const row = await apiFetch<RecordRow>('/cms/lookbooks', {
        method: 'POST',
        body: JSON.stringify({
          document:
            action === 'unpublish'
              ? (records.find(
                  (r) => r.draft.department === doc.department && r.draft.slug === doc.slug,
                )?.draft ?? doc)
              : doc,
          expectedRevision: revision,
          action,
        }),
      });
      setDoc(row.draft);
      setRevision(row.revision);
      setDirty(false);
      setNotice(
        action === 'publish'
          ? 'Published. The lookbook is now available on the storefront.'
          : action === 'unpublish'
            ? 'Unpublished. The draft is kept.'
            : 'Draft saved. The currently published edition is unchanged.',
      );
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File | undefined, index?: number) {
    if (!file || busy) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('Choose an image under 5 MiB.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const result = await apiFetch<{ path: string }>('/cms/lookbooks/images', {
        method: 'POST',
        body,
        headers: {},
      });
      if (index === undefined) change({ cover: result.path });
      else changeLook(index, { image: result.path });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function move(index: number, offset: number) {
    const looks = [...doc.looks];
    const target = index + offset;
    if (target < 0 || target >= looks.length) return;
    [looks[index], looks[target]] = [looks[target]!, looks[index]!];
    change({ looks });
    setPicker(null);
  }
  const row = records.find(
    (r) => r.draft.department === doc.department && r.draft.slug === doc.slug,
  );
  return (
    <div>
      <PageHeader
        title="Lookbooks"
        breadcrumbs={[{ label: 'Content' }, { label: 'Lookbooks' }]}
        description="Create photo stories and complete books. Link the exact pictured products, then publish to your shop."
      />
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="card">
          {notice}
        </p>
      )}
      <div className="card" style={{ marginBottom: 20 }}>
        <button type="button" onClick={() => open()} disabled={busy}>
          New lookbook
        </button>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lookbook</th>
                <th>Department</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td>{r.draft.title}</td>
                  <td>{r.draft.department}</td>
                  <td>{r.isPublished ? 'Published' : 'Draft'}</td>
                  <td>
                    <button disabled={busy} onClick={() => open(r)}>
                      Edit {r.draft.title}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!records.length && (
          <p>
            No managed lookbooks yet. Create your first edition below. Existing bundled stories
            remain available.
          </p>
        )}
      </div>
      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Configure an existing edition</h2>
        <p>
          Import the complete book or its stories into this editor. Exact product codes and colours
          are resolved against your published catalogue.
        </p>
        {templates.map((t) => (
          <button
            key={t.document.slug}
            type="button"
            disabled={busy || !canManage}
            onClick={() => {
              const existing = records.find(
                (r) =>
                  r.draft.slug === t.document.slug && r.draft.department === t.document.department,
              );
              if (existing) {
                open(existing);
                return;
              }
              if (dirty && !window.confirm('Discard unsaved lookbook changes?')) return;
              setDoc(t.document);
              setRevision(0);
              setDirty(true);
              setPicker(null);
              setNotice(
                t.missing.length
                  ? 'Import ready. Link missing products before publishing: ' + t.missing.join(', ')
                  : 'Import ready. Review the product links, then save or publish.',
              );
            }}
          >
            Configure {t.document.title}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save('save');
        }}
      >
        <fieldset disabled={busy || !canManage} style={{ border: 0, padding: 0, minWidth: 0 }}>
          <div className="card" style={{ marginBottom: 20 }}>
            <h2>{revision ? 'Edit lookbook' : 'New lookbook'}</h2>
            <p>
              {row?.isPublished
                ? 'Published edition is visible. Save draft leaves it unchanged until you publish.'
                : 'Draft — shoppers cannot see this edition yet.'}
            </p>
            <div className="field">
              <label htmlFor="lb-title">Title</label>
              <input
                id="lb-title"
                required
                maxLength={200}
                value={doc.title}
                onChange={(e) => change({ title: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="lb-slug">URL handle</label>
              <input
                id="lb-slug"
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                readOnly={revision > 0}
                value={doc.slug}
                onChange={(e) => change({ slug: e.target.value })}
              />
              <small>Lowercase words joined with hyphens. Fixed after the first save.</small>
            </div>
            <div className="field">
              <label htmlFor="lb-dept">Department</label>
              <select
                id="lb-dept"
                disabled={revision > 0}
                value={doc.department}
                onChange={(e) => {
                  change({
                    department: e.target.value as Document['department'],
                    looks: doc.looks.map((l) => ({ ...l, items: [] })),
                  });
                  setPicker(null);
                }}
              >
                <option value="women">Women</option>
                <option value="men">Men</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="lb-intro">Story introduction</label>
              <textarea
                id="lb-intro"
                maxLength={3000}
                value={doc.intro}
                onChange={(e) => change({ intro: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="lb-model">Model / chapter</label>
              <input
                id="lb-model"
                required
                value={doc.model}
                onChange={(e) => change({ model: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="lb-occasion">Occasion</label>
              <input
                id="lb-occasion"
                required
                value={doc.occasion}
                onChange={(e) => change({ occasion: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="lb-format">Reading format</label>
              <select
                id="lb-format"
                value={doc.presentation}
                onChange={(e) =>
                  change({ presentation: e.target.value as Document['presentation'] })
                }
              >
                <option value="story">Scrolling story</option>
                <option value="book">Complete book reader</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="lb-cover">Cover image path or HTTPS URL</label>
              <input
                id="lb-cover"
                required
                value={doc.cover}
                onChange={(e) => change({ cover: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="lb-upload">Upload cover image</label>
              <input
                id="lb-upload"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => void upload(e.target.files?.[0])}
              />
            </div>
            {doc.cover && (
              <img
                src={imageSource(doc.cover)}
                alt="Cover preview"
                style={{ maxWidth: 240, maxHeight: 300, objectFit: 'contain' }}
              />
            )}
            <div className="field">
              <label htmlFor="lb-order">Display order</label>
              <input
                id="lb-order"
                type="number"
                min={0}
                max={10000}
                value={doc.sortOrder}
                onChange={(e) => change({ sortOrder: Number(e.target.value) })}
              />
            </div>
            <label>
              <input
                type="checkbox"
                checked={doc.showOnHome}
                onChange={(e) => change({ showOnHome: e.target.checked })}
              />{' '}
              Show on the department homepage
            </label>
          </div>
          {doc.looks.map((look, i) => (
            <section
              key={i}
              className="card"
              style={{ marginBottom: 20 }}
              aria-label={'Look ' + (i + 1)}
            >
              <h2>Look {i + 1}</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)}>
                  Move up
                </button>
                <button
                  type="button"
                  disabled={i === doc.looks.length - 1}
                  onClick={() => move(i, 1)}
                >
                  Move down
                </button>
                <button
                  type="button"
                  disabled={doc.looks.length === 1}
                  onClick={() => {
                    change({ looks: doc.looks.filter((_, n) => n !== i) });
                    setPicker(null);
                  }}
                >
                  Remove look
                </button>
              </div>
              <div className="field">
                <label htmlFor={'look-title-' + i}>Look title</label>
                <input
                  id={'look-title-' + i}
                  required
                  value={look.title}
                  onChange={(e) => changeLook(i, { title: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={'look-model-' + i}>Model / chapter (optional)</label>
                <input
                  id={'look-model-' + i}
                  value={look.model ?? ''}
                  onChange={(e) => changeLook(i, { model: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={'look-caption-' + i}>Caption</label>
                <textarea
                  id={'look-caption-' + i}
                  value={look.caption}
                  onChange={(e) => changeLook(i, { caption: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={'look-image-' + i}>Look image path or HTTPS URL</label>
                <input
                  id={'look-image-' + i}
                  required
                  value={look.image}
                  onChange={(e) => changeLook(i, { image: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={'look-upload-' + i}>Upload look image</label>
                <input
                  id={'look-upload-' + i}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => void upload(e.target.files?.[0], i)}
                />
              </div>
              {look.image && (
                <img
                  src={imageSource(look.image)}
                  alt="Look preview"
                  style={{ maxWidth: 240, maxHeight: 300, objectFit: 'contain' }}
                />
              )}
              <div className="field">
                <label htmlFor={'look-alt-' + i}>Image description</label>
                <input
                  id={'look-alt-' + i}
                  required
                  value={look.alt}
                  onChange={(e) => changeLook(i, { alt: e.target.value })}
                />
              </div>
              <h3>Exact pictured products</h3>
              <p>
                Link every saleable garment in the photograph. Accessories may be styling only.
                Publishing needs at least one product per look.
              </p>
              {look.items.map((item, n) => (
                <p key={item.styleId + item.colourId}>
                  {known[item.styleId]?.name ?? 'Linked product ' + (n + 1)} ·{' '}
                  {known[item.styleId]?.colours.find((c) => c.id === item.colourId)?.name ??
                    item.colourId}{' '}
                  <button
                    type="button"
                    onClick={() => changeLook(i, { items: look.items.filter((_, k) => k !== n) })}
                  >
                    Remove product {n + 1}
                  </button>
                </p>
              ))}
              <button
                type="button"
                disabled={look.items.length >= 8}
                onClick={() => {
                  setPicker(picker === i ? null : i);
                  setSelected('');
                  setColour('');
                  setQuery('');
                  setSkip(0);
                }}
              >
                Link product
              </button>
              {picker === i && (
                <div className="card" style={{ marginTop: 16 }}>
                  <div className="field">
                    <label htmlFor="lb-search">
                      Search published products by name or style code
                    </label>
                    <input
                      id="lb-search"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setSkip(0);
                        setSelected('');
                        setColour('');
                      }}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="lb-product">Product</label>
                    <select
                      id="lb-product"
                      value={selected}
                      onChange={(e) => {
                        setSelected(e.target.value);
                        setColour('');
                      }}
                    >
                      <option value="">Choose a product</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.styleCode} — {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p>{total} matching products</p>
                  <button
                    type="button"
                    disabled={skip === 0}
                    onClick={() => {
                      setSkip(Math.max(0, skip - 30));
                      setSelected('');
                      setColour('');
                    }}
                  >
                    Previous products
                  </button>{' '}
                  <button
                    type="button"
                    disabled={skip + 30 >= total}
                    onClick={() => {
                      setSkip(skip + 30);
                      setSelected('');
                      setColour('');
                    }}
                  >
                    More products
                  </button>
                  <div className="field">
                    <label htmlFor="lb-colour">Exact pictured colour</label>
                    <select
                      id="lb-colour"
                      value={colour}
                      onChange={(e) => setColour(e.target.value)}
                    >
                      <option value="">Choose a colour</option>
                      {known[selected]?.colours.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    disabled={
                      !selected ||
                      !colour ||
                      look.items.some((v) => v.styleId === selected && v.colourId === colour)
                    }
                    onClick={() => {
                      changeLook(i, {
                        items: [...look.items, { styleId: selected, colourId: colour }],
                      });
                      setPicker(null);
                    }}
                  >
                    Add selected product
                  </button>
                </div>
              )}
            </section>
          ))}
          <button
            type="button"
            disabled={doc.looks.length >= 50}
            onClick={() => change({ looks: [...doc.looks, blankLook()] })}
          >
            Add look
          </button>
          <div
            className="card"
            style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 12 }}
          >
            <button className="primary" type="submit">
              {busy ? 'Working…' : 'Save draft'}
            </button>
            <button
              type="button"
              onClick={(event) => {
                if (!event.currentTarget.closest('form')?.reportValidity()) return;
                if (doc.looks.some((l) => !l.items.length))
                  setError('Link an exact product to every look before publishing.');
                else void save('publish');
              }}
            >
              Publish lookbook
            </button>
            <button
              type="button"
              disabled={!row?.isPublished}
              onClick={() => void save('unpublish')}
            >
              Unpublish
            </button>
          </div>
        </fieldset>
      </form>
      {!canManage && <p>You can view lookbooks. Editing requires the CMS manage permission.</p>}
      {row?.isPublished && (
        <a
          href={`${site}/${doc.department}/lookbook/${doc.presentation === 'book' ? 'issues/' : ''}${doc.slug}`}
          target="_blank"
          rel="noreferrer"
        >
          Open published lookbook →
        </a>
      )}
    </div>
  );
}
