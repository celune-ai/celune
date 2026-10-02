'use client';

import { useState, useEffect, useRef } from 'react';
import { getLastProvider } from '@/lib/auth-helpers';

export function useRateLimit() {
  const [rateLimitSeconds, setRateLimitSeconds] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  function startCountdown(seconds: number) {
    setRateLimitSeconds(seconds);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setRateLimitSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          countdownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  return { rateLimitSeconds, isRateLimited: rateLimitSeconds > 0, startCountdown };
}

export function useLastProvider() {
  const [lastProvider, setLastProvider] = useState<string | null>(null);
  useEffect(() => {
    setLastProvider(getLastProvider());
  }, []);
  return lastProvider;
}

export function RateLimitBanner({ seconds }: { seconds: number }) {
  if (seconds <= 0) return null;
  return (
    <p
      className="rounded-md border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-center text-sm text-yellow-400"
      role="alert"
    >
      Too many attempts. Please try again in {seconds} second{seconds !== 1 ? 's' : ''}.
    </p>
  );
}
