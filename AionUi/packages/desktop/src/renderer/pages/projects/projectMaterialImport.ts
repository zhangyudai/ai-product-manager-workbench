/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const PROJECT_MATERIAL_EXTENSIONS = ['txt', 'md', 'markdown', 'pdf', 'docx'] as const;

const supportedExtensionSet = new Set<string>(PROJECT_MATERIAL_EXTENSIONS);

export const isSupportedProjectMaterial = (name: string): boolean => {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return false;
  return supportedExtensionSet.has(name.slice(dot + 1).toLowerCase());
};

export const partitionProjectMaterialPaths = (paths: string[]): { accepted: string[]; rejected: string[] } => {
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const path of paths) {
    (isSupportedProjectMaterial(path) ? accepted : rejected).push(path);
  }
  return { accepted, rejected };
};

type PrepareDroppedMaterialsOptions = {
  files: File[];
  getNativePath: (file: File) => string;
  uploadFile: (file: File) => Promise<string>;
};

export type PreparedDroppedMaterials = {
  paths: string[];
  rejected: number;
  failed: number;
};

/**
 * Resolve dropped files to backend-readable paths. Electron files retain their
 * native path; browser/WebUI files are first uploaded to managed temporary
 * storage, then copied into the project by the shared import path.
 */
export const prepareDroppedProjectMaterials = async ({
  files,
  getNativePath,
  uploadFile,
}: PrepareDroppedMaterialsOptions): Promise<PreparedDroppedMaterials> => {
  const supported = files.filter((file) => isSupportedProjectMaterial(file.name));
  const rejected = files.length - supported.length;
  const resolvedPaths = await Promise.all(
    supported.map(async (file) => {
      const nativePath = getNativePath(file);
      if (nativePath) return nativePath;
      try {
        return await uploadFile(file);
      } catch {
        return null;
      }
    })
  );
  const paths = resolvedPaths.filter((path): path is string => path !== null);
  const failed = resolvedPaths.length - paths.length;

  return { paths, rejected, failed };
};
