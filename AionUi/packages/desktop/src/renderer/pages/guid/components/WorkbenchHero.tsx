/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { Briefcase, FileAdditionOne, Tips } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../index.module.css';
import { ipcBridge } from '@/common';
import useSWR from 'swr';

type WorkbenchHeroProps = {
  onSelectPrompt: (prompt: string) => void;
  onOpenProject?: (projectId?: string) => void;
};

const WorkbenchHero: React.FC<WorkbenchHeroProps> = ({ onSelectPrompt, onOpenProject }) => {
  const { t } = useTranslation();
  const { data: projects = [] } = useSWR('product-projects', () => ipcBridge.project.list.invoke());
  const entries = [
    {
      icon: <Tips theme='outline' size={24} />,
      title: t('conversation.workbench.ideaTitle'),
      description: t('conversation.workbench.ideaDescription'),
      prompt: t('conversation.workbench.ideaPrompt'),
    },
    {
      icon: <FileAdditionOne theme='outline' size={24} />,
      title: t('conversation.workbench.importTitle'),
      description: t('conversation.workbench.importDescription'),
      prompt: t('conversation.workbench.importPrompt'),
    },
    {
      icon: <Briefcase theme='outline' size={24} />,
      title: t('conversation.workbench.businessTitle'),
      description: t('conversation.workbench.businessDescription'),
      prompt: t('conversation.workbench.businessPrompt'),
    },
  ];

  return (
    <section className={styles.workbenchHero} aria-labelledby='workbench-title'>
      <p className={styles.workbenchEyebrow}>{t('conversation.workbench.eyebrow')}</p>
      <h1 id='workbench-title' className={styles.workbenchTitle}>
        {t('conversation.workbench.title')}
      </h1>
      <p className={styles.workbenchDescription}>{t('conversation.workbench.description')}</p>
      <div className={styles.workbenchEntries}>
        {entries.map((entry) => (
          <Button
            key={entry.title}
            type='secondary'
            className={styles.workbenchEntry}
            onClick={() => onSelectPrompt(entry.prompt)}
          >
            <span className={styles.workbenchEntryIcon}>{entry.icon}</span>
            <span className={styles.workbenchEntryCopy}>
              <strong>{entry.title}</strong>
              <span>{entry.description}</span>
            </span>
          </Button>
        ))}
      </div>
      {projects.length > 0 && (
        <div className='mt-24px w-full'>
          <div className='mb-10px flex items-center justify-between text-12px text-t-secondary'>
            <span>{t('guid.projects.recent', { defaultValue: 'Recent projects' })}</span>
            <button
              type='button'
              className='cursor-pointer border-0 bg-transparent text-primary-6'
              onClick={() => onOpenProject?.()}
            >
              {t('guid.projects.viewAll', { defaultValue: 'View all' })}
            </button>
          </div>
          <div className='grid grid-cols-3 gap-10px'>
            {projects.slice(0, 3).map((project) => (
              <button
                key={project.project_id}
                type='button'
                className='min-w-0 cursor-pointer rounded-12px border border-border-2 bg-bg-2 px-14px py-12px text-left transition-colors hover:border-primary-5 hover:bg-fill-1'
                onClick={() => onOpenProject?.(project.project_id)}
              >
                <span className='block truncate text-13px font-600 text-t-primary'>{project.name}</span>
                <span className='mt-3px block truncate text-11px text-t-tertiary'>{project.workspace_path}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

export default WorkbenchHero;
