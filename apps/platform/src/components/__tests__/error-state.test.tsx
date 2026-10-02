import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorState } from '../error-state';

describe('ErrorState', () => {
  it('renders default error message', () => {
    render(<ErrorState />);

    expect(screen.getByText('Failed to load')).toBeDefined();
    expect(screen.getByText('Something went wrong. Please try again.')).toBeDefined();
  });

  it('renders custom error message', () => {
    render(<ErrorState message="Network timeout" />);

    expect(screen.getByText('Network timeout')).toBeDefined();
  });

  it('renders retry button when onRetry is provided', () => {
    render(<ErrorState onRetry={() => {}} />);

    expect(screen.getByText('Retry')).toBeDefined();
  });

  it('does not render retry button when onRetry is not provided', () => {
    render(<ErrorState />);

    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('calls onRetry when retry button is clicked', () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);

    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
