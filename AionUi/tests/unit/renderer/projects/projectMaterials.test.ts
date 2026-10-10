// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  PROJECT_MATERIAL_MAX_BYTES,
  loadProjectMaterials,
  materialFileRef,
  parseProjectMaterial,
  relativePathFromCopiedPath,
  saveProjectMaterials,
  selectedMaterialRefs,
  type ProjectMaterial,
} from '@/renderer/pages/projects/projectMaterials';

describe('project material lifecycle', () => {
  beforeEach(() => localStorage.clear());

  it('keeps material state isolated by project and restores an interrupted parse as retryable', () => {
    const material: ProjectMaterial = {
      relativePath: 'brief.md',
      name: 'brief.md',
      size: 8,
      lastModified: 1,
      status: 'parsing',
      selected: false,
    };
    saveProjectMaterials('project-a', [material]);

    expect(loadProjectMaterials('project-b')).toEqual([]);
    expect(loadProjectMaterials('project-a')).toEqual([
      expect.objectContaining({ status: 'failed', failureReason: '上次解析未完成，请重试。' }),
    ]);
  });

  it('derives project-relative paths from copied Windows paths and builds project file refs', () => {
    expect(relativePathFromCopiedPath('E:\\work\\A', 'E:\\work\\A\\brief.md')).toBe('brief.md');
    expect(relativePathFromCopiedPath('E:\\work\\A', 'E:\\work\\A\\docs\\brief.md')).toBe('docs/brief.md');
    expect(materialFileRef('pe-a', 'docs\\brief.md')).toEqual({
      kind: 'project',
      pe_id: 'pe-a',
      relative_path: 'docs/brief.md',
    });
  });

  it('parses text through a project-scoped ref without exposing another project path', async () => {
    const seen: unknown[] = [];
    const parsed = await parseProjectMaterial('pe-a', 'notes.md', {
      getMetadata: async (request) => {
        seen.push(request);
        return { name: 'notes.md', path: '', size: 12, type: 'text/markdown', lastModified: 10 };
      },
      readContent: async (request) => {
        seen.push(request);
        return '# Notes';
      },
    });

    expect(parsed).toEqual(expect.objectContaining({ status: 'ready', selected: true, relativePath: 'notes.md' }));
    expect(seen).toEqual([
      { file: { kind: 'project', pe_id: 'pe-a', relative_path: 'notes.md' } },
      { file: { kind: 'project', pe_id: 'pe-a', relative_path: 'notes.md' }, encoding: 'utf8' },
    ]);
  });

  it('reports oversize, empty scanned PDF and unsupported formats explicitly', async () => {
    const oversize = await parseProjectMaterial('pe-a', 'large.txt', {
      getMetadata: async () => ({
        name: 'large.txt',
        path: '',
        size: PROJECT_MATERIAL_MAX_BYTES + 1,
        type: 'text/plain',
        lastModified: 2,
      }),
    });
    expect(oversize).toEqual(expect.objectContaining({ status: 'failed', selected: false }));

    const emptyPdf = await parseProjectMaterial('pe-a', 'scan.pdf', {
      getMetadata: async () => ({ name: 'scan.pdf', path: '', size: 20, type: 'application/pdf', lastModified: 3 }),
      readContent: async () => 'AA==',
      pdfToText: async () => '',
    });
    expect(emptyPdf.failureReason).toContain('OCR');

    const unsupported = await parseProjectMaterial('pe-a', 'legacy.doc');
    expect(unsupported.status).toBe('unsupported');
  });

  it('only forwards ready and checked materials to the next project conversation', () => {
    const materials: ProjectMaterial[] = [
      { relativePath: 'a.md', name: 'a.md', size: 1, lastModified: 1, status: 'ready', selected: true },
      { relativePath: 'b.md', name: 'b.md', size: 1, lastModified: 1, status: 'ready', selected: false },
      { relativePath: 'c.pdf', name: 'c.pdf', size: 1, lastModified: 1, status: 'failed', selected: true },
    ];
    expect(selectedMaterialRefs('pe-a', materials)).toEqual([
      { kind: 'project', pe_id: 'pe-a', relative_path: 'a.md' },
    ]);
  });
});
