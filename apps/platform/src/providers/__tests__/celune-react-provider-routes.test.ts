import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = [
  join(__dirname, '..', 'celune-react-provider.tsx'),
  join(__dirname, '..', '..', 'lib', 'celune-react', 'embed-token.ts'),
]
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

describe('PlatformCeluneProvider routes', () => {
  it('uses the default v1 transport and no custom one', () => {
    expect(source).not.toMatch(/\btransport=/);
    expect(source).not.toContain('platform-transport');
    expect(source).toContain("apiUrl('/api/v1')");
  });

  it('calls no /api route other than v1 and the embed token', () => {
    const paths = [...source.matchAll(/['"`](\/api\/[^'"`?$]*)/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(['/api/v1', '/api/embed/token']).toContain(path);
    }
  });
});
