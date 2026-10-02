'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type StoreDepartment = 'men' | 'women';

type DepartmentContextValue = {
  department: StoreDepartment;
  ready: boolean;
  setDepartment: (department: StoreDepartment) => void;
};

const STORAGE_KEY = 'vanya_department';
const DepartmentContext = createContext<DepartmentContextValue | null>(null);

export function DepartmentProvider({ children }: { children: React.ReactNode }) {
  const [department, setDepartmentState] = useState<StoreDepartment>('women');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'men' || stored === 'women') setDepartmentState(stored);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = department;
  }, [department]);

  function setDepartment(next: StoreDepartment) {
    setDepartmentState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable in hardened/private browsing contexts.
    }
  }

  const value = useMemo(() => ({ department, ready, setDepartment }), [department, ready]);
  return <DepartmentContext.Provider value={value}>{children}</DepartmentContext.Provider>;
}

export function useDepartment() {
  const context = useContext(DepartmentContext);
  if (!context) throw new Error('useDepartment must be used inside DepartmentProvider');
  return context;
}

export function hasStoredDepartment(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'men' || stored === 'women';
  } catch {
    return false;
  }
}
