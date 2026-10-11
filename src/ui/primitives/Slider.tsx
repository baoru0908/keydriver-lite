// 滑块：原生 <input type="range">，与原版 VIA 的 accent-range 同款方案
// （styled input[type=range] + accent-color，零 JS 拖拽代码）。
// 原因：本环境 WKWebView 拖动期间 mousemove/pointermove 派发不可靠（真机帧日志实证），
// 自研拖拽（Radix capture / window pointermove / window mousemove）全部只有 click 级；
// 原生 range 的拖拽由 WebKit 内部实现，不依赖 JS 事件派发，改值经 onChange 提交。
//
// 视觉：轨道按进度填充渐变（--kd-range-progress），拇指带 accent 光晕，hover 放大 / 按下微缩。
import type { CSSProperties } from 'react';
import { cn } from '@/shared/cn';

export interface SliderProps {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly disabled?: boolean;
  readonly onChange: (value: number) => void;
  readonly ariaLabel?: string;
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  disabled,
  onChange,
  ariaLabel,
}: SliderProps): React.JSX.Element {
  const span = Math.max(1, max - min);
  const pct = Math.min(100, Math.max(0, ((value - min) / span) * 100));
  const style = { '--kd-range-progress': `${pct}%` } as CSSProperties;

  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-valuetext={String(value)}
        style={style}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className={cn(
          'kd-range h-7 min-w-0 flex-1 cursor-pointer accent-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      />
      <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-fg-muted">{value}</span>
    </div>
  );
}
