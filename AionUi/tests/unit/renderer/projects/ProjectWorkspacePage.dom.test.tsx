// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectWorkspacePage from '@/renderer/pages/projects/ProjectWorkspacePage';

const mocks = vi.hoisted(() => ({
  copyFiles: vi.fn(),
  pickFiles: vi.fn(),
  refreshRoot: vi.fn(),
  uploadFile: vi.fn(),
  getContentMetadata: vi.fn(),
  readContent: vi.fn(),
  messageSuccess: vi.fn(),
  messageWarning: vi.fn(),
  messageError: vi.fn(),
  project: {
    project_id: 'p1',
    name: 'Project A',
    explorer: {
      workspace_pe_id: 'pe1',
      entries: [
        {
          pe_id: 'pe1',
          role: 'workspace',
          display_path: 'C:\\projects\\a',
          order_index: 0,
          runtime_status: 'available',
        },
      ],
    },
  },
}));

vi.mock('swr', () => ({
  default: () => ({ data: mocks.project, isLoading: false, error: null as Error | null, mutate: vi.fn() }),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    loading: _loading,
    icon,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; icon?: React.ReactNode }) => (
    <button {...props}>
      {icon}
      {children}
    </button>
  ),
  Empty: ({ description }: { description?: React.ReactNode }) => <div>{description}</div>,
  Checkbox: ({
    checked,
    onChange,
    ...props
  }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
    onChange?: (checked: boolean) => void;
  }) => <input type='checkbox' checked={checked} onChange={(event) => onChange?.(event.target.checked)} {...props} />,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Message: {
    success: mocks.messageSuccess,
    warning: mocks.messageWarning,
    error: mocks.messageError,
  },
  Modal: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Spin: () => <div>loading</div>,
  Tag: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@icon-park/react', () => ({
  Edit: () => <span />,
  FolderOpen: () => <span />,
  MessageOne: () => <span />,
  UploadOne: () => <span />,
  Refresh: () => <span />,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    dialog: { showOpen: { invoke: mocks.pickFiles } },
    fs: {
      copyFilesToProject: { invoke: mocks.copyFiles },
      getContentMetadata: { invoke: mocks.getContentMetadata },
      readContent: { invoke: mocks.readContent },
    },
    project: {
      open: { invoke: vi.fn() },
      rename: { invoke: vi.fn() },
    },
  },
}));

vi.mock('@/renderer/pages/conversation/explorer/currentProjectStore', () => ({
  getCurrentProject: vi.fn(() => null),
  setCurrentProject: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/explorer/explorerStore', () => ({
  refreshRoot: mocks.refreshRoot,
}));

vi.mock('@/renderer/services/FileService', () => ({
  uploadFileViaHttp: mocks.uploadFile,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/projects/p1']}>
      <Routes>
        <Route path='/projects/:id' element={<ProjectWorkspacePage />} />
      </Routes>
    </MemoryRouter>
  );

describe('ProjectWorkspacePage material import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.copyFiles.mockResolvedValue({ copied_files: ['C:\\source\\brief.pdf'], failed_files: [] });
    mocks.refreshRoot.mockResolvedValue(undefined);
    mocks.uploadFile.mockResolvedValue('/managed/brief.pdf');
    mocks.getContentMetadata.mockResolvedValue({
      name: 'brief.pdf',
      path: '',
      size: 12,
      type: 'application/pdf',
      lastModified: 1,
    });
    mocks.readContent.mockResolvedValue('AA==');
    localStorage.clear();
  });

  it('copies files selected from the import button and refreshes the project tree', async () => {
    mocks.pickFiles.mockResolvedValue(['C:\\source\\brief.pdf']);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^项目资料$/ }));
    fireEvent.click(screen.getByTestId('project-material-import-button'));

    await waitFor(() =>
      expect(mocks.copyFiles).toHaveBeenCalledWith({
        file_paths: ['C:\\source\\brief.pdf'],
        target: { pe_id: 'pe1', relative_path: '' },
      })
    );
    expect(mocks.refreshRoot).toHaveBeenCalledWith('pe1');
  });

  it('uploads a browser-dropped file before copying it into the project', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^项目资料$/ }));
    const file = new File(['content'], 'brief.pdf', { type: 'application/pdf' });
    fireEvent.drop(screen.getByTestId('project-material-drop-zone'), { dataTransfer: { files: [file] } });

    await waitFor(() => expect(mocks.uploadFile).toHaveBeenCalledWith(file));
    expect(mocks.copyFiles).toHaveBeenCalledWith({
      file_paths: ['/managed/brief.pdf'],
      target: { pe_id: 'pe1', relative_path: '' },
    });
  });

  it('rejects unsupported dropped files without calling the copy endpoint', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^项目资料$/ }));
    fireEvent.drop(screen.getByTestId('project-material-drop-zone'), {
      dataTransfer: { files: [new File(['content'], 'program.exe')] },
    });

    await waitFor(() => expect(mocks.messageWarning).toHaveBeenCalled());
    expect(mocks.copyFiles).not.toHaveBeenCalled();
  });
});
