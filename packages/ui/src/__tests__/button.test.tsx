import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Button } from '../components/button';

describe('Button', () => {
  it('renders with text content', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Submit</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled when the disabled prop is set', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole('button', { name: 'Disabled' })).toBeDisabled();
  });

  it('does not call onClick when disabled', () => {
    const handleClick = vi.fn();
    render(
      <Button disabled onClick={handleClick}>
        Disabled
      </Button>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Disabled' }));
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('renders as a child element when asChild is true', () => {
    render(
      <Button asChild>
        <a href="/home">Go home</a>
      </Button>,
    );
    // Should render as an anchor, not a button
    expect(screen.getByRole('link', { name: 'Go home' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('applies variant class names', () => {
    render(<Button variant="destructive">Delete</Button>);
    const btn = screen.getByRole('button', { name: 'Delete' });
    // cva applies the destructive class tokens
    expect(btn.className).toContain('bg-destructive');
  });

  it('applies size class names', () => {
    render(<Button size="lg">Large</Button>);
    const btn = screen.getByRole('button', { name: 'Large' });
    expect(btn.className).toContain('h-10');
  });

  it('forwards additional HTML attributes', () => {
    render(
      <Button data-testid="my-btn" type="submit">
        Submit
      </Button>,
    );
    const btn = screen.getByTestId('my-btn');
    expect(btn).toHaveAttribute('type', 'submit');
  });

  it('merges custom className with variant classes', () => {
    render(<Button className="my-custom-class">Styled</Button>);
    const btn = screen.getByRole('button', { name: 'Styled' });
    expect(btn.className).toContain('my-custom-class');
  });

  it('has the correct displayName', () => {
    expect(Button.displayName).toBe('Button');
  });
});
