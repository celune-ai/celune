'use client';

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

interface MemoryLayoutState {
  isMemoryMode: boolean;
  activeCategory: string | null;
  setActiveCategory: (cat: string | null) => void;
}

const MemoryLayoutContext = createContext<MemoryLayoutState | null>(null);

export function MemoryLayoutProvider({ children }: { children: ReactNode }) {
  const [activeCategory, setActiveCategoryRaw] = useState<string | null>(null);

  const setActiveCategory = useCallback((cat: string | null) => {
    setActiveCategoryRaw(cat);
  }, []);

  const value = useMemo(
    () => ({ isMemoryMode: true as const, activeCategory, setActiveCategory }),
    [activeCategory, setActiveCategory],
  );

  return <MemoryLayoutContext.Provider value={value}>{children}</MemoryLayoutContext.Provider>;
}

export function useMemoryLayout(): MemoryLayoutState {
  const ctx = useContext(MemoryLayoutContext);
  if (!ctx) {
    return { isMemoryMode: false, activeCategory: null, setActiveCategory: () => {} };
  }
  return ctx;
}
