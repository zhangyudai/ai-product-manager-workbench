/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { Button, Checkbox, Empty, Input, Message, Modal, Spin, Tag } from '@arco-design/web-react';
import { Edit, FolderOpen, MessageOne, Refresh, UploadOne } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';
import { getCurrentProject, setCurrentProject } from '@/renderer/pages/conversation/explorer/currentProjectStore';
import { refreshRoot } from '@/renderer/pages/conversation/explorer/explorerStore';
import { uploadFileViaHttp } from '@/renderer/services/FileService';
import {
  PROJECT_MATERIAL_EXTENSIONS,
  partitionProjectMaterialPaths,
  prepareDroppedProjectMaterials,
} from './projectMaterialImport';
import {
  loadProjectMaterials,
  parseProjectMaterial,
  relativePathFromCopiedPath,
  saveProjectMaterials,
  selectedMaterialRefs,
  type ProjectMaterial,
} from './projectMaterials';

const tabs = ['overview', 'materials'] as const;
type Tab = (typeof tabs)[number];

const ProjectWorkspacePage: React.FC = () => {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [importing, setImporting] = useState(false);
  const [draggingMaterials, setDraggingMaterials] = useState(false);
  const [materials, setMaterials] = useState<ProjectMaterial[]>(() => (id ? loadProjectMaterials(id) : []));
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

  useEffect(() => {
    setMaterials(id ? loadProjectMaterials(id) : []);
  }, [id]);

  useEffect(() => {
    if (id) saveProjectMaterials(id, materials);
  }, [id, materials]);

  const workspacePeId = data?.explorer.workspace_pe_id ?? '';
  const workspacePath = data?.explorer.entries[0]?.display_path ?? '';
  const chosenMaterialRefs = useMemo(
    () => (workspacePeId ? selectedMaterialRefs(workspacePeId, materials) : []),
    [materials, workspacePeId]
  );

  const openProjectChat = useCallback(() => {
    void navigate('/guid', {
      state: {
        workspace: workspacePath,
        projectId: id,
        prefillFileRefs: chosenMaterialRefs,
      },
    });
  }, [chosenMaterialRefs, id, navigate, workspacePath]);

  const parseMaterials = useCallback(
    async (relativePaths: string[]) => {
      if (!workspacePeId || relativePaths.length === 0) return;
      setMaterials((current) => {
        const next = [...current];
        for (const relativePath of relativePaths) {
          const name = relativePath.replace(/\\/g, '/').split('/').pop() ?? relativePath;
          const index = next.findIndex((item) => item.relativePath === relativePath);
          const parsing: ProjectMaterial = {
            relativePath,
            name,
            size: index >= 0 ? next[index].size : 0,
            lastModified: index >= 0 ? next[index].lastModified : 0,
            status: 'parsing',
            selected: false,
          };
          if (index >= 0) next[index] = parsing;
          else next.push(parsing);
        }
        return next;
      });

      const parsed = await Promise.all(
        relativePaths.map(async (relativePath) => {
          try {
            return await parseProjectMaterial(workspacePeId, relativePath);
          } catch (parseError) {
            return {
              relativePath,
              name: relativePath.replace(/\\/g, '/').split('/').pop() ?? relativePath,
              size: 0,
              lastModified: 0,
              status: 'failed' as const,
              selected: false,
              failureReason:
                parseError instanceof Error ? parseError.message : t('conversation.explorer.materialParseFailed'),
            };
          }
        })
      );
      setMaterials((current) => {
        const byPath = new Map(current.map((item) => [item.relativePath, item]));
        parsed.forEach((item) => byPath.set(item.relativePath, item));
        return [...byPath.values()];
      });
    },
    [t, workspacePeId]
  );

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

  const importMaterialPaths = useCallback(
    async (paths: string[], rejected = 0, preparationFailures = 0) => {
      if (!workspacePeId || importing) return;
      if (paths.length === 0) {
        Message.warning(t('conversation.explorer.materialImportNoSupportedFiles'));
        return;
      }

      setImporting(true);
      try {
        const result = await ipcBridge.fs.copyFilesToProject.invoke({
          file_paths: paths,
          target: { pe_id: workspacePeId, relative_path: '' },
        });
        await refreshRoot(workspacePeId);
        const copied = result.copied_files.length;
        const failed = result.failed_files.length + rejected + preparationFailures;
        if (copied > 0 && failed === 0) {
          Message.success(t('conversation.explorer.imported', { count: copied }));
        } else if (copied > 0) {
          Message.warning(t('conversation.explorer.materialImportPartial', { copied, failed }));
        } else {
          Message.error(t('conversation.explorer.importFailed'));
        }
        if (copied > 0) {
          const relativePaths = result.copied_files.map((path) => relativePathFromCopiedPath(workspacePath, path));
          await parseMaterials(relativePaths);
        }
      } catch {
        Message.error(t('conversation.explorer.importFailed'));
      } finally {
        setImporting(false);
      }
    },
    [importing, parseMaterials, t, workspacePath, workspacePeId]
  );

  const chooseMaterials = useCallback(async () => {
    const selected = await ipcBridge.dialog.showOpen.invoke({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: t('conversation.explorer.materialImportFilterName'),
          extensions: [...PROJECT_MATERIAL_EXTENSIONS],
        },
      ],
    });
    if (!selected?.length) return;
    const { accepted, rejected } = partitionProjectMaterialPaths(selected);
    await importMaterialPaths(accepted, rejected.length);
  }, [importMaterialPaths, t]);

  const dropMaterials = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDraggingMaterials(false);
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length === 0) return;
      const prepared = await prepareDroppedProjectMaterials({
        files,
        getNativePath: (file) =>
          window.electronAPI?.getPathForFile?.(file) || (file as File & { path?: string }).path || '',
        uploadFile: (file) => uploadFileViaHttp(file),
      });
      await importMaterialPaths(prepared.paths, prepared.rejected, prepared.failed);
    },
    [importMaterialPaths]
  );

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
          <Button type='primary' icon={<MessageOne />} onClick={openProjectChat}>
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
                  在项目对话中梳理需求、生成或修改文档；需求分析和 PRD
                  都作为普通项目文件保存，同一项目可以有多份、多版本。
                </p>
              </div>
              <div className='grid gap-16px md:grid-cols-2'>
                <button
                  type='button'
                  className='cursor-pointer rounded-16px border border-border-2 bg-bg-2 p-24px text-left hover:border-primary-5'
                  onClick={openProjectChat}
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
            <div
              data-testid='project-material-drop-zone'
              className={`rounded-16px border bg-bg-2 p-24px transition-colors ${
                draggingMaterials ? 'border-primary-6 bg-primary-1' : 'border-border-2'
              }`}
              onDragEnter={(event) => {
                event.preventDefault();
                setDraggingMaterials(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
              }}
              onDragLeave={(event) => {
                const nextTarget = event.relatedTarget;
                if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                  setDraggingMaterials(false);
                }
              }}
              onDrop={(event) => void dropMaterials(event)}
            >
              <div className='flex items-start gap-14px'>
                <FolderOpen size={24} className='mt-2px shrink-0 text-primary-6' />
                <div className='min-w-0 flex-1'>
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
                  <div className='mt-20px rounded-12px border border-dashed border-border-3 bg-bg-1 px-18px py-20px text-center'>
                    <strong className='block text-14px text-t-primary'>
                      {draggingMaterials
                        ? t('conversation.explorer.materialImportDropActive')
                        : t('conversation.explorer.materialImportDropTitle')}
                    </strong>
                    <p className='mb-14px mt-6px text-12px leading-20px text-t-tertiary'>
                      {t('conversation.explorer.materialImportDropHint')}
                    </p>
                    <Button
                      type='primary'
                      icon={<UploadOne />}
                      loading={importing}
                      disabled={importing}
                      data-testid='project-material-import-button'
                      onClick={() => void chooseMaterials()}
                    >
                      {importing
                        ? t('conversation.explorer.materialImportImporting')
                        : t('conversation.explorer.materialImportImportFiles')}
                    </Button>
                    <p className='mb-0 mt-10px text-12px text-t-tertiary'>
                      {t('conversation.explorer.materialImportSupportedFormats')}
                    </p>
                  </div>
                  <div className='mt-20px'>
                    <div className='mb-10px flex items-center justify-between gap-12px'>
                      <div>
                        <strong className='block text-14px text-t-primary'>
                          {t('conversation.explorer.materialListTitle')}
                        </strong>
                        <span className='mt-3px block text-12px text-t-tertiary'>
                          {t('conversation.explorer.materialSelectionSummary', { count: chosenMaterialRefs.length })}
                        </span>
                      </div>
                      <Button type='primary' disabled={chosenMaterialRefs.length === 0} onClick={openProjectChat}>
                        {t('conversation.explorer.materialStartChat')}
                      </Button>
                    </div>
                    {materials.length === 0 ? (
                      <Empty description={t('conversation.explorer.materialListEmpty')} />
                    ) : (
                      <div className='overflow-hidden rounded-12px border border-border-2'>
                        {materials.map((material) => (
                          <div
                            key={material.relativePath}
                            data-testid={`project-material-${material.relativePath}`}
                            className='flex items-center gap-12px border-b border-border-2 px-14px py-12px last:border-b-0'
                          >
                            <Checkbox
                              checked={material.selected}
                              disabled={material.status !== 'ready'}
                              aria-label={t('conversation.explorer.materialSelectAria', { name: material.name })}
                              onChange={(checked) =>
                                setMaterials((current) =>
                                  current.map((item) =>
                                    item.relativePath === material.relativePath ? { ...item, selected: checked } : item
                                  )
                                )
                              }
                            />
                            <div className='min-w-0 flex-1'>
                              <strong className='block truncate text-13px text-t-primary'>{material.name}</strong>
                              <span className='mt-2px block truncate text-12px text-t-tertiary'>
                                {material.relativePath}
                              </span>
                              {material.failureReason ? (
                                <span className='mt-3px block text-12px text-danger-6'>{material.failureReason}</span>
                              ) : null}
                            </div>
                            <Tag
                              color={
                                material.status === 'ready'
                                  ? 'green'
                                  : material.status === 'parsing'
                                    ? 'blue'
                                    : material.status === 'unsupported'
                                      ? 'gray'
                                      : 'red'
                              }
                            >
                              {t(`conversation.explorer.materialStatus.${material.status}`)}
                            </Tag>
                            {material.status === 'failed' ? (
                              <Button
                                type='text'
                                size='small'
                                icon={<Refresh />}
                                onClick={() => void parseMaterials([material.relativePath])}
                              >
                                {t('conversation.explorer.materialRetry')}
                              </Button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                    <p className='mb-0 mt-10px text-12px leading-20px text-t-tertiary'>
                      {t('conversation.explorer.materialPrivacyHint')}
                    </p>
                  </div>
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
