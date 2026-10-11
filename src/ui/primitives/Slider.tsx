// 滑块：原生 <input type="range">，与原版 VIA 的 accent-range 同款方案
// （styled input.attrs({type:'range'}) + accent-color，零 JS 拖拽代码）。
// 原因：本环境 WKWebView 拖动期间 mousemove/pointermove 派发不可靠（真机帧日志实证），
// 自研拖拽（Radix capture / window pointermove / window mousemove）全部只有 click 级；
// 原生 range 的拖拽由 WebKit 内部实现，不依赖 JS 事件派发，改值经 onChange 提交。
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
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className={cn(
          'h-7 min-w-0 flex-1 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-50',
        )}
      />
      <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-fg-muted">{value}</span>
    </div>
  );
}
