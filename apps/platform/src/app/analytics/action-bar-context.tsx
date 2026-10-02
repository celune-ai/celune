'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

const ActionBarContext = createContext<{
  content: ReactNode;
  setContent: (content: ReactNode) => void;
}>({ content: null, setContent: () => {} });

export function ActionBarProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode>(null);
  const value = useMemo(() => ({ content, setContent }), [content]);
  return <ActionBarContext.Provider value={value}>{children}</ActionBarContext.Provider>;
}

export function useActionBarContent() {
  return useContext(ActionBarContext);
}
