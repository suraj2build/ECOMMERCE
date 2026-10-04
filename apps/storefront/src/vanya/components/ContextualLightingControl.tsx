import React from 'react';
import { Sun, Sunset, Moon, Sparkles, Info } from 'lucide-react';

export type LightingMode = 'daylight' | 'golden' | 'evening' | 'studio';

interface ContextualLightingControlProps {
  currentMode: LightingMode;
  onChangeMode: (mode: LightingMode) => void;
  className?: string;
}

export interface LightingStyleConfig {
  filter: string;
  overlayStyle: React.CSSProperties;
  label: string;
  kelvin: string;
  description: string;
}

export const LIGHTING_CONFIGS: Record<LightingMode, LightingStyleConfig> = {
  studio: {
    label: 'Atelier Studio',
    kelvin: '4200K Neutral',
    description: 'Balanced editorial studio light with high CRI (Color Rendering Index) for standard catalog viewing.',
    filter: 'brightness(1) contrast(1) saturate(1)',
    overlayStyle: {
      background: 'transparent',
    },
  },
  daylight: {
    label: 'Natural Daylight',
    kelvin: '5500K Midday',
    description: 'Crisp outdoor sunlight revealing raw fiber textures, linen slubs, and true-to-life dye tones.',
    filter: 'brightness(1.03) contrast(1.04) saturate(1.05)',
    overlayStyle: {
      background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, transparent 60%)',
      mixBlendMode: 'screen',
    },
  },
  golden: {
    label: 'Golden Hour',
    kelvin: '3200K Sunset',
    description: 'Rich amber sunset glow accentuating fabric texture, hardware finishes, and warm undertones.',
    filter: 'brightness(1.07) contrast(1.06) sepia(0.22) saturate(1.18)',
    overlayStyle: {
      background: 'radial-gradient(ellipse at 85% 15%, rgba(255, 195, 95, 0.35) 0%, rgba(220, 120, 50, 0.15) 50%, transparent 85%)',
      mixBlendMode: 'color-burn',
    },
  },
  evening: {
    label: 'Evening',
    kelvin: '2400K Candlelight',
    description: 'Atmospheric evening lighting with deep dramatic shadows and gleaming highlights.',
    filter: 'brightness(0.92) contrast(1.14) sepia(0.3) saturate(1.12)',
    overlayStyle: {
      background: 'radial-gradient(circle at center, transparent 35%, rgba(24, 14, 8, 0.42) 100%)',
      mixBlendMode: 'multiply',
    },
  },
};

export function ContextualLightingControl({
  currentMode,
  onChangeMode,
  className = '',
}: ContextualLightingControlProps) {
  const currentConfig = LIGHTING_CONFIGS[currentMode];

  return (
    <div
      id="contextual-lighting-control"
      className={`bg-white/95 backdrop-blur-md border border-[#EAE3D7] p-3 rounded-2xl shadow-xs space-y-2 ${className}`}
    >
      <div className="flex items-center justify-between text-xs pb-1 border-b border-[#F2ECE3]">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-[#A65439]" />
          <span className="font-semibold text-[#1A1816] uppercase tracking-wider text-[10px]">
            Contextual Lighting Preview
          </span>
        </div>
        <span className="text-[10px] font-mono text-[#756A5E] bg-[#FAF8F5] px-2 py-0.5 rounded-full border border-[#EFE9DF]">
          {currentConfig.kelvin}
        </span>
      </div>

      {/* Buttons Suite */}
      <div className="grid grid-cols-4 gap-1.5">
        <button
          type="button"
          onClick={() => onChangeMode('daylight')}
          className={`py-1.5 px-2 rounded-xl flex flex-col items-center gap-1 transition-all cursor-pointer ${
            currentMode === 'daylight'
              ? 'bg-[#1A1816] text-[#FAF8F5] shadow-xs'
              : 'bg-[#FAF8F5] hover:bg-[#F2ECE1] text-[#5C5146]'
          }`}
          title="Natural Daylight (5500K)"
        >
          <Sun className="w-3.5 h-3.5 text-[#D4AF37]" />
          <span className="text-[9px] font-medium tracking-tight">Daylight</span>
        </button>

        <button
          type="button"
          onClick={() => onChangeMode('golden')}
          className={`py-1.5 px-2 rounded-xl flex flex-col items-center gap-1 transition-all cursor-pointer ${
            currentMode === 'golden'
              ? 'bg-[#1A1816] text-[#FAF8F5] shadow-xs'
              : 'bg-[#FAF8F5] hover:bg-[#F2ECE1] text-[#5C5146]'
          }`}
          title="Golden Hour Sunset (3200K)"
        >
          <Sunset className="w-3.5 h-3.5 text-[#E58F44]" />
          <span className="text-[9px] font-medium tracking-tight">Golden Hour</span>
        </button>

        <button
          type="button"
          onClick={() => onChangeMode('evening')}
          className={`py-1.5 px-2 rounded-xl flex flex-col items-center gap-1 transition-all cursor-pointer ${
            currentMode === 'evening'
              ? 'bg-[#1A1816] text-[#FAF8F5] shadow-xs'
              : 'bg-[#FAF8F5] hover:bg-[#F2ECE1] text-[#5C5146]'
          }`}
          title="Evening Candlelight (2400K)"
        >
          <Moon className="w-3.5 h-3.5 text-[#A65439]" />
          <span className="text-[9px] font-medium tracking-tight">Evening</span>
        </button>

        <button
          type="button"
          onClick={() => onChangeMode('studio')}
          className={`py-1.5 px-2 rounded-xl flex flex-col items-center gap-1 transition-all cursor-pointer ${
            currentMode === 'studio'
              ? 'bg-[#1A1816] text-[#FAF8F5] shadow-xs'
              : 'bg-[#FAF8F5] hover:bg-[#F2ECE1] text-[#5C5146]'
          }`}
          title="Atelier Studio Strobe (4200K Neutral)"
        >
          <Sparkles className="w-3.5 h-3.5 text-[#756A5E]" />
          <span className="text-[9px] font-medium tracking-tight">Studio</span>
        </button>
      </div>

      <p className="text-[10px] text-[#7A6F64] leading-tight flex items-start gap-1 pt-0.5">
        <Info className="w-3 h-3 text-[#A65439] shrink-0 mt-0.5" />
        <span>{currentConfig.description}</span>
      </p>
    </div>
  );
}
