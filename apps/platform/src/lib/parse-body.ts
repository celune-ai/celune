import { ZodSchema, ZodError } from 'zod';
import { NextResponse } from 'next/server';

export async function parseBody<T>(
  request: Request,
  schema: ZodSchema<T>,
): Promise<T | NextResponse> {
  try {
    const body = await request.json();
    // Coerce JSON-string fields that should be objects (e.g. prd_metadata from Supabase)
    if (body && typeof body === 'object') {
      for (const key of Object.keys(body)) {
        if (typeof body[key] === 'string' && (key.endsWith('_metadata') || key === 'metadata')) {
          try {
            body[key] = JSON.parse(body[key]);
          } catch {
            // leave as string — Zod will catch the type mismatch
          }
        }
      }
    }
    return schema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: error.issues.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

export function isErrorResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}
