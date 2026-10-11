// 轻量 Toast：成功 2s 自动消失，错误常驻可关。全局单例 store。
import { create } from 'zustand';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
}

interface ToastState {
  items: readonly ToastItem[];
  push: (kind: ToastKind, message: string) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (kind, message) => {
    seq += 1;
    const id = seq;
    set((s) => ({ items: [...s.items, { id, kind, message }] }));
    if (kind !== 'error') {
      setTimeout(() => set((s) => ({ items: s.items.filter((i) => i.id !== id) })), 2000);
    }
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

/** 便捷函数：供非 React 模块调用。 */
export const toast = {
  success: (message: string): void => useToastStore.getState().push('success', message),
  error: (message: string): void => useToastStore.getState().push('error', message),
  info: (message: string): void => useToastStore.getState().push('info', message),
};

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
} as const;

export function ToastHost(): React.JSX.Element {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-50 flex w-72 flex-col gap-2">
      {items.map((item) => {
        const Icon = ICONS[item.kind];
        const color =
          item.kind === 'success' ? 'text-accent' : item.kind === 'error' ? 'text-danger' : 'text-fg-muted';
        return (
          <div
            key={item.id}
            className="glass-panel pointer-events-auto flex items-start gap-2 rounded-lg px-3 py-2 text-caption animate-slide"
          >
            <Icon size={14} className={`mt-0.5 shrink-0 ${color}`} />
            <span className="flex-1 text-fg">{item.message}</span>
            <button
              type="button"
              className="shrink-0 rounded-xs px-0.5 text-fg-dim transition-colors duration-fast ease-standard hover:text-fg"
              onClick={() => dismiss(item.id)}
              aria-label="关闭提示"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
