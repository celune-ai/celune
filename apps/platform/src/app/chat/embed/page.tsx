'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { SupportChat } from '@repo/ui/components/support-chat';
import { URL_APP, URL_DOCS, URL_MARKETING, DOMAIN_MARKETING } from '@/lib/branding';

function EmbedChatInner() {
  const params = useSearchParams();
  const context = (params.get('context') ?? 'web') as 'web' | 'docs' | 'app';
  const position = (params.get('position') ?? 'bottom-right') as 'bottom-right' | 'bottom-left';
  // Parent origin for secure postMessage — whitelist only trusted domains.
  // Never accept arbitrary origins from URL params (postMessage injection risk).
  const ALLOWED_ORIGINS = [URL_APP, URL_DOCS, URL_MARKETING, `https://www.${DOMAIN_MARKETING}`];
  const rawOrigin =
    params.get('origin') ??
    (typeof document !== 'undefined'
      ? document.referrer.replace(/^(https?:\/\/[^/]+).*/, '$1')
      : '');
  const parentOrigin =
    ALLOWED_ORIGINS.includes(rawOrigin) ||
    rawOrigin.endsWith(`.${DOMAIN_MARKETING}`) ||
    rawOrigin.startsWith('http://localhost:')
      ? rawOrigin
      : '';

  return (
    <SupportChat
      apiUrl={`${URL_APP}/api/chat/support`}
      context={context}
      position={position}
      defaultOpen
      onNavigate={(path) => {
        if (parentOrigin && window.parent !== window) {
          window.parent.postMessage({ type: 'celune:navigate', path }, parentOrigin);
        }
      }}
    />
  );
}

export default function EmbedChatPage() {
  return (
    <div className="h-screen w-screen bg-transparent">
      <Suspense>
        <EmbedChatInner />
      </Suspense>
    </div>
  );
}
