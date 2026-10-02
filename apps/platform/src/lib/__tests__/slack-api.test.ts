import { describe, it, expect } from 'vitest';
import {
  headerBlock,
  markdownSection,
  fieldsSection,
  divider,
  actionsBlock,
  button,
  contextBlock,
} from '../slack-api';

describe('Block Kit helpers', () => {
  it('headerBlock creates a plain_text header', () => {
    const block = headerBlock('Hello World');
    expect(block.type).toBe('header');
    expect(block.text).toEqual({ type: 'plain_text', text: 'Hello World', emoji: true });
  });

  it('markdownSection creates a mrkdwn section', () => {
    const block = markdownSection('*bold* text');
    expect(block.type).toBe('section');
    expect(block.text).toEqual({ type: 'mrkdwn', text: '*bold* text' });
  });

  it('fieldsSection creates field pairs', () => {
    const block = fieldsSection(['Field 1', 'Field 2']);
    expect(block.type).toBe('section');
    expect(block.fields).toHaveLength(2);
    expect(block.fields![0]).toEqual({ type: 'mrkdwn', text: 'Field 1' });
  });

  it('divider creates a divider block', () => {
    expect(divider().type).toBe('divider');
  });

  it('actionsBlock wraps elements with optional block_id', () => {
    const btn = button('Click', 'action_1');
    const block = actionsBlock([btn], 'my_block');
    expect(block.type).toBe('actions');
    expect(block.block_id).toBe('my_block');
    expect(block.elements).toHaveLength(1);
  });

  it('button creates a button element with optional props', () => {
    const btn = button('Go', 'go_action', { url: 'https://example.com', style: 'primary' });
    expect(btn.type).toBe('button');
    expect(btn.text).toEqual({ type: 'plain_text', text: 'Go', emoji: true });
    expect(btn.action_id).toBe('go_action');
    expect(btn.url).toBe('https://example.com');
    expect(btn.style).toBe('primary');
  });

  it('button without optional props omits them', () => {
    const btn = button('Simple', 'simple_action');
    expect(btn.url).toBeUndefined();
    expect(btn.value).toBeUndefined();
    expect(btn.style).toBeUndefined();
  });

  it('contextBlock creates context elements', () => {
    const block = contextBlock([{ type: 'mrkdwn', text: 'context text' }]);
    expect(block.type).toBe('context');
    expect(block.elements).toHaveLength(1);
  });
});
