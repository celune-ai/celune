'use client';

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

interface PendingHelp {
  /** The user-facing prompt / question label */
  prompt: string;
  /** If set, display this immediately instead of calling the AI */
  staticResponse?: string;
}

interface SupportChatContextValue {
  /** Whether the support chat panel is open */
  open: boolean;
  /** Toggle the chat open/closed */
  toggle: () => void;
  /** Close the chat */
  close: () => void;
  /** Open the chat with a pre-loaded contextual prompt (sent to AI) */
  openWithPrompt: (prompt: string) => void;
  /** Open the chat with a static response (no AI call, zero tokens) */
  openWithStatic: (prompt: string, response: string) => void;
  /** Pending help to inject when chat mounts — consumed once by SupportChat */
  pendingHelp: PendingHelp | null;
  /** Mark the pending help as consumed */
  consumeHelp: () => void;
}

const SupportChatContext = createContext<SupportChatContextValue | null>(null);

export function SupportChatProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pendingHelp, setPendingHelp] = useState<PendingHelp | null>(null);

  const toggle = useCallback(() => setOpen((prev) => !prev), []);
  const close = useCallback(() => setOpen(false), []);

  const openWithPrompt = useCallback((prompt: string) => {
    setPendingHelp({ prompt });
    setOpen(true);
  }, []);

  const openWithStatic = useCallback((prompt: string, response: string) => {
    setPendingHelp({ prompt, staticResponse: response });
    setOpen(true);
  }, []);

  const consumeHelp = useCallback(() => {
    setPendingHelp(null);
  }, []);

  const value = useMemo(
    () => ({ open, toggle, close, openWithPrompt, openWithStatic, pendingHelp, consumeHelp }),
    [open, toggle, close, openWithPrompt, openWithStatic, pendingHelp, consumeHelp],
  );

  return <SupportChatContext.Provider value={value}>{children}</SupportChatContext.Provider>;
}

export function useSupportChat() {
  const ctx = useContext(SupportChatContext);
  if (!ctx) throw new Error('useSupportChat must be used within SupportChatProvider');
  return ctx;
}
