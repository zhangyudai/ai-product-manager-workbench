/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { OutputQualityIssue } from '../outputQuality';

type Props = {
  issues: OutputQualityIssue[];
};

const QualityIssueList: React.FC<Props> = ({ issues }) => {
  const { t } = useTranslation();

  if (issues.length === 0) {
    return <p className='mb-0 text-13px text-success-6'>{t('guid.projects.outputQuality.noIssues')}</p>;
  }

  return (
    <ul className='m-0 space-y-8px pl-20px text-13px leading-20px text-t-secondary'>
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${issue.sectionId ?? index}`}>
          <span className='mr-8px'>
            {t(`guid.projects.outputQuality.issue.${issue.code}`, { section: issue.sectionTitle ?? '' })}
          </span>
          <Tag size='small' color={issue.severity === 'error' ? 'red' : 'orange'}>
            {t(`guid.projects.outputQuality.severity.${issue.severity}`)}
          </Tag>
        </li>
      ))}
    </ul>
  );
};

export default QualityIssueList;
