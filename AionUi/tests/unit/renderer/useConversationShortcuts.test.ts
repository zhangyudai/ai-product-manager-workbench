/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isNewConversationShortcut } from '@/renderer/hooks/ui/useConversationShortcuts';

const keyboardEvent = (overrides: Partial<KeyboardEvent>): KeyboardEvent =>
  ({
    key: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  }) as KeyboardEvent;

describe('new conversation shortcut', () => {
  it('accepts the product shortcut and the existing compatibility shortcut', () => {
    expect(isNewConversationShortcut(keyboardEvent({ key: 'n', ctrlKey: true }))).toBe(true);
    expect(isNewConversationShortcut(keyboardEvent({ key: 'T', ctrlKey: true }))).toBe(true);
  });

  it('rejects modified or unrelated shortcuts', () => {
    expect(isNewConversationShortcut(keyboardEvent({ key: 'n', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isNewConversationShortcut(keyboardEvent({ key: 'n', ctrlKey: true, altKey: true }))).toBe(false);
    expect(isNewConversationShortcut(keyboardEvent({ key: 'p', ctrlKey: true }))).toBe(false);
  });
});
