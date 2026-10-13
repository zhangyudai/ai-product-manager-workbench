/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type ProductDocumentKind = 'requirement' | 'prd';

export type ProductDocumentSection = {
  id: string;
  title: string;
  heading: string;
  body: string;
  start: number;
  end: number;
};

export type OutputQualityIssueCode =
  | 'emptyDocument'
  | 'missingSection'
  | 'emptySection'
  | 'missingUserStoryFormat'
  | 'missingAcceptanceFormat'
  | 'missingRiskResponse'
  | 'unresolvedConflict';

export type OutputQualityIssue = {
  code: OutputQualityIssueCode;
  severity: 'error' | 'warning';
  sectionId?: string;
  sectionTitle?: string;
};

export type OutputQualityReport = {
  kind: ProductDocumentKind;
  score: number;
  passed: boolean;
  sections: ProductDocumentSection[];
  issues: OutputQualityIssue[];
};

type SectionRule = {
  id: string;
  title: string;
  aliases: RegExp[];
};

const REQUIREMENT_RULES: SectionRule[] = [
  { id: 'productGoal', title: '产品目标', aliases: [/产品目标/i, /^目标$/i] },
  { id: 'targetUsers', title: '目标用户', aliases: [/目标用户/i, /^用户$/i] },
  { id: 'coreScenarios', title: '核心场景', aliases: [/核心场景/i, /使用场景/i] },
  { id: 'coreRequirements', title: '核心需求', aliases: [/核心需求/i, /^需求$/i] },
  { id: 'mvpScope', title: 'MVP 范围', aliases: [/mvp\s*范围/i, /最小可行/i] },
  { id: 'openQuestions', title: '待确认问题', aliases: [/待确认问题/i, /开放问题/i] },
];

const PRD_RULES: SectionRule[] = [
  { id: 'background', title: '产品背景', aliases: [/产品背景/i, /^背景$/i] },
  { id: 'productGoal', title: '产品目标', aliases: [/产品目标/i, /^目标$/i] },
  { id: 'targetUsers', title: '目标用户', aliases: [/目标用户/i, /^用户$/i] },
  { id: 'coreScenarios', title: '核心场景', aliases: [/核心场景/i, /使用场景/i] },
  { id: 'scope', title: '功能范围', aliases: [/功能范围/i, /产品范围/i] },
  { id: 'flow', title: '核心业务流程', aliases: [/核心业务流程/i, /业务流程/i] },
  { id: 'requirements', title: '功能需求', aliases: [/功能需求/i] },
  { id: 'nonFunctional', title: '非功能要求', aliases: [/非功能/i] },
  { id: 'stories', title: '用户故事与验收标准', aliases: [/用户故事.*验收标准/i, /用户故事/i] },
  { id: 'outOfScope', title: '暂不实现范围', aliases: [/暂不实现/i, /非目标/i] },
  { id: 'openQuestions', title: '待确认问题', aliases: [/待确认问题/i, /开放问题/i] },
];

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/gm;

const normalizeHeading = (value: string) =>
  value
    .replace(/^[\d一二三四五六七八九十]+[.、：:]\s*/, '')
    .replace(/[：:]$/, '')
    .trim();

const findRule = (title: string, rules: SectionRule[]) => {
  const normalized = normalizeHeading(title);
  return rules.find((rule) => rule.aliases.some((alias) => alias.test(normalized)));
};

export const parseProductDocumentSections = (content: string, kind: ProductDocumentKind): ProductDocumentSection[] => {
  const rules = kind === 'prd' ? PRD_RULES : REQUIREMENT_RULES;
  const headings = [...content.matchAll(HEADING_PATTERN)];
  return headings.flatMap((match, index) => {
    const title = match[2]?.trim() ?? '';
    const rule = findRule(title, rules);
    if (!rule || match.index == null) return [];
    const headingEnd = match.index + match[0].length;
    const end = headings[index + 1]?.index ?? content.length;
    return [
      {
        id: rule.id,
        title: rule.title,
        heading: match[0],
        body: content.slice(headingEnd, end).trim(),
        start: match.index,
        end,
      },
    ];
  });
};

export const detectProductDocumentKind = (content: string): ProductDocumentKind => {
  const prdMatches = parseProductDocumentSections(content, 'prd').length;
  const requirementMatches = parseProductDocumentSections(content, 'requirement').length;
  return prdMatches >= 3 && prdMatches > requirementMatches ? 'prd' : 'requirement';
};

const hasUserStoryFormat = (body: string) =>
  /作为[\s\S]{1,40}(?:我希望|我想要)[\s\S]{1,80}(?:以便|从而)/.test(body) ||
  /as an? [\s\S]+i want [\s\S]+so that/i.test(body);

const hasAcceptanceFormat = (body: string) =>
  /given[\s\S]{0,200}when[\s\S]{0,200}then/i.test(body) ||
  /(假设|给定)[\s\S]{0,80}(当|如果)[\s\S]{0,80}(那么|则)/.test(body);

export const analyzeProductDocument = (content: string): OutputQualityReport => {
  const kind = detectProductDocumentKind(content);
  const rules = kind === 'prd' ? PRD_RULES : REQUIREMENT_RULES;
  const sections = parseProductDocumentSections(content, kind);
  const issues: OutputQualityIssue[] = [];

  if (!content.trim()) {
    issues.push({ code: 'emptyDocument', severity: 'error' });
  }

  for (const rule of rules) {
    const section = sections.find((item) => item.id === rule.id);
    if (!section) {
      issues.push({ code: 'missingSection', severity: 'error', sectionId: rule.id, sectionTitle: rule.title });
    } else if (!section.body.trim()) {
      issues.push({ code: 'emptySection', severity: 'error', sectionId: rule.id, sectionTitle: rule.title });
    }
  }

  if (kind === 'prd') {
    const stories = sections.find((section) => section.id === 'stories')?.body ?? '';
    if (stories && !hasUserStoryFormat(stories)) {
      issues.push({ code: 'missingUserStoryFormat', severity: 'warning', sectionId: 'stories' });
    }
    if (stories && !hasAcceptanceFormat(stories)) {
      issues.push({ code: 'missingAcceptanceFormat', severity: 'warning', sectionId: 'stories' });
    }
    if (!/风险[\s\S]{0,160}(?:应对|缓解|恢复|处理|降低|提示)/.test(content)) {
      issues.push({ code: 'missingRiskResponse', severity: 'warning' });
    }
  }

  if (/(冲突|矛盾|不一致)/.test(content)) {
    const questions = sections.find((section) => section.id === 'openQuestions')?.body ?? '';
    const conflictIsActionable =
      /(?:冲突|矛盾|不一致)[\s\S]{0,40}(?:待|需|确认|解决|\?|？)/.test(questions) ||
      /(?:待|需|确认|解决)[\s\S]{0,40}(?:冲突|矛盾|不一致)/.test(questions);
    if (!conflictIsActionable) {
      issues.push({ code: 'unresolvedConflict', severity: 'warning', sectionId: 'openQuestions' });
    }
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.length - errorCount;
  const score = content.trim() ? Math.max(0, Math.round(100 - (errorCount * 70) / rules.length - warningCount * 6)) : 0;
  return { kind, score, passed: errorCount === 0 && score >= 80, sections, issues };
};

export const replaceMarkdownSection = (content: string, sectionId: string, replacement: string): string => {
  const kind = detectProductDocumentKind(content);
  const section = parseProductDocumentSections(content, kind).find((item) => item.id === sectionId);
  if (!section) throw new Error('section_not_found');
  const nextSection = `${section.heading}\n\n${replacement.trim()}\n\n`;
  return `${content.slice(0, section.start)}${nextSection}${content.slice(section.end).replace(/^\s+/, '')}`;
};

export const nextVersionedMarkdownPath = (relativePath: string, existingPaths: string[]): string => {
  const normalized = relativePath.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  const directory = slash >= 0 ? normalized.slice(0, slash + 1) : '';
  const fileName = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const stem = fileName.replace(/\.md$/i, '').replace(/-v\d+$/i, '');
  const existing = new Set(existingPaths.map((path) => path.replace(/\\/g, '/').toLowerCase()));
  let version = 2;
  while (existing.has(`${directory}${stem}-v${version}.md`.toLowerCase())) version += 1;
  return `${directory}${stem}-v${version}.md`;
};

export const buildQualityReviewPrompt = (relativePath: string, report: OutputQualityReport): string => {
  const missing = report.issues
    .filter((issue) => issue.code === 'missingSection' || issue.code === 'emptySection')
    .map((issue) => issue.sectionTitle)
    .filter(Boolean)
    .join('、');
  return [
    `请检查项目文件 ${relativePath} 的输出质量。`,
    `本地结构检查得分为 ${report.score}/100。${missing ? `缺失或为空的章节：${missing}。` : ''}`,
    '请先列出资料不足、内容冲突和需要我确认的问题，不要把推测写成已确认事实。',
    '检查产品目标、目标用户、核心场景、范围、用户故事、验收标准和风险是否可供产品与研发评审。',
    '未经我明确确认，不要覆盖原文件或其他已确认章节。',
  ].join('\n');
};

export const buildSectionRegenerationPrompt = (relativePath: string, section: ProductDocumentSection): string =>
  [
    `请仅重新生成项目文件 ${relativePath} 中的“${section.title}”章节。`,
    '先指出该章节目前的信息缺口或冲突，并向我提出必要的确认问题。',
    '我确认后再给出完整的新章节正文。不要改写、删除或调整其他章节。',
    '不要直接覆盖原文件；如需落盘，请另存为递增版本号的新 Markdown 文件。',
    '所有事实必须来自当前对话和已附带的项目资料，不得虚构来源、数字或用户结论。',
  ].join('\n');
