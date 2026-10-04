'use client';

/**
 * The approved AI Studio app frame (Stitch-Spark_Ai_Studio App.tsx): the
 * department gateway on its own, or the store with its header, footer, bag,
 * quick add, size guide and search overlays. Page content comes from the
 * Next routes; each client navigation gets the design's entrance motion.
 */
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { useDepartment } from '@/components/layout/DepartmentContext';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { BagDrawer } from '../components/BagDrawer';
import { QuickAddModal } from '../components/QuickAddModal';
import { SizeGuideModal } from '../components/SizeGuideModal';
import { SearchModal } from '../components/SearchModal';
import { useShop } from './shop';
import { entrance, markAppHydrated } from './entrance';

export function StoreShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { department, hydrated } = useDepartment();
  const { gender } = useShop();
  useEffect(() => markAppHydrated(), []);

  // Rendered first in both layouts and from the server paint, so a keyboard
  // user's first Tab lands on it even while the home page is still choosing
  // between the gateway and the store.
  const skipLink = (
    <a href="#main-content" className="sr-only-focusable fixed left-2 top-2 z-[120] rounded-full bg-[#181716] px-4 py-2 text-xs text-white">
      Skip to content
    </a>
  );

  if (pathname === '/' && (!hydrated || !department)) {
    return (
      <>
        {skipLink}
        {/* The gateway carries its own <main>; this is only the skip target. */}
        <div id="main-content" tabIndex={-1} className="outline-none">
          {children}
        </div>
        <BagDrawer />
        <SearchModal />
      </>
    );
  }

  return (
    <>
      {skipLink}
      <div
        id="vanya-app-root"
        data-theme={gender}
        className={`min-h-screen flex flex-col font-sans transition-colors duration-500 selection:bg-[#EAE0D2] selection:text-[#1A1816] ${
          gender === 'men' ? 'bg-[#FAF7F2] text-[#241F1A]' : 'bg-[#FAF6FB] text-[#231C26]'
        }`}
      >
        <Header />
        <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col outline-none">
          <motion.div
            key={pathname}
            initial={entrance({ opacity: 0, y: 16 })}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
            className="w-full flex-1 flex flex-col"
          >
            {children}
          </motion.div>
        </main>
        <Footer />
        <BagDrawer />
        <QuickAddModal />
        <SizeGuideModal />
        <SearchModal />
      </div>
    </>
  );
}
