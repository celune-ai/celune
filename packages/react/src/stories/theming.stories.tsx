import type { Meta, StoryObj } from '@storybook/react-vite';
import { useLayoutEffect, useState } from 'react';
import shadcnTheme from '../../.storybook/fixtures/shadcn-theme.css?inline';
import headwaysTheme from '../../.storybook/fixtures/headways-theme.css?inline';
import shadcnMapping from '../../examples/mappings/shadcn.css?inline';
import headwaysMapping from '../../examples/mappings/headways.css?inline';
import type { CeluneAppearance } from '../provider/appearance';
import { ProjectCard } from '../projects';
import { TaskBoard } from '../tasks';
import { CeluneTestProvider, createMockTransport } from '../testing';
import { demoProjects, demoTasks } from './fixtures';

const PRESETS = {
  default: { label: 'Default', dark: false, css: '' },
  dark: { label: 'Dark', dark: true, css: '' },
  shadcn: { label: 'shadcn mapping', dark: false, css: shadcnTheme + shadcnMapping },
  shadcnDark: { label: 'shadcn dark', dark: true, css: shadcnTheme + shadcnMapping },
  headways: { label: 'Headways mapping', dark: false, css: headwaysTheme + headwaysMapping },
  headwaysDark: { label: 'Headways dark', dark: true, css: headwaysTheme + headwaysMapping },
} as const;

type PresetName = keyof typeof PRESETS;

/** Applies the preset the way a host would: theme CSS plus mapping on the page, dark class on <html>. */
function HostPage({ preset }: { preset: PresetName }) {
  const { dark, css } = PRESETS[preset];
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.classList.toggle('dark', dark);
    html.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);
  return css ? <style data-host-preset={preset}>{css}</style> : null;
}

const projectNames = Object.fromEntries(demoProjects.map((p) => [p.id, p.name]));

function Showcase({ initial, appearance }: { initial: PresetName; appearance?: CeluneAppearance }) {
  const [preset, setPreset] = useState<PresetName>(initial);
  const [transport] = useState(() =>
    createMockTransport({ tasks: demoTasks, projects: demoProjects }),
  );
  return (
    <CeluneTestProvider transport={transport} appearance={appearance}>
      <HostPage preset={preset} />
      <div className="flex flex-col gap-5">
        <div role="radiogroup" aria-label="Theme preset" className="flex flex-wrap gap-2">
          {(Object.keys(PRESETS) as PresetName[]).map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={preset === name}
              onClick={() => setPreset(name)}
              className={
                preset === name
                  ? 'rounded-(--celune-radius) border border-(--celune-primary) bg-(--celune-primary) px-3 py-1.5 text-sm text-(--celune-primary-fg)'
                  : 'rounded-(--celune-radius) border border-(--celune-border) bg-(--celune-surface) px-3 py-1.5 text-sm text-(--celune-fg) hover:bg-(--celune-surface-hover)'
              }
            >
              {PRESETS[name].label}
            </button>
          ))}
        </div>
        <div className="grid max-w-3xl grid-cols-2 gap-4">
          {demoProjects.map((p, i) => (
            <ProjectCard key={p.id} project={p} taskCount={8} doneCount={i === 0 ? 5 : 2} />
          ))}
        </div>
        <div className="h-[560px]">
          <TaskBoard initialTasks={demoTasks} projectNames={projectNames} />
        </div>
      </div>
    </CeluneTestProvider>
  );
}

const meta: Meta<typeof Showcase> = {
  title: 'Theming/Switcher',
  component: Showcase,
  parameters: { htmlTheme: 'story' },
};
export default meta;

type Story = StoryObj<typeof Showcase>;

export const Default: Story = { args: { initial: 'default' } };
export const Dark: Story = { args: { initial: 'dark' } };
export const ShadcnMapping: Story = { args: { initial: 'shadcn' } };
export const ShadcnDark: Story = { args: { initial: 'shadcnDark' } };
export const HeadwaysMapping: Story = { args: { initial: 'headways' } };
export const HeadwaysDark: Story = { args: { initial: 'headwaysDark' } };

/** `appearance.variables` over the open defaults: variables win. */
export const Variables: Story = {
  args: {
    initial: 'default',
    appearance: {
      variables: { primary: 'var(--celune-status-planning)', radius: '12px' },
      elements: { projectCard: 'ring-2 ring-(--celune-status-planning)/40' },
    },
  },
};

/** The same variables under the shadcn mapping: the host's unlayered mapping wins. */
export const HostBeatsVariables: Story = {
  args: {
    initial: 'shadcn',
    appearance: { variables: { primary: 'var(--celune-status-planning)', radius: '12px' } },
  },
};
