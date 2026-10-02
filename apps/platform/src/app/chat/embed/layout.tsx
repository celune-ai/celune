import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Celune Support Chat',
  robots: 'noindex, nofollow',
};

export default function EmbedChatLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
