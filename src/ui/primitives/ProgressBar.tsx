// 进度条：懒加载 / 导出导入进度展示。
import { cn } from '@/shared/cn';

export interface ProgressBarProps {
  readonly value: number;
  readonly max?: number;
  readonly label?: string;
  readonly className?: string;
  /** 不确定进度（拿不到百分比时用）：高光循环扫过，不显示假数字。 */
  readonly indeterminate?: boolean;
}

export function ProgressBar({
  value,
  max = 100,
  label,
  className,
  indeterminate = false,
}: ProgressBarProps): React.JSX.Element {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-border shadow-inset-hl"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : Math.round(percent)}
      >
        {indeterminate ? (
          /* 不确定：1/3 宽高光循环扫过（有节奏但不给假数字） */
          <div className="h-full w-1/3 rounded-full bg-accent animate-indeterminate" />
        ) : (
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-slow ease-decelerate"
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
      {label ? <span className="w-32 shrink-0 truncate text-[11px] text-fg-muted">{label}</span> : null}
      {!label && !indeterminate ? (
        <span className="w-10 shrink-0 text-right font-mono text-[11px] text-fg-muted">
          {Math.round(percent)}%
        </span>
      ) : null}
    </div>
  );
}
