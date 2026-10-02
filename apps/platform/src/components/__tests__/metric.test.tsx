import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Metric } from '../metric';

describe('Metric', () => {
  it('renders label and string value', () => {
    render(<Metric label="Latency" value="12ms" />);

    expect(screen.getByText('Latency')).toBeDefined();
    expect(screen.getByText('12ms')).toBeDefined();
  });

  it('renders label and numeric value', () => {
    render(<Metric label="Requests" value={1500} />);

    expect(screen.getByText('Requests')).toBeDefined();
    expect(screen.getByText('1500')).toBeDefined();
  });

  it('renders N/A when value is null', () => {
    render(<Metric label="Memory" value={null} />);

    expect(screen.getByText('Memory')).toBeDefined();
    expect(screen.getByText('N/A')).toBeDefined();
  });

  it('renders N/A when value is undefined', () => {
    render(<Metric label="CPU" value={undefined} />);

    expect(screen.getByText('CPU')).toBeDefined();
    expect(screen.getByText('N/A')).toBeDefined();
  });

  it('renders zero as a valid value', () => {
    render(<Metric label="Errors" value={0} />);

    expect(screen.getByText('Errors')).toBeDefined();
    expect(screen.getByText('0')).toBeDefined();
  });
});
