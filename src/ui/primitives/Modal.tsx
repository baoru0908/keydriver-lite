// 通用弹窗：Radix Dialog 包装（确认弹窗 / 定义选择弹窗共用）。
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export interface ModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  readonly width?: string;
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'max-w-md',
}: ModalProps): React.JSX.Element {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-bg/60 backdrop-blur-[var(--blur-overlay)] data-[state=open]:animate-fade data-[state=closed]:animate-fade-out" />
        <DialogPrimitive.Content
          className={`fixed left-1/2 top-1/2 z-50 w-[92vw] ${width} -translate-x-1/2 -translate-y-1/2 rounded-card border border-border bg-surface p-4 shadow-e4 data-[state=open]:animate-scale data-[state=closed]:animate-scale-out`}
        >
          <div className="mb-3 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-sm font-medium text-fg">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-xs text-fg-muted">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close className="rounded p-1 text-fg-dim hover:bg-elevated hover:text-fg">
              <X size={14} />
            </DialogPrimitive.Close>
          </div>
          <div className="max-h-[60vh] overflow-auto">{children}</div>
          {footer ? <div className="mt-4 flex justify-end gap-2">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
