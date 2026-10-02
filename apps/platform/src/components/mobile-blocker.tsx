'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';

const MOBILE_BREAKPOINT = 768;

export function MobileBlocker() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function check() {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    }
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  if (!isMobile) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#0a0a0a] px-8 text-center">
      <Image
        src="/celune-logo-full.svg"
        alt="Celune"
        className="mb-8 h-6 w-auto"
        width={120}
        height={24}
        unoptimized
      />
      <h1 className="text-lg font-semibold text-white">Desktop Only</h1>
      <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/[0.66]">
        Celune is currently only supported on desktop. Mobile views are coming soon.
      </p>
    </div>
  );
}
