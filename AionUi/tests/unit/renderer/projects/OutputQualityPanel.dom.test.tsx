// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OutputQualityPanel from '@/renderer/pages/projects/components/OutputQualityPanel';

const mocks = vi.hoisted(() => ({
  listFiles: vi.fn(),
  readContent: vi.fn(),
  writeFile: vi.fn(),
  refreshRoot: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listWorkspaceFiles: { invoke: mocks.listFiles },
      readContent: { invoke: mocks.readContent },
      writeFile: { invoke: mocks.writeFile },
    },
  },
}));

vi.mock('@/renderer/pages/conversation/explorer/explorerStore', () => ({ refreshRoot: mocks.refreshRoot }));

vi.mock('@icon-park/react', () => ({
  CheckOne: () => <span />,
  Refresh: () => <span />,
  Write: () => <span />,
}));

vi.mock('@arco-design/web-react', () => {
  const Input = Object.assign((props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />, {
    TextArea: ({
      autoSize: _autoSize,
      onChange,
      ...props
    }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> & {
      autoSize?: unknown;
      onChange?: (value: string) => void;
    }) => <textarea {...props} onChange={(event) => onChange?.(event.target.value)} />,
  });
  return {
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
    Input,
    Message: { success: mocks.success, error: mocks.error },
    Select: ({
      options = [],
      onChange,
      value,
      ...props
    }: React.SelectHTMLAttributes<HTMLSelectElement> & {
      options?: Array<{ label: string; value: string }>;
      onChange?: (value: string) => void;
    }) => (
      <select value={value ?? ''} onChange={(event) => onChange?.(event.target.value)} {...props}>
        <option value='' />
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ),
    Spin: () => <div>loading</div>,
    Tag: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  };
});

const translations: Record<string, string> = {
  'guid.projects.outputQuality.selectDocument': '选择文档',
  'guid.projects.outputQuality.reviewInChat': '在项目对话中检查',
  'guid.projects.outputQuality.sectionTitle': '单章节重写',
  'guid.projects.outputQuality.regenerateInChat': '在对话中重写本章节',
  'guid.projects.outputQuality.replacementPlaceholder': '粘贴新章节',
  'guid.projects.outputQuality.saveVersion': '另存为新版本',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => translations[key] ?? options?.path ?? key,
  }),
}));

const prd = `# PRD
## 产品背景
资料分散。
## 产品目标
形成可评审方案。
## 目标用户
产品经理。
## 核心场景
整理访谈。
## 功能范围
项目与对话。
## 核心业务流程
导入 → 确认 → 生成。
## 功能需求
支持局部修改。
## 非功能要求
风险是磁盘不可写，需要给出恢复提示。
## 用户故事与验收标准
作为产品经理，我希望选择资料，以便控制生成范围。
Given 已选择资料，When 生成 PRD，Then 只使用所选资料。
## 暂不实现范围
多人协作。
## 待确认问题
预算待确认。
`;

describe('OutputQualityPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listFiles.mockResolvedValue([
      { name: 'PRD.md', fullPath: 'C:/project/docs/PRD.md', relativePath: 'docs/PRD.md' },
      { name: 'brief.pdf', fullPath: 'C:/project/brief.pdf', relativePath: 'brief.pdf' },
    ]);
    mocks.readContent.mockResolvedValue(prd);
    mocks.writeFile.mockResolvedValue(true);
    mocks.refreshRoot.mockResolvedValue(undefined);
  });

  const renderPanel = (onStartChat = vi.fn()) => {
    render(
      <OutputQualityPanel
        workspacePeId='pe1'
        workspacePath='C:/project'
        selectedMaterialRefs={[{ kind: 'project', pe_id: 'pe1', relative_path: 'brief.pdf' }]}
        onStartChat={onStartChat}
      />
    );
    return onStartChat;
  };

  it('checks a Markdown document and sends the target plus selected material to project chat', async () => {
    const onStartChat = renderPanel();
    fireEvent.change(await screen.findByLabelText('选择文档'), { target: { value: 'docs/PRD.md' } });
    await waitFor(() => expect(mocks.readContent).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('loading')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '在项目对话中检查' }));

    expect(onStartChat).toHaveBeenCalledWith(
      expect.stringContaining('docs/PRD.md'),
      expect.arrayContaining([
        { kind: 'project', pe_id: 'pe1', relative_path: 'docs/PRD.md' },
        { kind: 'project', pe_id: 'pe1', relative_path: 'brief.pdf' },
      ])
    );
  });

  it('saves a confirmed section as a new version without changing other sections', async () => {
    renderPanel();
    fireEvent.change(await screen.findByLabelText('选择文档'), { target: { value: 'docs/PRD.md' } });
    await waitFor(() => expect(mocks.readContent).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('loading')).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('单章节重写'), { target: { value: 'productGoal' } });
    fireEvent.change(screen.getByLabelText('粘贴新章节'), { target: { value: '新的目标。' } });
    fireEvent.click(screen.getByRole('button', { name: '另存为新版本' }));

    await waitFor(() => expect(mocks.writeFile).toHaveBeenCalled());
    const request = mocks.writeFile.mock.calls[0][0];
    expect(request.path).toBe('C:/project/docs/PRD-v2.md');
    expect(request.data).toContain('## 产品目标\n\n新的目标。');
    expect(request.data).toContain('## 目标用户\n产品经理。');
    expect(mocks.refreshRoot).toHaveBeenCalledWith('pe1');
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
  });

  it('keeps the panel recoverable when listing files fails', async () => {
    mocks.listFiles.mockRejectedValue(new Error('offline'));
    renderPanel();
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(screen.getByTestId('output-quality-panel')).toBeInTheDocument();
  });

  it('reports a failed version save without changing the original file', async () => {
    mocks.writeFile.mockResolvedValue(false);
    renderPanel();
    fireEvent.change(await screen.findByLabelText('选择文档'), { target: { value: 'docs/PRD.md' } });
    await waitFor(() => expect(mocks.readContent).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('loading')).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('粘贴新章节'), { target: { value: '新背景。' } });
    fireEvent.click(screen.getByRole('button', { name: '另存为新版本' }));

    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.refreshRoot).not.toHaveBeenCalled();
    expect(mocks.writeFile.mock.calls[0][0].path).not.toBe('C:/project/docs/PRD.md');
  });
});
