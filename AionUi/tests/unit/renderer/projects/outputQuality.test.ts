/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  analyzeProductDocument,
  buildSectionRegenerationPrompt,
  nextVersionedMarkdownPath,
  replaceMarkdownSection,
} from '@/renderer/pages/projects/outputQuality';

const requirement = `# 需求分析
## 产品目标
缩短需求整理时间。
## 目标用户
独立产品经理。
## 核心场景
根据访谈整理需求。
## 核心需求
生成可编辑的需求分析。
## MVP 范围
仅覆盖桌面端单人流程。
## 待确认问题
需要确认首批文件格式。
`;

const prd = `# PRD
## 产品背景
资料分散导致整理效率低。
## 产品目标
形成可评审的产品方案。
## 目标用户
独立产品经理。
## 核心场景
导入访谈并生成 PRD。
## 功能范围
项目、资料、对话和 PRD。
## 核心业务流程
导入资料 → 确认需求 → 生成 PRD。
## 功能需求
支持资料选择和局部修改。
## 非功能要求
数据仅保存在本地；风险是磁盘不可写，需给出恢复提示。
## 用户故事与验收标准
作为产品经理，我希望选择资料，以便控制生成范围。
Given 已选择资料，When 生成 PRD，Then 只使用所选资料。
## 暂不实现范围
暂不实现多人协作。
## 待确认问题
模型预算上限待确认。
`;

describe('output quality rules', () => {
  const representativeSamples = [
    requirement,
    `${requirement}\n补充：会议纪要已确认。`,
    `${requirement}\n补充：访谈对象为产品经理。`,
    `${requirement}\n补充：竞品资料只作参考。`,
    prd,
    `${prd}\n补充：首版仅支持 Windows。`,
    `${prd}\n补充：长文档采用分段解析。`,
    `${prd}\n补充：无关内容不得进入结论。`,
    '# PRD\n## 产品背景\n只有一句想法。',
    '',
  ];

  it('accepts at least eight of ten representative outputs', () => {
    const passing = representativeSamples.filter((sample) => analyzeProductDocument(sample).passed);
    expect(passing).toHaveLength(8);
  });

  it('reports missing sections for a one-line idea', () => {
    const report = analyzeProductDocument('# 想法\n做一个产品经理工具。');
    expect(report.passed).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'missingSection')).toBe(true);
  });

  it('treats an empty document as recoverable invalid input', () => {
    const report = analyzeProductDocument('');
    expect(report.score).toBe(0);
    expect(report.issues[0]?.code).toBe('emptyDocument');
  });

  it('requires conflicts to be surfaced in pending questions', () => {
    const report = analyzeProductDocument(requirement.replace('需要确认首批文件格式。', '暂无。') + '\n存在范围冲突。');
    expect(report.issues.some((issue) => issue.code === 'unresolvedConflict')).toBe(true);
  });

  it('warns when user stories are not written as outcomes', () => {
    const report = analyzeProductDocument(
      prd.replace('作为产品经理，我希望选择资料，以便控制生成范围。', '支持选择资料。')
    );
    expect(report.issues.some((issue) => issue.code === 'missingUserStoryFormat')).toBe(true);
  });

  it('warns when acceptance criteria are not observable', () => {
    const report = analyzeProductDocument(
      prd.replace('Given 已选择资料，When 生成 PRD，Then 只使用所选资料。', '功能应当好用。')
    );
    expect(report.issues.some((issue) => issue.code === 'missingAcceptanceFormat')).toBe(true);
  });

  it('warns when a PRD omits risks and responses', () => {
    const report = analyzeProductDocument(prd.replace('风险是磁盘不可写，需给出恢复提示。', '响应时间应合理。'));
    expect(report.issues.some((issue) => issue.code === 'missingRiskResponse')).toBe(true);
  });
});

describe('section replacement', () => {
  it('changes only the authorised section', () => {
    const updated = replaceMarkdownSection(prd, 'productGoal', '新的产品目标。');
    expect(updated).toContain('## 产品目标\n\n新的产品目标。');
    expect(updated).toContain('资料分散导致整理效率低。');
    expect(updated).toContain('## 目标用户\n独立产品经理。');
  });

  it('rejects a section that does not exist', () => {
    expect(() => replaceMarkdownSection(prd, 'unknown', '内容')).toThrow('section_not_found');
  });

  it('creates the next available version without overwriting files', () => {
    expect(nextVersionedMarkdownPath('docs/PRD.md', ['docs/PRD.md', 'docs/PRD-v2.md'])).toBe('docs/PRD-v3.md');
  });

  it('builds a regeneration prompt with an explicit non-overwrite boundary', () => {
    const report = analyzeProductDocument(prd);
    const prompt = buildSectionRegenerationPrompt('docs/PRD.md', report.sections[1]);
    expect(prompt).toContain('不要改写、删除或调整其他章节');
    expect(prompt).toContain('不得虚构来源、数字或用户结论');
  });
});
