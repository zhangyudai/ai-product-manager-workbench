/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { projectFileRef, type ChatFileRef } from '@/common/types/chatFile';
import { documentConverter } from '@/common/chat/document/DocumentConverter';
import { isSupportedProjectMaterial } from './projectMaterialImport';

export const PROJECT_MATERIAL_MAX_BYTES = 20 * 1024 * 1024;

export type ProjectMaterialStatus = 'parsing' | 'ready' | 'failed' | 'unsupported';

export type ProjectMaterial = {
  relativePath: string;
  name: string;
  size: number;
  lastModified: number;
  status: ProjectMaterialStatus;
  selected: boolean;
  failureReason?: string;
};

type StoredMaterial = Omit<ProjectMaterial, 'status'> & { status: Exclude<ProjectMaterialStatus, 'parsing'> };

const storageKey = (projectId: string) => `project-materials:${projectId}`;

const getStorage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export const loadProjectMaterials = (projectId: string): ProjectMaterial[] => {
  const raw = getStorage()?.getItem(storageKey(projectId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredMaterial);
  } catch {
    return [];
  }
};

export const saveProjectMaterials = (projectId: string, materials: ProjectMaterial[]): void => {
  const stable = materials.map(
    (material): StoredMaterial => ({
      ...material,
      status: material.status === 'parsing' ? 'failed' : material.status,
      failureReason: material.status === 'parsing' ? '上次解析未完成，请重试。' : material.failureReason,
    })
  );
  try {
    getStorage()?.setItem(storageKey(projectId), JSON.stringify(stable));
  } catch {
    // Storage is an optional recovery aid. The project files remain the source of truth.
  }
};

const isStoredMaterial = (value: unknown): value is StoredMaterial => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<StoredMaterial>;
  return (
    typeof item.relativePath === 'string' &&
    typeof item.name === 'string' &&
    typeof item.size === 'number' &&
    typeof item.lastModified === 'number' &&
    typeof item.selected === 'boolean' &&
    ['ready', 'failed', 'unsupported'].includes(item.status ?? '')
  );
};

const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '');

export const relativePathFromCopiedPath = (workspacePath: string, copiedPath: string): string => {
  const workspace = normalizePath(workspacePath);
  const copied = normalizePath(copiedPath);
  const prefix = `${workspace}/`;
  return copied.toLowerCase().startsWith(prefix.toLowerCase())
    ? copied.slice(prefix.length)
    : (copied.split('/').pop() ?? copied);
};

export const materialFileRef = (workspacePeId: string, relativePath: string): ChatFileRef =>
  projectFileRef(workspacePeId, relativePath.replace(/\\/g, '/'));

const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
};

const extractPdfText = async (arrayBuffer: ArrayBuffer): Promise<string> => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).toString();
  }
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    // Parse sequentially to keep large PDFs inside a predictable memory envelope.
    // eslint-disable-next-line no-await-in-loop
    const page = await pdf.getPage(pageNumber);
    // eslint-disable-next-line no-await-in-loop
    const textContent = await page.getTextContent();
    pages.push(
      textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter(Boolean)
        .join(' ')
    );
  }
  return pages.join('\n\n');
};

export type ParseProjectMaterialDependencies = {
  getMetadata?: typeof ipcBridge.fs.getContentMetadata.invoke;
  readContent?: typeof ipcBridge.fs.readContent.invoke;
  wordToMarkdown?: (buffer: ArrayBuffer) => Promise<string>;
  pdfToText?: (buffer: ArrayBuffer) => Promise<string>;
};

export const parseProjectMaterial = async (
  workspacePeId: string,
  relativePath: string,
  dependencies: ParseProjectMaterialDependencies = {}
): Promise<ProjectMaterial> => {
  const ref = materialFileRef(workspacePeId, relativePath);
  const name = relativePath.replace(/\\/g, '/').split('/').pop() ?? relativePath;
  if (!isSupportedProjectMaterial(name)) {
    return { relativePath, name, size: 0, lastModified: 0, status: 'unsupported', selected: false };
  }

  const getMetadata = dependencies.getMetadata ?? ipcBridge.fs.getContentMetadata.invoke;
  const readContent = dependencies.readContent ?? ipcBridge.fs.readContent.invoke;
  const metadata = await getMetadata({ file: ref });
  if (metadata.size > PROJECT_MATERIAL_MAX_BYTES) {
    return {
      relativePath,
      name,
      size: metadata.size,
      lastModified: metadata.lastModified,
      status: 'failed',
      selected: false,
      failureReason: '文件超过 20 MB 上限。',
    };
  }

  try {
    const extension = name.split('.').pop()?.toLowerCase();
    let text = '';
    if (extension === 'txt' || extension === 'md' || extension === 'markdown') {
      text = await readContent({ file: ref, encoding: 'utf8' });
    } else {
      const encoded = await readContent({ file: ref, encoding: 'base64' });
      const buffer = base64ToArrayBuffer(encoded);
      if (extension === 'docx') {
        text = await (dependencies.wordToMarkdown ?? documentConverter.wordToMarkdown.bind(documentConverter))(buffer);
      } else if (extension === 'pdf') {
        text = await (dependencies.pdfToText ?? extractPdfText)(buffer);
      }
    }
    if (!text.trim())
      throw new Error(extension === 'pdf' ? 'PDF 没有可复制文字，暂不支持扫描件 OCR。' : '没有读取到正文。');
    return {
      relativePath,
      name,
      size: metadata.size,
      lastModified: metadata.lastModified,
      status: 'ready',
      selected: true,
    };
  } catch (error) {
    return {
      relativePath,
      name,
      size: metadata.size,
      lastModified: metadata.lastModified,
      status: 'failed',
      selected: false,
      failureReason: error instanceof Error ? error.message : '解析失败，请重试。',
    };
  }
};

export const selectedMaterialRefs = (workspacePeId: string, materials: ProjectMaterial[]): ChatFileRef[] =>
  materials
    .filter((material) => material.status === 'ready' && material.selected)
    .map((material) => materialFileRef(workspacePeId, material.relativePath));
