import { NextResponse } from 'next/server';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public userMessage: string,
    public internalMessage?: string,
  ) {
    super(userMessage);
  }
}

// Map known error patterns to safe user-facing messages
const ERROR_MAP: Array<{ pattern: RegExp; status: number; message: string }> = [
  { pattern: /duplicate key/i, status: 409, message: 'This resource already exists' },
  { pattern: /foreign key/i, status: 400, message: 'Referenced resource not found' },
  { pattern: /not found/i, status: 404, message: 'Resource not found' },
  { pattern: /permission denied/i, status: 403, message: 'Access denied' },
  { pattern: /violates row-level security/i, status: 403, message: 'Access denied' },
  { pattern: /rate limit/i, status: 429, message: 'Too many requests' },
  { pattern: /invalid.*uuid|uuid.*invalid/i, status: 400, message: 'Invalid identifier format' },
  { pattern: /jwt expired|token.*expired/i, status: 401, message: 'Session expired' },
  { pattern: /unauthorized|not authenticated/i, status: 401, message: 'Authentication required' },
];

export function safeErrorResponse(error: unknown): NextResponse {
  // Log full error server-side for debugging
  console.error('[API Error]', error);

  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.userMessage }, { status: error.statusCode });
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error);

  // Check known error patterns
  for (const { pattern, status, message: safeMsg } of ERROR_MAP) {
    if (pattern.test(message)) {
      return NextResponse.json({ error: safeMsg }, { status });
    }
  }

  // Default: generic 500
  return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
}
