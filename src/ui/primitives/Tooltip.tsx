// 文字提示：Radix Tooltip 包装（无业务语义，仅行为层）。
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export interface TooltipProps {
  readonly label: string;
  readonly children: ReactNode;
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
}

export function Tooltip({ label, children, side = 'bottom' }: TooltipProps): React.JSX.Element {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className="glass-panel z-50 rounded-sm px-2 py-1 text-caption text-fg data-[state=delayed-open]:animate-pop data-[state=instant-open]:animate-pop data-[state=closed]:animate-pop-out"
          >
            {label}
            <TooltipPrimitive.Arrow className="fill-[var(--color-glass-bg-strong)]" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
