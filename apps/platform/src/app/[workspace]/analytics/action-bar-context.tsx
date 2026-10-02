'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

const ActionBarContext = createContext<{
  content: ReactNode;
  setContent: (content: ReactNode) => void;
  badge: ReactNode;
  setBadge: (badge: ReactNode) => void;
}>({ content: null, setContent: () => {}, badge: null, setBadge: () => {} });

export function ActionBarProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode>(null);
  const [badge, setBadge] = useState<ReactNode>(null);
  const value = useMemo(() => ({ content, setContent, badge, setBadge }), [content, badge]);
  return <ActionBarContext.Provider value={value}>{children}</ActionBarContext.Provider>;
}

export function useActionBarContent() {
  return useContext(ActionBarContext);
}
