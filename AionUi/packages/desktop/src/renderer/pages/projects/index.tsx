/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { ProjectSummaryDto } from '@/common/types/project';
import { WorkspaceFolderSelect } from '@/renderer/components/workspace';
import { Button, Empty, Input, Message, Modal, Spin } from '@arco-design/web-react';
import { FolderOpen, Plus, Search } from '@icon-park/react';
import dayjs from 'dayjs';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

const pathToFileUri = (path: string): string => {
  const normalized = path.replace(/\\/g, '/');
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `file://${encodeURI(withLeadingSlash)}`;
};

const ProjectsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data = [], isLoading, mutate } = useSWR<ProjectSummaryDto[]>('product-projects', () =>
    ipcBridge.project.list.invoke()
  );
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const projects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? data.filter((project) => project.name.toLocaleLowerCase().includes(needle)) : data;
  }, [data, query]);

  const resetDialog = () => {
    setName('');
    setWorkspace('');
    setDialogOpen(false);
  };

  const createProject = async () => {
    if (!name.trim() || !workspace) return;
    setSubmitting(true);
    try {
      const project = await ipcBridge.project.create.invoke({
        name: name.trim(),
        workspace_uri: pathToFileUri(workspace),
      });
      await mutate();
      resetDialog();
      void navigate(`/projects/${project.project_id}`);
    } catch (error) {
      console.error('Failed to create project:', error);
      Message.error(t('guid.projects.createFailed', { defaultValue: 'Could not create the project.' }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className='size-full overflow-y-auto bg-bg-1 px-32px py-28px'>
      <div className='mx-auto max-w-1120px'>
        <div className='mb-28px flex items-start justify-between gap-20px'>
          <div>
            <h1 className='m-0 text-28px font-650 text-t-primary'>
              {t('guid.projects.title', { defaultValue: 'Projects' })}
            </h1>
            <p className='mb-0 mt-8px text-14px text-t-secondary'>
              {t('guid.projects.description', {
                defaultValue: 'Keep conversations, source material, analysis and PRDs in one product workspace.',
              })}
            </p>
          </div>
          <Button type='primary' icon={<Plus />} onClick={() => setDialogOpen(true)}>
            {t('guid.projects.create', { defaultValue: 'Create project' })}
          </Button>
        </div>

        <Input
          allowClear
          value={query}
          onChange={setQuery}
          prefix={<Search />}
          placeholder={t('guid.projects.search', { defaultValue: 'Search projects' })}
          className='mb-20px max-w-420px'
        />

        {isLoading ? (
          <div className='h-240px flex items-center justify-center'>
            <Spin />
          </div>
        ) : projects.length === 0 ? (
          <div className='rounded-16px border border-border-2 bg-bg-2 py-64px'>
            <Empty
              description={
                query
                  ? t('guid.projects.noResults', { defaultValue: 'No matching projects.' })
                  : t('guid.projects.empty', { defaultValue: 'Create your first product project.' })
              }
            />
          </div>
        ) : (
          <div className='grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-14px'>
            {projects.map((project) => (
              <button
                key={project.project_id}
                type='button'
                className='min-w-0 cursor-pointer rounded-14px border border-border-2 bg-bg-2 p-18px text-left transition-colors hover:border-primary-5 hover:bg-fill-1'
                onClick={() => void navigate(`/projects/${project.project_id}`)}
              >
                <div className='mb-18px size-38px flex items-center justify-center rounded-10px bg-fill-2 text-primary-6'>
                  <FolderOpen size='20' fill='currentColor' />
                </div>
                <div className='truncate text-16px font-600 text-t-primary'>{project.name}</div>
                <div className='mt-7px truncate text-12px text-t-tertiary' title={project.workspace_path}>
                  {project.workspace_path}
                </div>
                <div className='mt-16px text-12px text-t-secondary'>
                  {t('guid.projects.updatedAt', {
                    defaultValue: 'Updated {{time}}',
                    time: dayjs(project.updated_at).format('YYYY-MM-DD HH:mm'),
                  })}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <Modal
        title={t('guid.projects.create', { defaultValue: 'Create project' })}
        visible={dialogOpen}
        confirmLoading={submitting}
        okButtonProps={{ disabled: !name.trim() || !workspace }}
        onOk={() => void createProject()}
        onCancel={resetDialog}
        unmountOnExit
      >
        <div className='flex flex-col gap-16px'>
          <label className='flex flex-col gap-7px text-13px text-t-secondary'>
            {t('guid.projects.name', { defaultValue: 'Project name' })}
            <Input
              autoFocus
              value={name}
              maxLength={80}
              onChange={setName}
              placeholder={t('guid.projects.namePlaceholder', { defaultValue: 'e.g. AI Product Workbench' })}
            />
          </label>
          <label className='flex flex-col gap-7px text-13px text-t-secondary'>
            {t('guid.projects.workspace', { defaultValue: 'Local project folder' })}
            <WorkspaceFolderSelect
              value={workspace}
              onChange={setWorkspace}
              onClear={() => setWorkspace('')}
              placeholder={t('guid.projects.chooseFolder', { defaultValue: 'Choose a local folder' })}
              recentLabel={t('team.create.recentLabel', { defaultValue: 'Recent folders' })}
              chooseDifferentLabel={t('team.create.chooseDifferentFolder', { defaultValue: 'Choose another folder' })}
              recentStorageKey='product-project-workspaces'
            />
          </label>
        </div>
      </Modal>
    </main>
  );
};

export default ProjectsPage;
