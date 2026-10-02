import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageActionBar } from '../page-action-bar';

describe('PageActionBar', () => {
  it('renders children', () => {
    render(
      <PageActionBar>
        <button>Save</button>
        <button>Cancel</button>
      </PageActionBar>,
    );

    expect(screen.getByText('Save')).toBeDefined();
    expect(screen.getByText('Cancel')).toBeDefined();
  });

  it('renders with no children', () => {
    const { container } = render(<PageActionBar />);

    expect(container.firstChild).toBeDefined();
  });

  it('applies sticky positioning classes', () => {
    const { container } = render(
      <PageActionBar>
        <span>Content</span>
      </PageActionBar>,
    );

    const bar = container.firstChild as HTMLElement;
    expect(bar.className).toContain('sticky');
    expect(bar.className).toContain('top-0');
    expect(bar.className).toContain('z-10');
  });

  it('merges custom className', () => {
    const { container } = render(
      <PageActionBar className="custom-class">
        <span>Content</span>
      </PageActionBar>,
    );

    const bar = container.firstChild as HTMLElement;
    expect(bar.className).toContain('custom-class');
    expect(bar.className).toContain('sticky');
  });
});
