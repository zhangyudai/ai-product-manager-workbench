/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { Button, Empty, Input, Message, Modal, Spin } from '@arco-design/web-react';
import { Edit, FolderOpen, MessageOne } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';
import {
  getCurrentProject,
  setCurrentProject,
} from '@/renderer/pages/conversation/explorer/currentProjectStore';

const tabs = ['overview', 'materials'] as const;
type Tab = (typeof tabs)[number];

const ProjectWorkspacePage: React.FC = () => {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const { data, isLoading, error, mutate } = useSWR(id ? `product-project-open/${id}` : null, () =>
    ipcBridge.project.open.invoke({ project_id: id })
  );

  useEffect(() => {
    if (!id) return;
    setCurrentProject(id);
    return () => {
      if (getCurrentProject() === id) setCurrentProject(null);
    };
  }, [id]);

  const renameProject = async () => {
    if (!draftName.trim()) return;
    try {
      const renamed = await ipcBridge.project.rename.invoke({ project_id: id, name: draftName.trim() });
      await mutate(renamed, false);
      setRenameOpen(false);
    } catch (renameError) {
      console.error('Failed to rename project:', renameError);
      Message.error(t('guid.projects.renameFailed', { defaultValue: 'Could not rename the project.' }));
    }
  };

  if (isLoading) {
    return (
      <div className='size-full flex items-center justify-center bg-bg-1'>
        <Spin />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className='size-full flex items-center justify-center bg-bg-1'>
        <Empty description={t('guid.projects.loadFailed', { defaultValue: 'Project could not be opened.' })} />
      </div>
    );
  }

  return (
    <main className='size-full overflow-hidden bg-bg-1'>
      <header className='border-b border-border-2 bg-bg-2 px-28px pb-0 pt-22px'>
        <div className='mb-18px flex items-center justify-between gap-20px'>
          <div className='min-w-0'>
            <div className='flex items-center gap-10px'>
              <h1 className='m-0 truncate text-22px font-650 text-t-primary'>{data.name}</h1>
              <Button
                type='text'
                size='small'
                icon={<Edit />}
                aria-label={t('guid.projects.rename', { defaultValue: 'Rename project' })}
                onClick={() => {
                  setDraftName(data.name);
                  setRenameOpen(true);
                }}
              />
            </div>
            <p className='mb-0 mt-5px text-12px text-t-tertiary'>{data.explorer.entries[0]?.display_path ?? ''}</p>
          </div>
          <Button
            type='primary'
            icon={<MessageOne />}
            onClick={() =>
              void navigate('/guid', {
                state: { workspace: data.explorer.entries[0]?.display_path, projectId: id },
              })
            }
          >
            新建项目对话
          </Button>
        </div>
        <nav className='flex gap-24px'>
          {tabs.map((tab) => (
            <button
              key={tab}
              type='button'
              className={`cursor-pointer border-0 border-b-2 bg-transparent px-1px pb-12px text-14px transition-colors ${
                activeTab === tab ? 'border-primary-6 font-600 text-primary-6' : 'border-transparent text-t-secondary'
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {t(`guid.projects.tabs.${tab}`, {
                defaultValue: { overview: '项目概览', materials: '项目资料' }[tab],
              })}
            </button>
          ))}
        </nav>
      </header>

      <section className='h-[calc(100%-126px)] overflow-y-auto px-28px py-28px'>
        <div className='mx-auto max-w-1080px'>
          {activeTab === 'overview' ? (
            <div className='space-y-16px'>
              <div className='rounded-14px border border-border-2 bg-bg-2 px-18px py-16px'>
                <strong className='text-15px text-t-primary'>项目是对话和文档的共同容器</strong>
                <p className='mb-0 mt-6px text-13px leading-22px text-t-secondary'>
                  在项目对话中梳理需求、生成或修改文档；需求分析和 PRD 都作为普通项目文件保存，同一项目可以有多份、多版本。
                </p>
              </div>
              <div className='grid gap-16px md:grid-cols-2'>
                <button
                  type='button'
                  className='cursor-pointer rounded-16px border border-border-2 bg-bg-2 p-24px text-left hover:border-primary-5'
                  onClick={() =>
                    void navigate('/guid', {
                      state: { workspace: data.explorer.entries[0]?.display_path, projectId: id },
                    })
                  }
                >
                  <MessageOne size={22} className='mb-14px text-primary-6' />
                  <strong className='block text-16px text-t-primary'>新建项目对话</strong>
                  <span className='mt-6px block text-13px leading-22px text-t-secondary'>
                    继续梳理需求、讨论方案，或让助手生成新的需求分析和 PRD 文件。
                  </span>
                </button>
                <button
                  type='button'
                  className='cursor-pointer rounded-16px border border-border-2 bg-bg-2 p-24px text-left hover:border-primary-5'
                  onClick={() => setActiveTab('materials')}
                >
                  <FolderOpen size={22} className='mb-14px text-primary-6' />
                  <strong className='block text-16px text-t-primary'>项目资料</strong>
                  <span className='mt-6px block text-13px leading-22px text-t-secondary'>
                    在右侧文件面板查看所有资料、需求分析和多份 PRD，不限制文件数量。
                  </span>
                </button>
              </div>
            </div>
          ) : (
            <div className='rounded-16px border border-border-2 bg-bg-2 p-24px'>
              <div className='flex items-start gap-14px'>
                <FolderOpen size={24} className='mt-2px shrink-0 text-primary-6' />
                <div>
                  <strong className='text-16px text-t-primary'>所有项目文件都在右侧资料面板</strong>
                  <p className='mb-0 mt-7px text-13px leading-22px text-t-secondary'>
                    需求分析和 PRD 不再是单独页签。可以保存为
                    <code className='mx-4px'>docs/需求分析-客户A.md</code>、
                    <code className='mx-4px'>docs/PRD-客户A-v1.md</code>
                    等多份文件，新版本不会自动覆盖旧版本。
                  </p>
                  <p className='mb-0 mt-7px break-all text-12px text-t-tertiary'>
                    项目位置：{data.explorer.entries[0]?.display_path ?? ''}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <Modal
        title={t('guid.projects.rename', { defaultValue: 'Rename project' })}
        visible={renameOpen}
        okButtonProps={{ disabled: !draftName.trim() }}
        onOk={() => void renameProject()}
        onCancel={() => setRenameOpen(false)}
        unmountOnExit
      >
        <Input autoFocus value={draftName} maxLength={80} onChange={setDraftName} />
      </Modal>
    </main>
  );
};

export default ProjectWorkspacePage;
