import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { AddTaskRow } from '../tasks/add-task-row';
import { createMockTransport, type MockTransport } from '../testing';
import { renderWithCelune } from './utils';

let transport: MockTransport;
let createSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  transport = createMockTransport();
  createSpy = vi.spyOn(transport.tasks, 'create');
});

const render = (ui: React.ReactElement) => renderWithCelune(ui, { transport });

describe('AddTaskRow', () => {
  it('renders add task button in default state', () => {
    render(<AddTaskRow status="inbox" />);
    expect(screen.getByText('Add task...')).toBeDefined();
  });

  it('shows input when add button is clicked', () => {
    render(<AddTaskRow status="inbox" />);
    fireEvent.click(screen.getByText('Add task...'));
    expect(screen.getByPlaceholderText('Task name...')).toBeDefined();
  });

  it('submits task on Enter', async () => {
    render(<AddTaskRow status="inbox" />);
    fireEvent.click(screen.getByText('Add task...'));

    const input = screen.getByPlaceholderText('Task name...');
    fireEvent.change(input, { target: { value: 'New task title' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith({ title: 'New task title', status: 'inbox' });
    });
  });

  it('includes projectId in request when provided', async () => {
    render(<AddTaskRow status="in_progress" projectId="proj-123" />);
    fireEvent.click(screen.getByText('Add task...'));

    const input = screen.getByPlaceholderText('Task name...');
    fireEvent.change(input, { target: { value: 'Project task' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith({
        title: 'Project task',
        status: 'in_progress',
        project_id: 'proj-123',
      });
    });
  });

  it('cancels editing on Escape', () => {
    render(<AddTaskRow status="inbox" />);
    fireEvent.click(screen.getByText('Add task...'));

    const input = screen.getByPlaceholderText('Task name...');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByPlaceholderText('Task name...')).toBeNull();
    expect(screen.getByText('Add task...')).toBeDefined();
  });

  it('does not submit empty titles', async () => {
    render(<AddTaskRow status="inbox" />);
    fireEvent.click(screen.getByText('Add task...'));

    const input = screen.getByPlaceholderText('Task name...');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(createSpy).not.toHaveBeenCalled();
  });

  it('does not submit whitespace-only titles', async () => {
    render(<AddTaskRow status="inbox" />);
    fireEvent.click(screen.getByText('Add task...'));

    const input = screen.getByPlaceholderText('Task name...');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(createSpy).not.toHaveBeenCalled();
  });

  it('clears input after successful submit for chain-creation', async () => {
    render(<AddTaskRow status="inbox" />);
    fireEvent.click(screen.getByText('Add task...'));

    const input = screen.getByPlaceholderText('Task name...');
    fireEvent.change(input, { target: { value: 'First task' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect((screen.getByPlaceholderText('Task name...') as HTMLInputElement).value).toBe('');
    });
  });

  it('closes on blur when input is empty', () => {
    render(<AddTaskRow status="inbox" />);
    fireEvent.click(screen.getByText('Add task...'));

    const input = screen.getByPlaceholderText('Task name...');
    fireEvent.blur(input);

    expect(screen.queryByPlaceholderText('Task name...')).toBeNull();
  });
});
