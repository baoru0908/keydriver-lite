// 骨架屏原语：
// shimmer 微光占位（比 pulse 更贴合「玻璃质感」），圆角 radius-card。
// 变体：text（单行 caption 行高）/ block（矩形区域）/ circle（图标位）。
// a11y：SkeletonGroup 容器 aria-busy="true" + aria-label；prefers-reduced-motion 下
// 由全局 reduced-motion 块把动画时长归零 → 退化为静态底色（不闪）。
import type { ReactNode } from 'react';
import { cn } from '@/shared/cn';

export type SkeletonVariant = 'text' | 'block' | 'circle';

const VARIANT_CLASS: Record<SkeletonVariant, string> = {
  text: 'h-4 w-full',
  block: 'h-20 w-full',
  circle: 'h-10 w-10 rounded-full',
};

export interface SkeletonProps {
  readonly variant?: SkeletonVariant;
  readonly className?: string;
}

export function Skeleton({ variant = 'block', className }: SkeletonProps): React.JSX.Element {
  return (
    <div
      aria-hidden
      className={cn('skeleton-shimmer rounded-card', VARIANT_CLASS[variant], className)}
    />
  );
}

export interface SkeletonGroupProps {
  /** 传给容器的语义标签（仅供测试/调试定位，不渲染为可见文本）。 */
  readonly label?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/** 异步加载期的骨架容器：aria-busy 明示「正在加载」。 */
export function SkeletonGroup({ label, className, children }: SkeletonGroupProps): React.JSX.Element {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label ?? '加载中'}
      className={cn('flex flex-col gap-2', className)}
    >
      {children}
    </div>
  );
}
