'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { hasStoredDepartment, useDepartment, type StoreDepartment } from '@/components/layout/DepartmentProvider';

const MEN_IMAGE =
  'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1800&q=85';
const WOMEN_IMAGE =
  'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1800&q=85';

export function VanyaGateway() {
  const { setDepartment, ready } = useDepartment();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (ready) setVisible(!hasStoredDepartment());
  }, [ready]);

  if (!ready || !visible) return null;

  function choose(department: StoreDepartment) {
    setDepartment(department);
    setVisible(false);
  }

  return (
    <div className="fixed inset-0 z-[100] flex min-h-[640px] flex-col overflow-hidden bg-[#0e0c0b] text-white">
      <header className="absolute inset-x-0 top-0 z-30 flex items-start justify-between px-5 py-5 sm:px-10 sm:py-7">
        <div className="hidden w-1/3 pt-1 text-[10px] font-light uppercase tracking-[0.26em] text-white/80 sm:block">
          New Delhi · India
        </div>
        <div className="w-full text-center sm:w-1/3">
          <p className="font-display text-3xl uppercase tracking-[0.28em] sm:text-4xl">VANYA</p>
          <p className="mt-1 text-[8px] uppercase tracking-[0.24em] text-[#ddd3c5] sm:text-[9px]">
            — Indian roots · modern form —
          </p>
        </div>
        <div className="hidden w-1/3 items-center justify-end gap-4 pt-1 text-[10px] uppercase tracking-[0.18em] text-white/80 sm:flex">
          <Link href="/search" className="hover:text-white">Search</Link>
          <Link href="/account" className="hover:text-white">Account</Link>
          <Link href="/bag" className="hover:text-white">Bag</Link>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <GatewayPanel
          department="men"
          image={MEN_IMAGE}
          title="MEN"
          subtitle="Modern Indian Menswear"
          copy="Tradition in a modern world."
          cta="Enter Men"
          onChoose={choose}
        />
        <GatewayPanel
          department="women"
          image={WOMEN_IMAGE}
          title="WOMEN"
          subtitle="Modern Indian Womenswear"
          copy="Timeless tradition, for today."
          cta="Enter Women"
          onChoose={choose}
        />
      </main>

      <footer className="relative z-20 grid grid-cols-2 gap-y-2 border-t border-white/10 bg-[#0d0b0a] px-5 py-3 text-center text-[9px] uppercase tracking-[0.18em] text-[#d8cfbf] sm:flex sm:items-center sm:justify-center sm:gap-10 sm:text-[10px]">
        <span>✦ New season</span>
        <span>✦ Festive 2026</span>
        <span>Complimentary shipping</span>
        <span>Easy returns</span>
      </footer>
    </div>
  );
}

function GatewayPanel({
  department,
  image,
  title,
  subtitle,
  copy,
  cta,
  onChoose,
}: {
  department: StoreDepartment;
  image: string;
  title: string;
  subtitle: string;
  copy: string;
  cta: string;
  onChoose: (department: StoreDepartment) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChoose(department)}
      className="group relative flex min-h-[50vh] flex-1 items-end overflow-hidden border-white/10 text-left lg:min-h-0 lg:w-1/2 lg:border-r"
      aria-label={`Enter ${title.toLowerCase()} store`}
    >
      <img
        src={image}
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-top brightness-[.82] transition-transform duration-1000 ease-out group-hover:scale-[1.035]"
      />
      <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/20" />
      <span className="relative z-10 block max-w-lg p-7 sm:p-12 lg:p-16">
        <span className="block font-display text-5xl uppercase leading-none tracking-[0.12em] sm:text-6xl lg:text-7xl">
          {title}
        </span>
        <span className="mt-3 block text-[11px] font-light uppercase tracking-[0.22em] text-[#ede4d5] sm:text-xs">
          {subtitle}
        </span>
        <span className="my-3 block h-px w-48 bg-white/40" />
        <span className="block text-sm font-light text-[#ddd4c7]">{copy}</span>
        <span className="mt-6 inline-flex items-center gap-3 rounded-full border border-white/80 bg-black/20 px-7 py-3 text-[10px] font-medium uppercase tracking-[0.2em] transition-colors duration-300 group-hover:bg-white group-hover:text-black sm:text-xs">
          {cta} <span aria-hidden>→</span>
        </span>
      </span>
    </button>
  );
}
