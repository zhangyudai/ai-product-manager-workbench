import { describe, expect, it, vi } from 'vitest';
import {
  isSupportedProjectMaterial,
  partitionProjectMaterialPaths,
  prepareDroppedProjectMaterials,
} from '@/renderer/pages/projects/projectMaterialImport';

describe('project material import preparation', () => {
  it('accepts the M4 document formats case-insensitively and rejects unrelated files', () => {
    expect(isSupportedProjectMaterial('brief.MD')).toBe(true);
    expect(isSupportedProjectMaterial('research.PDF')).toBe(true);
    expect(partitionProjectMaterialPaths(['a.txt', 'b.docx', 'tool.exe'])).toEqual({
      accepted: ['a.txt', 'b.docx'],
      rejected: ['tool.exe'],
    });
  });

  it('uses native Electron paths without uploading file bytes', async () => {
    const uploadFile = vi.fn();
    const file = new File(['content'], 'notes.md', { type: 'text/markdown' });

    const result = await prepareDroppedProjectMaterials({
      files: [file],
      getNativePath: () => 'C:\\source\\notes.md',
      uploadFile,
    });

    expect(result).toEqual({ paths: ['C:\\source\\notes.md'], rejected: 0, failed: 0 });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('uploads WebUI files and reports unsupported or failed items without losing successes', async () => {
    const good = new File(['content'], 'brief.pdf', { type: 'application/pdf' });
    const broken = new File(['content'], 'broken.docx');
    const unsupported = new File(['content'], 'script.exe');
    const uploadFile = vi.fn().mockResolvedValueOnce('/managed/brief.pdf').mockRejectedValueOnce(new Error('upload'));

    const result = await prepareDroppedProjectMaterials({
      files: [good, broken, unsupported],
      getNativePath: () => '',
      uploadFile,
    });

    expect(result).toEqual({ paths: ['/managed/brief.pdf'], rejected: 1, failed: 1 });
    expect(uploadFile).toHaveBeenCalledTimes(2);
  });
});
