/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tooltip } from '@arco-design/web-react';
import { Home } from '@icon-park/react';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';

type SiderWorkbenchEntryProps = {
  isMobile: boolean;
  isActive: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onClick: () => void;
};

const SiderWorkbenchEntry: React.FC<SiderWorkbenchEntryProps> = ({
  isMobile,
  isActive,
  collapsed,
  siderTooltipProps,
  onClick,
}) => {
  const { t } = useTranslation();
  const label = t('conversation.workbench.navLabel');

  return (
    <Tooltip {...siderTooltipProps} content={label} position='right'>
      <div
        role='button'
        tabIndex={0}
        aria-current={isActive ? 'page' : undefined}
        className={classNames(
          'box-border group h-34px w-full flex items-center cursor-pointer transition-colors rd-8px text-t-primary',
          collapsed ? 'justify-center' : 'justify-start gap-8px ps-10px pe-8px',
          isMobile && 'sider-action-btn-mobile',
          isActive ? 'bg-fill-3' : 'hover:bg-fill-3 active:bg-fill-4'
        )}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onClick();
          }
        }}
      >
        <span className='size-22px flex items-center justify-center shrink-0 text-t-primary'>
          <Home theme='outline' size={collapsed ? 20 : 16} fill='currentColor' className='block leading-none' />
        </span>
        {!collapsed && <span className='text-t-primary text-14px font-[500] leading-24px'>{label}</span>}
      </div>
    </Tooltip>
  );
};

export default SiderWorkbenchEntry;
