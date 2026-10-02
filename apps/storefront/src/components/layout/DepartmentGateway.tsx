'use client';

import Image from 'next/image';
import { useDepartment, type Department } from './DepartmentContext';

function DepartmentPanel({
  department,
  imageUrl,
  title,
  subtitle,
  line,
}: {
  department: Department;
  imageUrl: string | null;
  title: string;
  subtitle: string;
  line: string;
}) {
  const { chooseDepartment } = useDepartment();
  return (
    <button
      type="button"
      onClick={() => chooseDepartment(department)}
      className="group relative flex min-h-[50svh] flex-1 items-end overflow-hidden border-white/10 p-8 text-left text-white lg:min-h-screen lg:p-14"
      aria-label={`Enter ${title} store`}
    >
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt=""
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-cover object-top transition-transform duration-1000 ease-out group-hover:scale-[1.035]"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[#2c2723] to-[#0e0c0b]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/20" />
      <div className="relative z-10 max-w-lg">
        <h2 className="font-display text-5xl font-normal uppercase leading-none tracking-[0.14em] sm:text-6xl lg:text-7xl">{title}</h2>
        <span className="mt-3 block text-[11px] font-light uppercase tracking-[0.24em] text-[#ede4d5] sm:text-[13px]">{subtitle}</span>
        <div className="my-4 h-px w-48 bg-white/45 sm:w-56" />
        <p className="mb-6 text-sm font-light text-[#ddd4c7] sm:text-base">{line}</p>
        <span className="inline-flex items-center gap-3 rounded-full border border-white/80 bg-black/25 px-8 py-3.5 text-xs font-medium uppercase tracking-[0.22em] backdrop-blur-sm transition-all duration-300 group-hover:bg-white group-hover:text-black">
          Enter {title} <span aria-hidden>&rarr;</span>
        </span>
      </div>
    </button>
  );
}

export function DepartmentGateway({
  menImageUrl,
  womenImageUrl,
}: {
  menImageUrl: string | null;
  womenImageUrl: string | null;
}) {
  const { department, hydrated } = useDepartment();
  if (!hydrated || department) return null;

  return (
    <div className="fixed inset-0 z-[100] flex min-h-screen flex-col overflow-y-auto bg-[#0e0c0b] text-white lg:overflow-hidden">
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-6 py-5 sm:px-12 sm:py-6">
        <span className="hidden w-1/3 text-[10px] uppercase tracking-[0.28em] text-white/80 sm:block">NEW DELHI · INDIA</span>
        <div className="w-full text-center sm:w-1/3">
          <h1 className="font-display text-3xl uppercase leading-none tracking-[0.30em] text-white sm:text-4xl">VANYA</h1>
          <p className="mt-2 text-[9px] uppercase tracking-[0.22em] text-[#ddd3c5]">Indian roots · modern form</p>
        </div>
        <span className="hidden w-1/3 sm:block" aria-hidden />
      </header>

      <main className="flex flex-1 flex-col lg:flex-row">
        <DepartmentPanel department="men" imageUrl={menImageUrl} title="MEN" subtitle="Modern Indian Menswear" line="Tradition in a modern world." />
        <DepartmentPanel department="women" imageUrl={womenImageUrl} title="WOMEN" subtitle="Modern Indian Womenswear" line="Timeless tradition, for today." />
      </main>

      <footer className="relative z-20 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 border-t border-white/10 bg-[#0d0b0a] px-6 py-3.5 text-center text-[9px] font-light uppercase tracking-[0.20em] text-[#d8cfbf] sm:text-[10px]">
        <span>✦ New season</span>
        <span>✦ Festive 2026</span>
        <span>Delivery across India</span>
        <span>Easy returns</span>
      </footer>
    </div>
  );
}
