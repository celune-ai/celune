'use client';

import { checkPassword } from '@/lib/password-policy';

export function PasswordStrength({
  password,
  confirmPassword,
}: {
  password: string;
  confirmPassword?: string;
}) {
  if (!password) return null;

  const checks = checkPassword(password);
  const passwordsMatch =
    confirmPassword !== undefined && confirmPassword.length > 0 && password === confirmPassword;
  const allChecks = [...checks, { label: 'Passwords match', met: passwordsMatch }];
  const metCount = allChecks.filter((c) => c.met).length;
  const total = allChecks.length;

  return (
    <div className="mt-4 space-y-1.5">
      {/* Strength bar */}
      <div className="flex gap-1">
        {allChecks.map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < metCount
                ? metCount === total
                  ? 'bg-emerald-400'
                  : metCount >= 2
                    ? 'bg-amber-400'
                    : 'bg-red-400'
                : 'bg-white/10'
            }`}
          />
        ))}
      </div>
      {/* Checklist */}
      <ul className="mt-4 space-y-0.5">
        {allChecks.map((c) => (
          <li
            key={c.label}
            className={`text-sm transition-colors ${c.met ? 'text-emerald-400' : 'text-white/70'}`}
          >
            {c.met ? '✓' : '○'} {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
