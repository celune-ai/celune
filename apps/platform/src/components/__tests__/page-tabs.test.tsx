import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PageTabs } from '../page-tabs';
import type { PageTab } from '../page-tabs';

const tabs: PageTab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'details', label: 'Details' },
  { id: 'settings', label: 'Settings' },
];

describe('PageTabs', () => {
  it('renders all tab labels', () => {
    render(<PageTabs tabs={tabs} active="overview" onChange={() => {}} />);

    expect(screen.getByText('Overview')).toBeDefined();
    expect(screen.getByText('Details')).toBeDefined();
    expect(screen.getByText('Settings')).toBeDefined();
  });

  it('calls onChange with tab id when clicked', () => {
    const onChange = vi.fn();
    render(<PageTabs tabs={tabs} active="overview" onChange={onChange} />);

    fireEvent.click(screen.getByText('Details'));
    expect(onChange).toHaveBeenCalledWith('details');
  });

  it('calls onChange for each distinct tab click', () => {
    const onChange = vi.fn();
    render(<PageTabs tabs={tabs} active="overview" onChange={onChange} />);

    fireEvent.click(screen.getByText('Details'));
    fireEvent.click(screen.getByText('Settings'));

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledWith('details');
    expect(onChange).toHaveBeenCalledWith('settings');
  });

  it('applies active styling to the selected tab', () => {
    const { container } = render(<PageTabs tabs={tabs} active="details" onChange={() => {}} />);

    const buttons = container.querySelectorAll('button');
    const detailsBtn = Array.from(buttons).find((b) => b.textContent === 'Details');
    // Active tab has text-foreground styling; the brand indicator is now a
    // Framer Motion layoutId child element instead of a border class.
    expect(detailsBtn?.className).toContain('text-foreground');
  });

  it('applies inactive styling to non-selected tabs', () => {
    const { container } = render(<PageTabs tabs={tabs} active="details" onChange={() => {}} />);

    const buttons = container.querySelectorAll('button');
    const overviewBtn = Array.from(buttons).find((b) => b.textContent === 'Overview');
    expect(overviewBtn?.className).toContain('border-transparent');
  });

  it('renders with the Tabs aria label', () => {
    const { container } = render(<PageTabs tabs={tabs} active="overview" onChange={() => {}} />);

    const nav = container.querySelector('nav[aria-label="Tabs"]');
    expect(nav).not.toBeNull();
  });
});
