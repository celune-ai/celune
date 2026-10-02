import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { CeluneProvider } from '..';
import { ProjectCard } from '../projects';
import { buildAppearanceCss, CELUNE_LAYER_ORDER, CELUNE_VARIABLES } from '../provider/appearance';
import { createMockTransport, makeProject } from '../testing';

const PKG = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(PKG, rel), 'utf8');

/** The 20 base tokens plus 12 status and priority tokens from the PRD token contract. */
const CONTRACT = Object.values(CELUNE_VARIABLES).filter(
  (name) => name !== '--celune-surface-hover' && name !== '--celune-on-status',
);

function renderProvider(appearance?: Parameters<typeof CeluneProvider>[0]['appearance']) {
  return render(
    <CeluneProvider
      apiUrl="http://x/v1"
      token="t"
      workspaceId="ws"
      transport={createMockTransport()}
      pollInterval={0}
      appearance={appearance}
    >
      <ProjectCard project={makeProject({ name: 'Theming' })} />
    </CeluneProvider>,
  );
}

describe('buildAppearanceCss', () => {
  it('writes camelCase variables to --celune-* on :root inside the appearance layer', () => {
    const css = buildAppearanceCss({ primary: 'tomato', radius: '10px', fontFamily: 'Inter' });
    expect(css.startsWith(CELUNE_LAYER_ORDER)).toBe(true);
    expect(css).toContain('@layer celune-appearance {');
    expect(css).toContain(':root {');
    expect(css).toContain('--celune-primary: tomato;');
    expect(css).toContain('--celune-radius: 10px;');
    expect(css).toContain('--celune-font: Inter;');
  });

  it('drops unknown keys and values that could escape the declaration', () => {
    const css = buildAppearanceCss({
      primary: 'red; } body { display: none',
      ring: 'var(--x) /* */',
      // @ts-expect-error unknown key
      nope: 'blue',
      danger: 'crimson',
    });
    expect(css).not.toContain('display');
    expect(css).not.toContain('nope');
    expect(css).not.toContain('--celune-ring');
    expect(css).toContain('--celune-danger: crimson;');
  });

  it('returns an empty string when nothing applies', () => {
    expect(buildAppearanceCss(undefined)).toBe('');
    expect(buildAppearanceCss({})).toBe('');
    expect(buildAppearanceCss({ primary: '   ' })).toBe('');
  });
});

describe('CeluneProvider appearance', () => {
  it('renders no stylesheet and no forced theme with zero props', () => {
    const { container } = renderProvider();
    expect(container.querySelector('style[data-celune-appearance]')).toBeNull();
    const root = container.querySelector('.celune-root');
    expect(root).not.toBeNull();
    expect(root?.hasAttribute('data-celune-theme')).toBe(false);
  });

  it('renders the variables stylesheet and the forced theme base', () => {
    const { container } = renderProvider({ theme: 'dark', variables: { primary: 'tomato' } });
    const style = container.querySelector('style[data-celune-appearance]');
    expect(style?.textContent).toContain('--celune-primary: tomato;');
    expect(container.querySelector('.celune-root')?.getAttribute('data-celune-theme')).toBe('dark');
  });

  it('appends element classes to the part root', () => {
    const { container } = renderProvider({ elements: { projectCard: 'host-card' } });
    expect(container.querySelector('.host-card')).not.toBeNull();
  });
});

describe('precedence contract: host CSS > variables > defaults', () => {
  const layerOrder = /@layer celune-derived, celune-defaults, celune-appearance;/;

  it('declares one layer order everywhere, with appearance above defaults', () => {
    expect(CELUNE_LAYER_ORDER).toMatch(layerOrder);
    expect(read('src/styles/tokens.css')).toMatch(layerOrder);
    expect(read('src/styles/defaults.css')).toMatch(layerOrder);
  });

  it('keeps every default inside the defaults layer', () => {
    const css = read('src/styles/defaults.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const body = css.slice(css.indexOf('@layer celune-defaults {'));
    expect(css.slice(0, css.indexOf('@layer celune-defaults {'))).not.toMatch(/--celune-[a-z-]+:/);
    for (const token of CONTRACT) expect(body).toContain(`${token}:`);
  });

  it('ships host mappings unlayered so they beat both layers', () => {
    for (const file of ['examples/mappings/shadcn.css', 'examples/mappings/headways.css']) {
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css).not.toMatch(/@layer/);
      for (const token of CONTRACT) expect(css, `${file} ${token}`).toContain(`${token}:`);
    }
  });

  it('never reads prefers-color-scheme', () => {
    for (const file of ['src/styles/defaults.css', 'src/styles/tokens.css']) {
      expect(read(file)).not.toContain('prefers-color-scheme');
    }
    expect(read('src/styles/defaults.css')).toContain(":root:is(.dark, [data-theme='dark'])");
  });
});
