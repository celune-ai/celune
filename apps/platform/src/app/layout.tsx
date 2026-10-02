import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import { AdminLayout } from '@/components/admin-layout';
import { MobileBlocker } from '@/components/mobile-blocker';
import { WindowsNotice } from '@/components/windows-notice';
import { hostConfig } from '@/lib/host-config';
import './globals.css';

export const metadata: Metadata = {
  title: hostConfig.productName,
  description: 'Your second brain for work',
  icons: { icon: '/favicon.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background font-sans antialiased">
        <MobileBlocker />
        <WindowsNotice />
        <AdminLayout>{children}</AdminLayout>
        <Toaster
          position="bottom-left"
          theme="dark"
          richColors
          duration={5000}
          style={{ left: 264 }}
        />
      </body>
    </html>
  );
}
