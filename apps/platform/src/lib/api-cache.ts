import { NextResponse } from 'next/server';

/** Wrap a NextResponse.json() with short-lived cache headers */
export function cachedJson<T>(data: T, maxAge = 30): NextResponse {
  const response = NextResponse.json(data);
  response.headers.set(
    'Cache-Control',
    `private, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`,
  );
  return response;
}
