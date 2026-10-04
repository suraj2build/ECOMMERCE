'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ActionMessage, DataState, DataTable, DateText, Notice, PageHeader, Section } from '@/components/ui';
import { apiSend, errorMessage } from '@/lib/api';
import { downloadText, parseCsv, toCsv } from '@/lib/csv';
import { useAction, useApi, useCan } from '@/lib/session';

/** Import columns (must match the API's IMPORT_COLUMNS) with owner-facing names and guidance. */
const COLUMNS: Array<{ key: string; label: string; help: string; aliases: string[] }> = [
  { key: 'style_code', label: 'Style code', help: 'Required on every row. The product\'s permanent code; rows with the same code are one product.', aliases: ['style', 'stylecode', 'product code', 'article', 'article code'] },
  { key: 'name', label: 'Product name', help: 'Required for a new product.', aliases: ['product name', 'title', 'product'] },
  { key: 'brand', label: 'Brand', help: 'Brand code or name, as set up. Required for a new product.', aliases: ['brand code', 'brand name'] },
  { key: 'category', label: 'Category', help: 'Category name or web address name (e.g. formal-shirts). Required for a new product.', aliases: ['category name', 'category slug'] },
  { key: 'season', label: 'Season', help: 'e.g. SS26. Required for a new product.', aliases: [] },
  { key: 'collection', label: 'Collection', help: 'e.g. Core. Required for a new product.', aliases: [] },
  { key: 'gender', label: 'Department', help: 'Men or Women.', aliases: ['department', 'men/women', 'gender'] },
  { key: 'department', label: 'Department (secondary)', help: 'Optional extra department label.', aliases: [] },
  { key: 'fabric', label: 'Fabric / material', help: 'Clothing fabric, or shoe material.', aliases: ['material', 'fabric'] },
  { key: 'fit', label: 'Fit', help: '', aliases: [] },
  { key: 'pattern', label: 'Pattern', help: '', aliases: [] },
  { key: 'occasion', label: 'Occasion', help: '', aliases: [] },
  { key: 'sleeve', label: 'Sleeve', help: '', aliases: [] },
  { key: 'neck', label: 'Neck', help: '', aliases: ['collar'] },
  { key: 'care', label: 'Care', help: 'Washing or care instructions.', aliases: ['wash care', 'washcare', 'care instructions'] },
  { key: 'country_of_origin', label: 'Country of origin', help: '', aliases: ['origin', 'country'] },
  { key: 'hsn_code', label: 'HSN code', help: 'Digits only.', aliases: ['hsn'] },
  { key: 'subtitle', label: 'Short description', help: 'One line shown under the name.', aliases: ['subtitle', 'short description', 'description'] },
  { key: 'colour_name', label: 'Colour', help: 'Colour name (or scent, for perfume).', aliases: ['color', 'colour', 'color name', 'scent'] },
  { key: 'colour_code', label: 'Colour code', help: 'Optional; made from the colour name when blank. Cannot be changed later.', aliases: ['color code'] },
  { key: 'colour_hex', label: 'Colour swatch', help: 'e.g. #1A2B3C', aliases: ['hex', 'color hex', 'swatch'] },
  { key: 'size', label: 'Size', help: 'A size already set up (S, M, UK8, 32, 50ml…).', aliases: ['size label', 'volume', 'shoe size'] },
  { key: 'sku_code', label: 'SKU code', help: 'Optional for a new size; made automatically when blank. Cannot be changed later.', aliases: ['sku'] },
  { key: 'barcode', label: 'Barcode', help: 'EAN/UPC or your own code; must be unique.', aliases: ['ean', 'upc', 'gtin'] },
  { key: 'mrp', label: 'MRP', help: 'Rupees. Give MRP and selling price together.', aliases: ['mrp (inr)', 'list price'] },
  { key: 'selling_price', label: 'Selling price', help: 'Rupees, not above MRP.', aliases: ['price', 'sale price', 'selling price (inr)'] },
  { key: 'image_url', label: 'Image URL', help: 'A full https:// address. To upload files from your computer, use the product\'s Photos step.', aliases: ['image', 'image link', 'photo url'] },
  { key: 'image_alt', label: 'Image description', help: 'Describes the photo for screen readers.', aliases: ['alt text', 'image alt'] },
];
const STOCK_WORDS = /^(stock|qty|quantity|inventory|on ?hand|available|units)\b/i;
const BATCH_ROWS = 500;

type Row = { row: number; [column: string]: string | number };
interface RowResult {
  row: number;
  styleCode: string;
  outcome: 'create' | 'update' | 'unchanged' | 'error' | 'skipped';
  changes: string[];
  messages: string[];
}
interface Summary {
  rows: number;
  create: number;
  update: number;
  unchanged: number;
  error: number;
  skipped: number;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[_\s]+/g, ' ');
function guessMapping(headers: string[]): Record<number, string> {
  const mapping: Record<number, string> = {};
  const used = new Set<string>();
  headers.forEach((h, i) => {
    const n = norm(h);
    const match = COLUMNS.find((c) => !used.has(c.key) && (norm(c.key) === n || norm(c.label) === n || c.aliases.some((a) => norm(a) === n)));
    if (match && !STOCK_WORDS.test(h)) {
      mapping[i] = match.key;
      used.add(match.key);
    }
  });
  return mapping;
}

/** Rows of one product stay together; products are packed into batches of at most BATCH_ROWS rows. */
function batchRows(rows: Row[]): { batches: Row[][]; oversized: string[] } {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = String(r.style_code ?? '').trim().toUpperCase() || `__row${r.row}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const batches: Row[][] = [];
  const oversized: string[] = [];
  let current: Row[] = [];
  for (const [key, group] of groups) {
    if (group.length > BATCH_ROWS) {
      oversized.push(key);
      continue;
    }
    if (current.length + group.length > BATCH_ROWS) {
      batches.push(current);
      current = [];
    }
    current.push(...group);
  }
  if (current.length) batches.push(current);
  return { batches, oversized };
}

const summarise = (results: RowResult[]): Summary => {
  const c = (o: RowResult['outcome']) => results.filter((r) => r.outcome === o).length;
  return { rows: results.length, create: c('create'), update: c('update'), unchanged: c('unchanged'), error: c('error'), skipped: c('skipped') };
};

type Stage = 'upload' | 'map' | 'check' | 'import' | 'done';

export default function ImportPage() {
  const canPrices = useCan('catalog:price:write');
  const [stage, setStage] = useState<Stage>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [data, setData] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [checked, setChecked] = useState<RowResult[] | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [run, setRun] = useState<{ id: string; batches: Row[][]; done: Record<number, RowResult[]>; failedBatch: number | null } | null>(null);
  const action = useAction();
  const recent = useApi<Array<{ id: string; fileName: string; totalRows: number; totalBatches: number; batchesDone: number; createdAt: string; createdBy: string; summary: Summary }>>('/products/imports');

  const rows: Row[] = useMemo(
    () =>
      data.map((cells, i) => {
        const r: Row = { row: i + 2 };
        for (const [index, key] of Object.entries(mapping)) {
          const value = (cells[Number(index)] ?? '').trim();
          if (key && value) r[key] = value;
        }
        return r;
      }),
    [data, mapping],
  );
  const stockHeaders = headers.filter((h) => STOCK_WORDS.test(h.trim()));
  const mappedKeys = Object.values(mapping).filter(Boolean);
  const duplicateTargets = mappedKeys.filter((k, i) => mappedKeys.indexOf(k) !== i);
  const priceMapped = mappedKeys.includes('mrp') || mappedKeys.includes('selling_price');

  function onFile(file: File | undefined) {
    setProblem(null);
    setChecked(null);
    setRun(null);
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      setProblem('Choose a .csv file. In Excel or Google Sheets use File → Save as / Download → CSV.');
      return;
    }
    if (file.size > 20 * 1048576) {
      setProblem('The file is larger than 20 MB. Split it into smaller files.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result ?? ''));
      if (parsed.length < 2) {
        setProblem('The file needs a header row and at least one product row.');
        return;
      }
      setFileName(file.name);
      setHeaders(parsed[0]!);
      setData(parsed.slice(1));
      setMapping(guessMapping(parsed[0]!));
      setStage('map');
    };
    reader.onerror = () => setProblem('The file could not be read.');
    reader.readAsText(file);
  }

  async function check() {
    const { batches, oversized } = batchRows(rows);
    if (oversized.length) {
      setProblem(`Products with more than ${BATCH_ROWS} rows cannot be imported in one go: ${oversized.join(', ')}.`);
      return;
    }
    const all: RowResult[] = [];
    const ok = await action.run(async () => {
      for (const batch of batches) {
        const res = await apiSend<{ results: RowResult[] }>('POST', '/products/imports/validate', { rows: batch });
        all.push(...res.results);
      }
    });
    if (!ok) return;
    // Barcodes and SKU codes must be unique across the whole file, not just one batch.
    const seen = new Map<string, number>();
    for (const r of rows) {
      for (const key of ['barcode', 'sku_code'] as const) {
        const v = r[key] === undefined ? '' : String(r[key]).trim().toUpperCase();
        if (!v) continue;
        const id = `${key}:${v}`;
        const first = seen.get(id);
        if (first !== undefined) {
          const result = all.find((x) => x.row === r.row);
          if (result && !result.messages.some((m) => m.includes(v))) {
            result.outcome = 'error';
            result.messages.push(`${key === 'barcode' ? 'Barcode' : 'SKU code'} ${v} is also on row ${first}`);
          }
        } else seen.set(id, r.row);
      }
    }
    setChecked(all.sort((a, b) => a.row - b.row));
    setStage('check');
  }

  async function startImport() {
    const { batches } = batchRows(rows);
    const created = await apiSend<{ id: string }>('POST', '/products/imports', { fileName, totalRows: rows.length, totalBatches: batches.length });
    const state = { id: created.id, batches, done: {} as Record<number, RowResult[]>, failedBatch: null as number | null };
    setRun({ ...state });
    setStage('import');
    await continueImport(state);
  }

  async function continueImport(state: NonNullable<typeof run>) {
    for (let i = 0; i < state.batches.length; i += 1) {
      if (state.done[i]) continue;
      try {
        const res = await apiSend<{ results: RowResult[] }>('POST', `/products/imports/${state.id}/batches/${i}`, { rows: state.batches[i] });
        state.done[i] = res.results;
        setRun({ ...state, failedBatch: null });
      } catch (err) {
        setRun({ ...state, failedBatch: i });
        setProblem(`Batch ${i + 1} of ${state.batches.length} did not finish: ${errorMessage(err)}. Products already saved stay saved. Retry continues from this batch; rows already imported are left as they are.`);
        return;
      }
    }
    setProblem(null);
    setStage('done');
    recent.reload();
  }

  function downloadResults(results: RowResult[], name: string, onlyErrors: boolean) {
    const byRow = new Map(rows.map((r) => [r.row, r]));
    const list = onlyErrors ? results.filter((r) => r.outcome === 'error' || r.outcome === 'skipped') : results;
    const keys = COLUMNS.map((c) => c.key);
    downloadText(
      name,
      toCsv([
        ['row', 'outcome', 'problems', 'changes', ...keys],
        ...list.map((r) => [r.row, r.outcome, r.messages.join(' | '), r.changes.join(', '), ...keys.map((k) => byRow.get(r.row)?.[k] ?? '')]),
      ]),
    );
  }

  const checkedSummary = checked ? summarise(checked) : null;
  const importResults = run ? Object.values(run.done).flat().sort((a, b) => a.row - b.row) : [];
  const importSummary = summarise(importResults);

  return (
    <div>
      <PageHeader
        title="Import products"
        description="Add or update many products from a spreadsheet. Nothing is published and no stock changes; new products arrive as drafts."
        breadcrumbs={[{ label: 'Merchandise' }, { label: 'Products', href: '/dashboard/products' }, { label: 'Import' }]}
      />
      <ol className="progress-steps" aria-label="Import steps">
        {(['Template', 'Upload', 'Match columns', 'Check', 'Import', 'Results'] as const).map((label, i) => {
          const at = { upload: 1, map: 2, check: 3, import: 4, done: 5 }[stage];
          return (
            <li key={label} className={i < at ? 'done' : i === at ? 'current' : ''} aria-current={i === at ? 'step' : undefined}>
              {label}
            </li>
          );
        })}
      </ol>
      {problem && <Notice kind="error">{problem}</Notice>}
      <ActionMessage message={action.message} />

      {stage === 'upload' && (
        <div className="grid-2">
          <Section title="1. Get the template">
            <p>One row per colour and size of a product. Rows with the same style code are the same product.</p>
            <button type="button" className="btn" onClick={() => downloadText('product-import-template.csv', toCsv([COLUMNS.map((c) => c.key)]))}>
              Download the template (CSV)
            </button>
            <h3>How the import treats your data</h3>
            <ul>
              <li>An empty cell leaves the current value as it is. Import never clears a value.</li>
              <li>Products are matched by style code, colours by colour code (or name), sizes by size label. Importing the same file twice changes nothing.</li>
              <li>New products are saved as drafts. Nothing is published, and stock is never changed: stock comes from receiving goods.</li>
              <li>A product with a problem in any of its rows is skipped; the others are imported. Fix the problem rows and import again.</li>
              <li>There is no undo. Check the change preview before importing.</li>
            </ul>
          </Section>
          <Section title="2. Upload your file">
            <div className="field">
              <label htmlFor="import-file">CSV file</label>
              <input id="import-file" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
              <span className="hint">From Excel or Google Sheets: File → Download / Save as → CSV.</span>
            </div>
          </Section>
        </div>
      )}

      {stage === 'map' && (
        <Section title={`3. Match your columns (${fileName}, ${data.length} rows)`}>
          {stockHeaders.length > 0 && (
            <Notice kind="info">
              Not imported: {stockHeaders.join(', ')}. Stock is never set by import; it comes from <Link href="/dashboard/receiving">receiving goods</Link>.
            </Notice>
          )}
          {!canPrices && priceMapped && <Notice kind="warning">You do not have permission to set prices; rows with prices will be refused. Choose "Do not import" for the price columns.</Notice>}
          {duplicateTargets.length > 0 && <Notice kind="error">Two columns are matched to {duplicateTargets.join(', ')}. Match each field once.</Notice>}
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Column matching</caption>
              <thead>
                <tr>
                  <th scope="col">Your column</th>
                  <th scope="col">First value</th>
                  <th scope="col">Imports as</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((h, i) => (
                  <tr key={`${h}-${i}`}>
                    <th scope="row">{h || <span className="muted">(no name)</span>}</th>
                    <td className="muted">{data[0]?.[i] ?? ''}</td>
                    <td>
                      {STOCK_WORDS.test(h.trim()) ? (
                        <span className="muted">Not imported (stock)</span>
                      ) : (
                        <select aria-label={`Import ${h} as`} value={mapping[i] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [i]: e.target.value }))}>
                          <option value="">Do not import</option>
                          {COLUMNS.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>What each field means</summary>
            <dl className="dl">
              {COLUMNS.map((c) => (
                <div key={c.key} style={{ display: 'contents' }}>
                  <dt>{c.label}</dt>
                  <dd>{c.help || '—'}</dd>
                </div>
              ))}
            </dl>
          </details>
          <div className="row">
            <button type="button" className="btn" onClick={() => setStage('upload')}>
              Choose another file
            </button>
            <button type="button" className="primary" disabled={action.busy || !mappedKeys.includes('style_code') || duplicateTargets.length > 0} onClick={() => void check()}>
              {action.busy ? 'Checking…' : mappedKeys.includes('style_code') ? 'Check the file (nothing is saved)' : 'Match the style code column first'}
            </button>
          </div>
        </Section>
      )}

      {stage === 'check' && checked && checkedSummary && (
        <Section title="4. Check and preview the changes">
          <SummaryLine summary={checkedSummary} future />
          {checkedSummary.error + checkedSummary.skipped > 0 && (
            <Notice kind="warning">
              {checkedSummary.error} row{checkedSummary.error === 1 ? ' has' : 's have'} a problem and {checkedSummary.skipped} more {checkedSummary.skipped === 1 ? 'is' : 'are'} held back with them. You can import the
              rest now and fix these later, or fix the file and check again.{' '}
              <button type="button" className="link-button" onClick={() => downloadResults(checked, 'import-problems.csv', true)}>
                Download the problem rows
              </button>
            </Notice>
          )}
          <label className="check">
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Show only rows with problems
          </label>
          <ResultTable results={onlyProblems ? checked.filter((r) => r.outcome === 'error' || r.outcome === 'skipped' || r.messages.length) : checked} />
          <div className="row">
            <button type="button" className="btn" onClick={() => setStage('map')}>
              Back to columns
            </button>
            <button type="button" className="primary" disabled={action.busy || checkedSummary.create + checkedSummary.update === 0} onClick={() => void action.run(startImport)}>
              Import {checkedSummary.create + checkedSummary.update} row{checkedSummary.create + checkedSummary.update === 1 ? '' : 's'}
            </button>
          </div>
        </Section>
      )}

      {(stage === 'import' || stage === 'done') && run && (
        <Section title={stage === 'done' ? '6. Results' : '5. Importing'}>
          <progress max={run.batches.length} value={Object.keys(run.done).length} aria-label="Batches imported" />{' '}
          <span>
            {Object.keys(run.done).length} of {run.batches.length} batch{run.batches.length === 1 ? '' : 'es'}
          </span>
          {run.failedBatch !== null && (
            <div className="row">
              <button type="button" className="primary" onClick={() => void action.run(() => continueImport(run))} disabled={action.busy}>
                Retry from batch {run.failedBatch + 1}
              </button>
            </div>
          )}
          <SummaryLine summary={importSummary} />
          <div className="row">
            <button type="button" className="btn" onClick={() => downloadResults(importResults, 'import-results.csv', false)}>
              Download all results
            </button>
            {importSummary.error + importSummary.skipped > 0 && (
              <button type="button" className="btn" onClick={() => downloadResults(importResults, 'import-problems.csv', true)}>
                Download problem rows to fix
              </button>
            )}
            <Link className="btn" href="/dashboard/products?lifecycleState=DRAFT">
              See the drafts
            </Link>
          </div>
          <ResultTable results={importResults.filter((r) => r.outcome !== 'unchanged')} />
        </Section>
      )}

      <Section title="Recent imports">
        <DataState state={recent}>
          {(list) => (
            <DataTable
              caption="Recent imports"
              rows={list}
              rowKey={(r) => r.id}
              empty="No imports yet."
              columns={[
                { header: 'File', cell: (r) => r.fileName },
                { header: 'When', cell: (r) => <DateText value={r.createdAt} withTime /> },
                { header: 'By', cell: (r) => r.createdBy },
                { header: 'Batches', cell: (r) => `${r.batchesDone} of ${r.totalBatches}${r.batchesDone < r.totalBatches ? ' (unfinished)' : ''}` },
                { header: 'Created', numeric: true, cell: (r) => r.summary.create },
                { header: 'Updated', numeric: true, cell: (r) => r.summary.update },
                { header: 'Problems', numeric: true, cell: (r) => r.summary.error + r.summary.skipped },
              ]}
            />
          )}
        </DataState>
      </Section>
    </div>
  );
}

function SummaryLine({ summary, future }: { summary: Summary; future?: boolean }) {
  return (
    <p className="summary-line" role="status">
      <strong>{summary.create}</strong> {future ? 'to create' : 'created'} · <strong>{summary.update}</strong> {future ? 'to update' : 'updated'} · <strong>{summary.unchanged}</strong> unchanged ·{' '}
      <strong>{summary.error}</strong> with problems · <strong>{summary.skipped}</strong> held back
    </p>
  );
}

function ResultTable({ results }: { results: RowResult[] }) {
  return (
    <>
    {results.length > 500 && <p className="muted">Showing the first 500 of {results.length} rows. Download the results for every row.</p>}
    <DataTable
      caption="Rows"
      rows={results.slice(0, 500)}
      rowKey={(r) => String(r.row)}
      empty="No rows to show."
      columns={[
        { header: 'Row', numeric: true, cell: (r) => r.row },
        { header: 'Style code', cell: (r) => <span className="mono">{r.styleCode || '—'}</span> },
        { header: 'Result', cell: (r) => <span className={`badge ${r.outcome === 'error' ? 'danger' : r.outcome === 'skipped' ? 'warning' : r.outcome === 'unchanged' ? 'neutral' : 'success'}`}>{{ create: 'New', update: 'Update', unchanged: 'No change', error: 'Problem', skipped: 'Held back' }[r.outcome]}</span> },
        { header: 'Changes', cell: (r) => r.changes.join(', ') || '—' },
        { header: 'Problems / notes', cell: (r) => r.messages.join(' ') || '—' },
      ]}
    />
    </>
  );
}
