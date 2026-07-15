import React from 'react';

import classes from './Widget.module.scss';
import clsx from 'clsx';
import { WithChildren } from '@/hooks/Mapper/types/common.ts';

export type WidgetProps = {
  label: React.ReactNode | string;
  windowId?: string;
  contentClassName?: string;
} & WithChildren;

export const Widget = ({ label, children, windowId, contentClassName }: WidgetProps) => {
  return (
    <section data-window-id={windowId} className={clsx(classes.root, 'flex flex-col w-full h-full')}>
      <header className={clsx(classes.Header, 'react-grid-dragHandleExample flex w-full cursor-move select-none')}>
        {label}
      </header>
      <div
        className={clsx(classes.Content, 'overflow-auto custom-scrollbar', contentClassName)}
        style={{ flexGrow: 1 }}
        onContextMenu={e => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {children}
      </div>
    </section>
  );
};
