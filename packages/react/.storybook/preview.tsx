import type { Decorator, Preview } from '@storybook/react-vite';
import { useLayoutEffect } from 'react';
import { Toaster } from 'sonner';
import '../src/styles.css';
import './preview.css';

type Mode = 'light' | 'dark';

/**
 * Dark mode lives on <html>, the same signal a host sets. Stories pin it with
 * `parameters.htmlTheme`, or pass 'story' to manage <html> themselves.
 */
function HtmlTheme({ mode }: { mode: Mode }) {
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.classList.toggle('dark', mode === 'dark');
    html.setAttribute('data-theme', mode);
  }, [mode]);
  return null;
}

const withHtmlTheme: Decorator = (Story, context) => {
  const pinned = context.parameters.htmlTheme as Mode | 'story' | undefined;
  const mode: Mode = pinned === 'story' ? 'light' : (pinned ?? context.globals.theme ?? 'dark');
  return (
    <div className="min-h-screen bg-(--celune-bg) p-6 font-(family-name:--celune-font) text-(--celune-fg)">
      {pinned !== 'story' && <HtmlTheme mode={mode} />}
      <Story />
      <Toaster theme={mode} position="bottom-left" />
    </div>
  );
};

const preview: Preview = {
  decorators: [withHtmlTheme],
  globalTypes: {
    theme: {
      description: 'Dark mode on <html>',
      toolbar: { icon: 'mirror', items: ['light', 'dark'], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'dark' },
  parameters: { layout: 'fullscreen' },
};

export default preview;
