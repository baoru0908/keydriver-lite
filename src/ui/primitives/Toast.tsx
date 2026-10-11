// 轻量 Toast：成功 2s 自动消失，错误常驻可关。全局单例 store。
// 进出场均走 CSS 动画（退场由 leaving 标记驱动，播完再卸载）。
import { create } from 'zustand';
import { useUiStore } from '@/store/useUiStore';
import { Mascot } from '@/ui/brand/mascots';
import { cn } from '@/shared/cn';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
}

/** 退场时长：与 animate-slide-out（--duration-fast 120ms）对齐并留余量。 */
const EXIT_MS = 160;

interface ToastState {
  items: readonly ToastItem[];
  /** 正在播放退场动画的 id：播完才真正移除，避免「硬切消失」。 */
  leaving: readonly number[];
  push: (kind: ToastKind, message: string) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  leaving: [],
  push: (kind, message) => {
    seq += 1;
    const id = seq;
    set((s) => ({ items: [...s.items, { id, kind, message }] }));
    if (kind !== 'error') {
      // 自动消失也走完整退场链路，观感与手动关闭一致
      setTimeout(() => get().dismiss(id), 2000);
    }
  },
  dismiss: (id) => {
    if (get().leaving.includes(id)) return;
    set((s) => ({ leaving: [...s.leaving, id] }));
    setTimeout(() => {
      set((s) => ({
        items: s.items.filter((i) => i.id !== id),
        leaving: s.leaving.filter((l) => l !== id),
      }));
    }, EXIT_MS);
  },
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

/** 吉伊卡哇主题下用角色表情承担反馈：成功=元气乌萨奇，出错=快哭的吉伊，提示=温和哈奇。 */
const MASCOT_BY_KIND = {
  success: { who: 'usagi', mood: 'happy' },
  error: { who: 'chiikawa', mood: 'worry' },
  info: { who: 'hachiware', mood: 'idle' },
} as const;

export function ToastHost(): React.JSX.Element {
  const items = useToastStore((s) => s.items);
  const leaving = useToastStore((s) => s.leaving);
  const dismiss = useToastStore((s) => s.dismiss);
  const mascotTheme = useUiStore((s) => s.theme) === 'chiikawa';

  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-50 flex w-72 flex-col gap-2">
      {items.map((item) => {
        const Icon = ICONS[item.kind];
        const color =
          item.kind === 'success' ? 'text-accent' : item.kind === 'error' ? 'text-danger' : 'text-fg-muted';
        return (
          <div
            key={item.id}
            className={cn(
              'glass-panel pointer-events-auto flex items-start gap-2 rounded-lg px-3 py-2 text-caption',
              leaving.includes(item.id) ? 'animate-slide-out' : 'animate-slide',
            )}
          >
            {mascotTheme ? (
              <Mascot
                who={MASCOT_BY_KIND[item.kind].who}
                mood={MASCOT_BY_KIND[item.kind].mood}
                size={20}
                animate={false}
                className="mt-0.5 shrink-0"
              />
            ) : (
              <Icon size={14} className={`mt-0.5 shrink-0 ${color}`} />
            )}
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
