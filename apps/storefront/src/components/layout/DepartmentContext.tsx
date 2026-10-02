'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type Department = 'men' | 'women';

const STORAGE_KEY = 'vanya_department';

interface DepartmentContextValue {
  department: Department | null;
  hydrated: boolean;
  chooseDepartment: (department: Department) => void;
  clearDepartment: () => void;
}

const DepartmentContext = createContext<DepartmentContextValue | null>(null);

export function DepartmentProvider({ children }: { children: React.ReactNode }) {
  const [department, setDepartment] = useState<Department | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'men' || stored === 'women') setDepartment(stored);
    } catch {
      // Department choice still works when browser storage is blocked.
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = department ?? 'all';
  }, [department]);

  const value = useMemo<DepartmentContextValue>(() => ({
    department,
    hydrated,
    chooseDepartment(next) {
      setDepartment(next);
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Keep the in-memory choice. */ }
    },
    clearDepartment() {
      setDepartment(null);
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* The gateway remains usable. */ }
    },
  }), [department, hydrated]);

  return <DepartmentContext.Provider value={value}>{children}</DepartmentContext.Provider>;
}

export function useDepartment() {
  const value = useContext(DepartmentContext);
  if (!value) throw new Error('useDepartment must be used inside DepartmentProvider');
  return value;
}
