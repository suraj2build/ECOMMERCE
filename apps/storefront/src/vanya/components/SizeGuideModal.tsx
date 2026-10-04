'use client';

/**
 * The approved AI Studio size guide (Stitch-Spark_Ai_Studio
 * components/SizeGuideModal.tsx), showing the size chart staff attached to the
 * product instead of the prototype's fixed table. "My Size Finder" reads the
 * same chart: it suggests the smallest size whose chest/bust measurement fits.
 * Opened without a product (e.g. from the footer) it says where charts are.
 */
import React, { useRef, useState } from 'react';
import { X, Ruler, Sparkles, CheckCircle2 } from 'lucide-react';
import type { SizeChartData } from '@/lib/api';
import { useModalFocus } from '@/components/layout/useModalFocus';
import { useShop } from '../bridge/shop';

const CM_PER_INCH = 2.54;

interface Column {
  key: string;
  label: string;
  unit: 'in' | 'cm' | null;
}

function columnFor(key: string): Column {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[_\-\s]+/).filter(Boolean).map((w) => w.toLowerCase());
  const last = words[words.length - 1];
  const unit = words.length > 1 && (last === 'in' || last === 'cm') ? last : null;
  if (unit) words.pop();
  const label = words.join(' ');
  return { key, label: label.charAt(0).toUpperCase() + label.slice(1), unit };
}

function convert(value: unknown, from: Column['unit'], to: 'in' | 'cm'): string {
  const text = String(value);
  if (!from || from === to) return text;
  return text.replace(/\d+(\.\d+)?/g, (n) => {
    const converted = from === 'in' ? Number(n) * CM_PER_INCH : Number(n) / CM_PER_INCH;
    return String(Math.round(converted * 2) / 2);
  });
}

/** The largest number in a value ("30-32" -> 32), in inches. */
function inches(value: unknown, unit: Column['unit']): number | null {
  const numbers = String(value).match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
  if (numbers.length === 0) return null;
  const max = Math.max(...numbers);
  return unit === 'cm' ? max / CM_PER_INCH : max;
}

export function SizeGuideModal() {
  const { sizeGuide, closeSizeGuide } = useShop();
  if (!sizeGuide.open) return null;
  return <SizeGuidePanel chart={sizeGuide.product?.sizeChart ?? null} gender={sizeGuide.product?.gender ?? null} onClose={closeSizeGuide} />;
}

function SizeGuidePanel({ chart, gender, onClose }: { chart: SizeChartData | null; gender: string | null; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(true, panelRef, onClose);
  const [activeTab, setActiveTab] = useState<'chart' | 'my-size'>('chart');
  const [unit, setUnit] = useState<'in' | 'cm'>('in');

  const columns: Column[] = [];
  for (const entry of chart?.entries ?? []) {
    for (const key of Object.keys(entry.measurements)) {
      if (!columns.some((c) => c.key === key)) columns.push(columnFor(key));
    }
  }
  const fitColumn = columns.find((c) => /^(chest|bust)$/i.test(c.label));
  const isMen = gender?.toLowerCase() === 'men' || fitColumn?.label.toLowerCase() === 'chest';
  const fitLabel = fitColumn?.label ?? (isMen ? 'Chest' : 'Bust');

  // My Size interactive calculation state
  const [userChest, setUserChest] = useState<number>(isMen ? 40 : 34);
  const [userWaist, setUserWaist] = useState<number>(isMen ? 32 : 28);
  const [userFitPreference, setUserFitPreference] = useState<'fitted' | 'regular' | 'relaxed'>('regular');
  const [recommendedSize, setRecommendedSize] = useState<string | null>(null);
  const [showRecommendation, setShowRecommendation] = useState(false);

  const calculateRecommendedSize = () => {
    const rows = (chart?.entries ?? [])
      .map((entry) => ({ size: entry.sizeLabel, fit: fitColumn ? inches(entry.measurements[fitColumn.key], fitColumn.unit) : null }))
      .filter((row): row is { size: string; fit: number } => row.fit !== null);
    const match = rows.find((row) => row.fit >= userChest);
    setRecommendedSize(match?.size ?? null);
    setShowRecommendation(true);
  };

  return (
    <div
      id="size-guide-backdrop"
      className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6"
    >
      <button type="button" tabIndex={-1} aria-hidden="true" onClick={onClose} className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-xs" />
      <div
        id="size-guide-modal"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="size-guide-title"
        tabIndex={-1}
        className="relative w-full max-w-2xl bg-[#FAF8F5] rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="p-5 border-b border-[#EAE3D7] flex items-center justify-between bg-white/70">
          <div>
            <div className="flex items-center gap-2">
              <Ruler className="w-4 h-4 text-[#A85B3F]" />
              <h3 id="size-guide-title" className="font-editorial text-2xl font-normal text-[#1A1816]">
                Garment Sizing &amp; Fit Guide
              </h3>
            </div>
            <p className="text-xs text-[#756A5E] mt-0.5">
              {chart ? 'Body measurements for this garment' : 'Measured for each garment'}
            </p>
          </div>
          <button
            id="btn-close-size-guide"
            type="button"
            onClick={onClose}
            aria-label="Close size guide"
            className="p-2 text-[#5C5146] hover:text-[#1A1816] rounded-full"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs & Unit Toggle */}
        {chart && (
          <div className="px-5 pt-3 pb-3 border-b border-[#EAE3D7] flex flex-wrap items-center justify-between gap-3 bg-[#F6F2EA]">
            <div className="flex items-center space-x-1.5 bg-white/70 p-1 rounded-full border border-[#E5DFD4]">
              <button
                type="button"
                aria-pressed={activeTab === 'chart'}
                onClick={() => setActiveTab('chart')}
                className={`px-4 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-full transition-colors ${
                  activeTab === 'chart'
                    ? 'bg-[#1A1816] text-[#FAF8F5] shadow-xs'
                    : 'text-[#695F54] hover:text-[#1A1816]'
                }`}
              >
                Measurements Chart
              </button>
              {fitColumn && (
                <button
                  type="button"
                  aria-pressed={activeTab === 'my-size'}
                  onClick={() => setActiveTab('my-size')}
                  className={`px-4 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-full transition-colors flex items-center gap-1.5 ${
                    activeTab === 'my-size'
                      ? 'bg-[#A85B3F] text-white shadow-xs'
                      : 'text-[#A85B3F] hover:bg-[#A85B3F]/10'
                  }`}
                >
                  <Sparkles className="w-3 h-3" />
                  <span>My Size Finder</span>
                </button>
              )}
            </div>

            {activeTab === 'chart' && columns.some((c) => c.unit) && (
              <div className="flex items-center gap-1 bg-white p-0.5 rounded-full border border-[#DCD3C5] text-xs">
                <button
                  type="button"
                  aria-pressed={unit === 'in'}
                  onClick={() => setUnit('in')}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${
                    unit === 'in' ? 'bg-[#1A1816] text-white' : 'text-[#756A5E]'
                  }`}
                >
                  Inches (in)
                </button>
                <button
                  type="button"
                  aria-pressed={unit === 'cm'}
                  onClick={() => setUnit('cm')}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${
                    unit === 'cm' ? 'bg-[#1A1816] text-white' : 'text-[#756A5E]'
                  }`}
                >
                  Centimeters (cm)
                </button>
              </div>
            )}
          </div>
        )}

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-6">
          {!chart ? (
            <p className="text-sm text-[#594E44] bg-white p-5 rounded-2xl border border-[#E3DBCE]">
              Each product page has its own size guide, matched to that garment. Open a product and choose
              &ldquo;Size Guide&rdquo; next to the sizes.
            </p>
          ) : activeTab === 'chart' ? (
            <>
              {/* Measurements Table */}
              <div className="overflow-x-auto border border-[#E3DBCE] rounded-2xl bg-white shadow-xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F2ECE1] text-[#2F2924] font-semibold border-b border-[#E3DBCE] uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="p-3">Brand Size</th>
                      {columns.map((column) => (
                        <th key={column.key} className="p-3">
                          {column.label}{column.unit ? ` (${unit})` : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFE8DC]">
                    {chart.entries.map((row) => (
                      <tr key={row.sizeLabel} className="hover:bg-[#FAF8F5]">
                        <td className="p-3 font-semibold text-[#1A1816]">{row.sizeLabel}</td>
                        {columns.map((column) => (
                          <td key={column.key} className="p-3 text-[#4A423B]">
                            {row.measurements[column.key] === undefined ? '—' : convert(row.measurements[column.key], column.unit, unit)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* How to Measure note */}
              <div className="bg-[#F3ECE1]/70 p-4 rounded-2xl border border-[#E3DBCE] text-xs text-[#594E44] space-y-2">
                <span className="font-semibold uppercase tracking-wider text-[10px] text-[#2F2924] block">
                  How to Measure Accurately
                </span>
                <p>
                  <strong>Bust / Chest:</strong> Measure under arms around the fullest part of your bust/chest while holding the tape level.
                </p>
                <p>
                  <strong>Waist:</strong> Measure around your natural waistline, typically the narrowest point just above the navel.
                </p>
                <p>
                  <strong>Hips:</strong> Stand with feet together and measure around the fullest point of the hips.
                </p>
              </div>
            </>
          ) : (
            <div className="space-y-5 bg-white p-6 rounded-2xl border border-[#E3DBCE] shadow-xs">
              <div className="border-b border-[#EFE8DC] pb-3">
                <span className="text-[10px] uppercase tracking-[0.2em] text-[#A85B3F] font-semibold">
                  Personalized Fit Profile
                </span>
                <h4 className="text-base font-medium text-[#1A1816] mt-0.5">
                  Find Your VANYA True Size
                </h4>
                <p className="text-xs text-[#7A6F64] mt-1">
                  Adjust your measurements below to find your size in this garment&apos;s chart.
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="size-finder-chest" className="block text-xs font-medium text-[#38312B] mb-1">
                    {fitLabel} Circumference (in inches): <span className="font-semibold text-[#1A1816]">{userChest}″</span>
                  </label>
                  <input
                    id="size-finder-chest"
                    type="range"
                    min="30"
                    max="48"
                    value={userChest}
                    onChange={(e) => { setUserChest(Number(e.target.value)); setShowRecommendation(false); }}
                    className="w-full accent-[#A85B3F]"
                  />
                  <div className="flex justify-between text-[10px] text-[#756A5E] mt-1">
                    <span>30″</span>
                    <span>38″</span>
                    <span>48″</span>
                  </div>
                </div>

                <div>
                  <label htmlFor="size-finder-waist" className="block text-xs font-medium text-[#38312B] mb-1">
                    Waist Circumference (in inches): <span className="font-semibold text-[#1A1816]">{userWaist}″</span>
                  </label>
                  <input
                    id="size-finder-waist"
                    type="range"
                    min="24"
                    max="44"
                    value={userWaist}
                    onChange={(e) => setUserWaist(Number(e.target.value))}
                    className="w-full accent-[#A85B3F]"
                  />
                  <div className="flex justify-between text-[10px] text-[#756A5E] mt-1">
                    <span>24″</span>
                    <span>32″</span>
                    <span>44″</span>
                  </div>
                </div>
              </div>

              <div>
                <span className="block text-xs font-medium text-[#38312B] mb-1.5">
                  Preferred Fit Feeling
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {(['fitted', 'regular', 'relaxed'] as const).map((fit) => (
                    <button
                      key={fit}
                      type="button"
                      aria-pressed={userFitPreference === fit}
                      onClick={() => setUserFitPreference(fit)}
                      className={`py-2 px-3 text-xs capitalize rounded-xl border transition-all cursor-pointer ${
                        userFitPreference === fit
                          ? 'border-[#1A1816] bg-[#1A1816] text-[#FAF8F5] font-semibold shadow-xs'
                          : 'border-[#DFD7CB] bg-white text-[#5C534A] hover:border-[#1A1816]'
                      }`}
                    >
                      {fit}
                    </button>
                  ))}
                </div>
              </div>

              <button
                id="btn-calculate-size"
                type="button"
                onClick={calculateRecommendedSize}
                className="w-full py-3 bg-[#A85B3F] hover:bg-[#8F482F] text-white text-xs uppercase tracking-[0.16em] font-semibold transition-all rounded-full shadow-sm cursor-pointer"
              >
                Calculate My Size
              </button>

              {showRecommendation && (
                <div role="status" className="p-4 bg-[#F5EFE4] rounded-2xl border border-[#DFD3C2] flex items-center justify-between">
                  <div>
                    <span className="text-[10px] tracking-wider uppercase text-[#756A5E] font-semibold">
                      Recommendation
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <CheckCircle2 className="w-4 h-4 text-[#3F6A48]" />
                      <span className="text-sm font-semibold text-[#1A1816]">
                        {recommendedSize ? (
                          <>We recommend Size <strong className="text-base text-[#A85B3F]">{recommendedSize}</strong> for you</>
                        ) : (
                          'This garment runs smaller than your measurement'
                        )}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#6E645A] mt-1">
                      Based on {userChest}″ {fitLabel.toLowerCase()} and {userFitPreference} fit profile.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
