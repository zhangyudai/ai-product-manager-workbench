/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { chatFileRefKey, projectFileRef, type ChatFileRef } from '@/common/types/chatFile';
import { refreshRoot } from '@/renderer/pages/conversation/explorer/explorerStore';
import { Button, Empty, Input, Message, Select, Spin, Tag } from '@arco-design/web-react';
import { CheckOne, Refresh, Write } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  analyzeProductDocument,
  buildQualityReviewPrompt,
  buildSectionRegenerationPrompt,
  nextVersionedMarkdownPath,
  replaceMarkdownSection,
  type OutputQualityReport,
} from '../outputQuality';
import QualityIssueList from './QualityIssueList';

type WorkspaceFile = { name: string; fullPath: string; relativePath: string };

type Props = {
  workspacePeId: string;
  workspacePath: string;
  selectedMaterialRefs: ChatFileRef[];
  onStartChat: (prompt: string, refs: ChatFileRef[]) => void;
};

const joinWorkspacePath = (workspacePath: string, relativePath: string) =>
  `${workspacePath.replace(/[\\/]+$/, '')}/${relativePath.replace(/\\/g, '/').replace(/^\/+/, '')}`;

const dedupeRefs = (refs: ChatFileRef[]) => {
  const byKey = new Map(refs.map((ref) => [chatFileRefKey(ref), ref]));
  return [...byKey.values()];
};

const OutputQualityPanel: React.FC<Props> = ({ workspacePeId, workspacePath, selectedMaterialRefs, onStartChat }) => {
  const { t } = useTranslation();
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [content, setContent] = useState('');
  const [report, setReport] = useState<OutputQualityReport | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [replacement, setReplacement] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadFiles = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    try {
      const listed = await ipcBridge.fs.listWorkspaceFiles.invoke({ root: workspacePath });
      const markdown = listed
        .filter((file) => /\.md$/i.test(file.name))
        .toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
      setFiles(markdown);
      setSelectedPath((current) => (markdown.some((file) => file.relativePath === current) ? current : ''));
    } catch {
      Message.error(t('guid.projects.outputQuality.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, workspacePath]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    if (!selectedPath || !workspacePeId) {
      setContent('');
      setReport(null);
      setSelectedSectionId('');
      setReplacement('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    void ipcBridge.fs.readContent
      .invoke({ file: projectFileRef(workspacePeId, selectedPath), encoding: 'utf8' })
      .then((nextContent) => {
        if (cancelled) return;
        const nextReport = analyzeProductDocument(nextContent);
        setContent(nextContent);
        setReport(nextReport);
        setSelectedSectionId(nextReport.sections[0]?.id ?? '');
        setReplacement('');
      })
      .catch(() => {
        if (!cancelled) Message.error(t('guid.projects.outputQuality.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPath, t, workspacePeId]);

  const targetRef = useMemo(
    () => (selectedPath && workspacePeId ? projectFileRef(workspacePeId, selectedPath) : null),
    [selectedPath, workspacePeId]
  );
  const chatRefs = useMemo(
    () => (targetRef ? dedupeRefs([targetRef, ...selectedMaterialRefs]) : selectedMaterialRefs),
    [selectedMaterialRefs, targetRef]
  );
  const selectedSection = report?.sections.find((section) => section.id === selectedSectionId);

  const saveVersion = async () => {
    if (!selectedPath || !selectedSection || !replacement.trim()) return;
    setSaving(true);
    try {
      const nextContent = replaceMarkdownSection(content, selectedSection.id, replacement);
      const nextPath = nextVersionedMarkdownPath(
        selectedPath,
        files.map((file) => file.relativePath)
      );
      const saved = await ipcBridge.fs.writeFile.invoke({
        path: joinWorkspacePath(workspacePath, nextPath),
        data: nextContent,
        workspace: workspacePath,
      });
      if (!saved) throw new Error('write_failed');
      await refreshRoot(workspacePeId);
      await loadFiles();
      Message.success(t('guid.projects.outputQuality.saveSuccess', { path: nextPath }));
    } catch {
      Message.error(t('guid.projects.outputQuality.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className='mt-24px rounded-14px border border-border-2 bg-bg-1 p-18px' data-testid='output-quality-panel'>
      <div className='flex items-start justify-between gap-12px'>
        <div>
          <strong className='text-15px text-t-primary'>{t('guid.projects.outputQuality.title')}</strong>
          <p className='mb-0 mt-5px text-12px leading-20px text-t-tertiary'>
            {t('guid.projects.outputQuality.description')}
          </p>
        </div>
        <Button type='text' size='small' icon={<Refresh />} onClick={() => void loadFiles()}>
          {t('guid.projects.outputQuality.refresh')}
        </Button>
      </div>

      {loading && files.length === 0 ? (
        <div className='flex justify-center py-24px'>
          <Spin />
        </div>
      ) : files.length === 0 ? (
        <Empty description={t('guid.projects.outputQuality.noDocuments')} />
      ) : (
        <div className='mt-16px space-y-16px'>
          <Select
            value={selectedPath || undefined}
            aria-label={t('guid.projects.outputQuality.selectDocument')}
            placeholder={t('guid.projects.outputQuality.selectDocument')}
            className='w-full'
            options={files.map((file) => ({ label: file.relativePath, value: file.relativePath }))}
            onChange={(value) => {
              setReport(null);
              setSelectedPath(value);
            }}
          />

          {loading && !report ? (
            <div className='flex justify-center py-16px'>
              <Spin />
            </div>
          ) : report ? (
            <>
              <div className='flex flex-wrap items-center gap-10px'>
                <span className='text-24px font-650 text-t-primary'>{report.score}</span>
                <span className='text-12px text-t-tertiary'>/ 100</span>
                <Tag color={report.passed ? 'green' : 'orange'}>
                  {report.passed ? t('guid.projects.outputQuality.passed') : t('guid.projects.outputQuality.needsWork')}
                </Tag>
                <Tag>{t(`guid.projects.outputQuality.documentType.${report.kind}`)}</Tag>
              </div>

              <div>
                <strong className='mb-8px block text-13px text-t-primary'>
                  {t('guid.projects.outputQuality.issuesTitle')}
                </strong>
                <QualityIssueList issues={report.issues} />
              </div>

              <Button
                icon={<CheckOne />}
                disabled={!targetRef}
                onClick={() => targetRef && onStartChat(buildQualityReviewPrompt(selectedPath, report), chatRefs)}
              >
                {t('guid.projects.outputQuality.reviewInChat')}
              </Button>

              {report.sections.length > 0 ? (
                <div className='rounded-12px border border-border-2 bg-bg-2 p-14px'>
                  <strong className='mb-10px block text-13px text-t-primary'>
                    {t('guid.projects.outputQuality.sectionTitle')}
                  </strong>
                  <Select
                    value={selectedSectionId}
                    aria-label={t('guid.projects.outputQuality.sectionTitle')}
                    className='w-full'
                    options={report.sections.map((section) => ({ label: section.title, value: section.id }))}
                    onChange={(value) => {
                      setSelectedSectionId(value);
                      setReplacement('');
                    }}
                  />
                  <div className='mt-10px flex flex-wrap gap-8px'>
                    <Button
                      type='primary'
                      icon={<Write />}
                      disabled={!selectedSection || !targetRef}
                      onClick={() =>
                        selectedSection && targetRef
                          ? onStartChat(buildSectionRegenerationPrompt(selectedPath, selectedSection), chatRefs)
                          : undefined
                      }
                    >
                      {t('guid.projects.outputQuality.regenerateInChat')}
                    </Button>
                  </div>
                  <Input.TextArea
                    className='mt-12px'
                    aria-label={t('guid.projects.outputQuality.replacementPlaceholder')}
                    value={replacement}
                    autoSize={{ minRows: 4, maxRows: 10 }}
                    placeholder={t('guid.projects.outputQuality.replacementPlaceholder')}
                    onChange={setReplacement}
                  />
                  <div className='mt-10px flex items-center justify-between gap-12px'>
                    <span className='text-12px text-t-tertiary'>{t('guid.projects.outputQuality.versionHint')}</span>
                    <Button
                      loading={saving}
                      disabled={!replacement.trim() || !selectedSection}
                      onClick={() => void saveVersion()}
                    >
                      {t('guid.projects.outputQuality.saveVersion')}
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </section>
  );
};

export default OutputQualityPanel;
