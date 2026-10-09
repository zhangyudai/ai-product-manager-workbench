/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Assistant } from '@/common/types/agent/assistantTypes';
import { resolveAssistantName } from '@/renderer/utils/model/assistantDisplay';
import { Button, Dropdown, Menu } from '@arco-design/web-react';
import { Down, Robot } from '@icon-park/react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../index.module.css';

const PRIMARY_ASSISTANT_IDS = ['product-requirements', 'product-development', 'general-assistant'] as const;

export function pickPrimaryAssistants(assistants: Assistant[]): Assistant[] {
  const assistantById = new Map(
    assistants.filter((assistant) => assistant.enabled !== false).map((assistant) => [assistant.id, assistant])
  );
  return PRIMARY_ASSISTANT_IDS.flatMap((assistantId) => {
    const assistant = assistantById.get(assistantId);
    return assistant ? [assistant] : [];
  });
}

type GuidAssistantSelectorProps = {
  assistants: Assistant[];
  selectedAssistantId: string | null;
  localeKey: string;
  onSelectAssistant: (assistantId: string) => void;
};

const GuidAssistantSelector: React.FC<GuidAssistantSelectorProps> = ({
  assistants,
  selectedAssistantId,
  localeKey,
  onSelectAssistant,
}) => {
  const { t } = useTranslation();
  const primaryAssistants = useMemo(() => pickPrimaryAssistants(assistants), [assistants]);
  const selectedAssistant = primaryAssistants.find((assistant) => assistant.id === selectedAssistantId);
  const selectedLabel = resolveAssistantName(selectedAssistant, localeKey, t('guid.selectAssistantHint'));

  const menu = (
    <Menu
      selectedKeys={selectedAssistantId ? [selectedAssistantId] : []}
      onClickMenuItem={(assistantId) => onSelectAssistant(assistantId)}
    >
      {primaryAssistants.map((assistant) => (
        <Menu.Item key={assistant.id} disabled={assistant.agent_status !== 'online'}>
          <span className='flex min-w-0 items-center gap-8px'>
            <Robot theme='outline' size='14' />
            <span className='truncate'>{resolveAssistantName(assistant, localeKey)}</span>
          </span>
        </Menu.Item>
      ))}
      {primaryAssistants.length === 0 ? (
        <Menu.Item key='unavailable' disabled>
          {t('guid.selectAssistantHint')}
        </Menu.Item>
      ) : null}
    </Menu>
  );

  return (
    <Dropdown trigger='click' droplist={menu} position='bl'>
      <Button
        type='secondary'
        className={styles.contextSelectorButton}
        disabled={primaryAssistants.length === 0}
        data-testid='guid-assistant-selector'
      >
        <span className={styles.contextSelectorLabel}>{selectedLabel}</span>
        <Down theme='outline' size='13' />
      </Button>
    </Dropdown>
  );
};

export default GuidAssistantSelector;
