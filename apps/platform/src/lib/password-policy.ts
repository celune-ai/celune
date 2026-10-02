/**
 * Password policy — single source of truth for password requirements.
 * Used by signup, reset-password, and profile pages.
 */

export const PASSWORD_MIN_LENGTH = 12;

export interface PasswordCheck {
  label: string;
  met: boolean;
}

export function checkPassword(password: string): PasswordCheck[] {
  return [
    {
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      met: password.length >= PASSWORD_MIN_LENGTH,
    },
    { label: 'Contains uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'Contains lowercase letter', met: /[a-z]/.test(password) },
    { label: 'Contains a number', met: /[0-9]/.test(password) },
  ];
}

export function isPasswordValid(password: string): boolean {
  return checkPassword(password).every((c) => c.met);
}
