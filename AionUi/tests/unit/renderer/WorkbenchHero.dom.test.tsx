/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import WorkbenchHero from '@/renderer/pages/guid/components/WorkbenchHero';
import { pickPrimaryAssistants } from '@/renderer/pages/guid/components/GuidAssistantSelector';
import type { Assistant } from '@/common/types/agent/assistantTypes';

const translations: Record<string, string> = {
  'conversation.workbench.eyebrow': 'Start today',
  'conversation.workbench.title': 'Turn ideas into plans',
  'conversation.workbench.description': 'Confirm before generating',
  'conversation.workbench.ideaTitle': 'Start with an idea',
  'conversation.workbench.ideaDescription': 'Clarify the MVP',
  'conversation.workbench.ideaPrompt': 'idea prompt',
  'conversation.workbench.importTitle': 'Import material',
  'conversation.workbench.importDescription': 'Extract requirements',
  'conversation.workbench.importPrompt': 'import prompt',
  'conversation.workbench.businessTitle': 'Analyze a business need',
  'conversation.workbench.businessDescription': 'Find information gaps',
  'conversation.workbench.businessPrompt': 'business prompt',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => translations[key] ?? key }),
}));

describe('workbench starting points', () => {
  it('prefills the matching prompt when an entry is selected', () => {
    const onSelectPrompt = vi.fn();
    render(<WorkbenchHero onSelectPrompt={onSelectPrompt} />);

    fireEvent.click(screen.getByRole('button', { name: /Start with an idea/ }));

    expect(onSelectPrompt).toHaveBeenCalledOnce();
    expect(onSelectPrompt).toHaveBeenCalledWith('idea prompt');
  });

  it('does not select a prompt while the user is only reviewing the entries', () => {
    const onSelectPrompt = vi.fn();
    render(<WorkbenchHero onSelectPrompt={onSelectPrompt} />);

    expect(screen.getByRole('button', { name: /Import material/ })).toBeInTheDocument();
    expect(onSelectPrompt).not.toHaveBeenCalled();
  });
});

const assistant = (id: string): Assistant => ({
  id,
  source: 'builtin',
  name: id,
  name_i18n: {},
  description_i18n: {},
  enabled: true,
  sort_order: 0,
  agent_id: 'aionrs',
  enabled_skills: [],
  custom_skill_names: [],
  disabled_builtin_skills: [],
  context_i18n: {},
  prompts: [],
  prompts_i18n: {},
  models: [],
  agent_status: 'online',
  team_selectable: true,
  deletable: false,
});

describe('workbench assistant choices', () => {
  it('shows only the three assistants defined by the product requirements and keeps their product order', () => {
    const choices = pickPrimaryAssistants([
      assistant('general-assistant'),
      assistant('word-creator'),
      assistant('product-requirements'),
      assistant('product-development'),
    ]);

    expect(choices.map((choice) => choice.id)).toEqual([
      'product-requirements',
      'product-development',
      'general-assistant',
    ]);
  });

  it('omits a missing or disabled product assistant instead of presenting a fake selectable option', () => {
    const disabledGeneral = { ...assistant('general-assistant'), enabled: false };

    expect(pickPrimaryAssistants([assistant('product-requirements'), disabledGeneral])).toEqual([
      assistant('product-requirements'),
    ]);
  });
});
