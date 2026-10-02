import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const PKG = join(__dirname, '..', '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'storybook-static', '.turbo']);
const TEXT_FILE = /\.(css|tsx?|mts|cts|mjs|cjs|js|jsx|json|html|md|mdx)$/;

/** The open defaults and the simulated third-party host themes used by Storybook. */
const ALLOW = ['src/styles/defaults.css', '.storybook/fixtures/'];

/** `@source not inline(...)` names literal classes only to keep them out of the build. */
const EXCLUSION_DIRECTIVE = /@source\s+not\s+inline\([\s\S]*?\);/g;
const blankOut = (m: string) => m.replace(/[^\n]/g, ' ');

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGB = /\brgba?\(/g;
const RGB_TRIPLET_TOKEN = /--[a-z0-9-]+-rgb\b/g;

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (TEXT_FILE.test(name)) out.push(p);
  }
  return out;
}

const packageFiles = () => files(PKG).map((f) => ({ file: f, rel: relative(PKG, f) }));
const allowed = (rel: string) => ALLOW.some((a) => rel === a || rel.startsWith(a));

describe('color literals', () => {
  it('detects the literal forms it guards against', () => {
    const [hash, fn, suffix] = ['#', 'rgb', '-rgb'];
    const sample = `bg-[${hash}383A3B] color: '${hash}fff' ${fn}(0 0 0) ${fn}a(1,2,3,.5) --brand${suffix}`;
    expect(sample.match(HEX)).toHaveLength(2);
    expect(sample.match(RGB)).toHaveLength(2);
    expect(sample.match(RGB_TRIPLET_TOKEN)).toHaveLength(1);
  });

  it('finds no raw hex, rgb functions, or triplet tokens anywhere in the package', () => {
    const hits: string[] = [];
    for (const { file, rel } of packageFiles()) {
      if (allowed(rel)) continue;
      const text = readFileSync(file, 'utf8');
      (rel.endsWith('.css') ? text.replace(EXCLUSION_DIRECTIVE, blankOut) : text)
        .split('\n')
        .forEach((line, i) => {
          for (const re of [HEX, RGB, RGB_TRIPLET_TOKEN]) {
            for (const m of line.matchAll(re)) hits.push(`${rel}:${i + 1} ${m[0]}`);
          }
        });
    }
    expect(hits).toEqual([]);
  });

  it('never reads prefers-color-scheme', () => {
    const hits = packageFiles()
      .filter(({ rel }) => !rel.includes('__tests__'))
      .filter(({ file }) => readFileSync(file, 'utf8').includes('prefers-color-scheme'))
      .map(({ rel }) => rel);
    expect(hits).toEqual([]);
  });
});

describe('weights', () => {
  it('maps Leicht 300, Buch 400, Kräftig 500 with strong at 500', () => {
    const css = readFileSync(join(PKG, 'src/styles/tokens.css'), 'utf8');
    expect(css).toContain('--celune-font-weight-light: 300;');
    expect(css).toContain('--celune-font-weight-regular: 400;');
    expect(css).toContain('--celune-font-weight-strong: 500;');
  });

  it('styles components through weight tokens, never a fixed 600', () => {
    const fixed = /(?<![\w/-])font-(semibold|medium|normal|light|bold)(?![\w-])|fontWeight:\s*\d/;
    const hits = packageFiles()
      .filter(({ rel }) => rel.startsWith('src/') && rel.endsWith('.tsx'))
      .filter(({ rel }) => !rel.includes('__tests__'))
      .filter(({ file }) => fixed.test(readFileSync(file, 'utf8')))
      .map(({ rel }) => rel);
    expect(hits).toEqual([]);
  });
});

/**
 * Tailwind emits these itself and no source can remove them: minified `transparent`, the
 * ring-offset default color, and the relative-color feature probe in @supports.
 */
const HASH = '#';
const TAILWIND_INTERNALS = [
  new RegExp(`${HASH}0000\\b`, 'g'),
  new RegExp(`--tw-ring-offset-color:${HASH}fff\\b`, 'g'),
  new RegExp(`initial-value:${HASH}fff\\b`, 'g'),
  new RegExp(`color:${'rgb'}\\(from red r g b\\)`, 'g'),
];

/** Removes the `celune-defaults` layer, which is defaults.css inlined into styles.css. */
function withoutDefaultsLayer(css: string): string {
  const open = '@layer celune-defaults{';
  const start = css.indexOf(open);
  if (start === -1) return css;
  let i = start + open.length;
  for (let depth = 1; depth > 0; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
  }
  return css.slice(0, start) + css.slice(i);
}

function compile(entry: string): string {
  const out = join(mkdtempSync(join(tmpdir(), 'celune-css-')), 'out.css');
  execFileSync(join(PKG, 'node_modules/.bin/tailwindcss'), ['-i', entry, '-o', out, '--minify'], {
    cwd: PKG,
    stdio: 'ignore',
  });
  return readFileSync(out, 'utf8');
}

describe('built CSS', () => {
  it.each([
    ['components.css', 'src/styles/components.css'],
    ['styles.css', 'src/styles.css'],
  ])(
    '%s holds no color literals outside the defaults layer',
    (_name, entry) => {
      let css = withoutDefaultsLayer(compile(entry));
      for (const re of TAILWIND_INTERNALS) css = css.replace(re, '');
      const hits = [...css.matchAll(/.{0,40}(#[0-9a-fA-F]{3,8}\b|\brgba?\().{0,20}/g)].map(
        (m) => m[0],
      );
      expect(hits).toEqual([]);
    },
    60_000,
  );

  it('keeps every literal in styles.css inside the defaults layer', () => {
    const css = compile('src/styles.css');
    expect(css).toContain('@layer celune-defaults{');
    expect(compile('src/styles/components.css')).not.toContain('@layer celune-defaults{');
  }, 60_000);
});
