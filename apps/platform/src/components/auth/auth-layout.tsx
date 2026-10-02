import { type ReactNode } from 'react';
import { Shield } from 'lucide-react';
import { AsciiWaves } from './ascii-waves';
import { CeluneLogo, CeluneLogomark } from './celune-logos';
import { URL_DOCS, URL_MARKETING } from '@/lib/branding';

export function AuthLayout({
  children,
  showLogomark = false,
}: {
  children: ReactNode;
  showLogomark?: boolean;
}) {
  return (
    <div className="relative flex min-h-screen flex-col bg-black">
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.35]">
        <AsciiWaves />
      </div>

      <nav className="relative z-10 flex items-center justify-between px-4 py-4 md:px-8 md:py-5">
        <a href={URL_MARKETING} className="flex items-center gap-2 md:gap-3">
          <CeluneLogo className="h-5 w-auto md:h-7" />
        </a>
        <a
          href={URL_DOCS}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-white/20 px-3 py-1.5 text-[13px] text-white transition-colors hover:border-white/30"
        >
          Docs
        </a>
      </nav>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4">
        {showLogomark && <CeluneLogomark className="mb-8 h-[72px] w-auto" />}
        <div className="flex w-full max-w-[534px] flex-col items-center rounded-xl border border-white/[0.03] bg-black/50 px-12 py-20 shadow-2xl shadow-black/50 backdrop-blur-sm">
          {children}
        </div>
        <div className="mt-6 flex items-center gap-2 text-white/80">
          <Shield className="h-3.5 w-3.5" />
          <span className="text-xs">SOC 2 Type II compliant</span>
          <span className="text-white/40">|</span>
          <span className="text-xs">AES-256 encryption</span>
          <span className="text-white/40">|</span>
          <span className="text-xs">GDPR ready</span>
        </div>
      </div>

      <div className="relative z-10 pb-6" />
    </div>
  );
}
