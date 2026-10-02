import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusCard } from '../status-card';

describe('StatusCard', () => {
  it('renders title and status', () => {
    render(
      <StatusCard title="Database" status="ok">
        <p>Connected</p>
      </StatusCard>,
    );

    expect(screen.getByText('Database')).toBeDefined();
    expect(screen.getByText('Ok')).toBeDefined();
    expect(screen.getByText('Connected')).toBeDefined();
  });

  it('renders children content', () => {
    render(
      <StatusCard title="API" status="online">
        <span>Latency: 12ms</span>
        <span>Uptime: 99.9%</span>
      </StatusCard>,
    );

    expect(screen.getByText('Latency: 12ms')).toBeDefined();
    expect(screen.getByText('Uptime: 99.9%')).toBeDefined();
  });

  it('applies emerald color classes for ok status', () => {
    const { container } = render(
      <StatusCard title="Test" status="ok">
        <p>Content</p>
      </StatusCard>,
    );

    const dot = container.querySelector('.bg-emerald-500');
    expect(dot).not.toBeNull();
  });

  it('applies red color classes for error status', () => {
    const { container } = render(
      <StatusCard title="Test" status="error">
        <p>Content</p>
      </StatusCard>,
    );

    const dot = container.querySelector('.bg-red-500');
    expect(dot).not.toBeNull();
  });

  it('applies amber color classes for warning status', () => {
    const { container } = render(
      <StatusCard title="Test" status="warning">
        <p>Content</p>
      </StatusCard>,
    );

    const dot = container.querySelector('.bg-amber-500');
    expect(dot).not.toBeNull();
  });

  it('falls back to warning colors for unknown status', () => {
    const { container } = render(
      <StatusCard title="Test" status="unknown_status">
        <p>Content</p>
      </StatusCard>,
    );

    expect(screen.getByText('Unknown_status')).toBeDefined();
    const dot = container.querySelector('.bg-amber-500');
    expect(dot).not.toBeNull();
  });
});
