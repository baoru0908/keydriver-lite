// 滑块：自研指针拖拽实现。
// 为什么不用 Radix Slider：WKWebView 的 pointer capture 拖拽有兼容性问题，
// Radix 的 onValueChange 在 Tauri 外壳里从不触发（真机帧日志实证：拖动零 SET 帧）；
// 而同为 window 级监听的 react-colorful 一切正常 → 采用同款已验证模式。
// 交互设计：整条轨道都是热区（点击任意位置即跳值）、拇指放大态、键盘微调。
import { useCallback, useRef } from 'react';
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

/** 按步进取整并夹紧到 [min, max]，消除浮点噪声（导出供单测）。 */
export function clampStepValue(v: number, min: number, max: number, step: number): number {
  const stepped = Math.round((v - min) / step) * step + min;
  const fixed = Number(stepped.toFixed(6));
  return Math.min(max, Math.max(min, fixed));
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
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  // value/min/max/step 来自受控 props，拖拽期间父组件会异步回写；
  // 用 ref 闭包避免 window 监听器反复解绑/重绑。
  const latestRef = useRef({ value, min, max, step, disabled });
  latestRef.current = { value, min, max, step, disabled };

  const valueFromClientX = useCallback((clientX: number): number => {
    const el = trackRef.current;
    const cfg = latestRef.current;
    if (el === null) return cfg.value;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return cfg.value;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return clampStepValue(cfg.min + ratio * (cfg.max - cfg.min), cfg.min, cfg.max, cfg.step);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const cfg = latestRef.current;
    if (cfg.disabled || e.button !== 0) return;
    e.preventDefault();
    draggingRef.current = true;
    onChange(valueFromClientX(e.clientX));
    const move = (ev: PointerEvent): void => {
      if (draggingRef.current) onChange(valueFromClientX(ev.clientX));
    };
    const stop = (): void => {
      draggingRef.current = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  /** 键盘微调：方向键 ±step，PageUp/Down ±1/10 量程，Home/End 到边界。 */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const cfg = latestRef.current;
    if (cfg.disabled) return;
    const big = Math.max(cfg.step, Math.round((cfg.max - cfg.min) / 10));
    const table: Record<string, number> = {
      ArrowRight: cfg.value + cfg.step,
      ArrowUp: cfg.value + cfg.step,
      ArrowLeft: cfg.value - cfg.step,
      ArrowDown: cfg.value - cfg.step,
      PageUp: cfg.value + big,
      PageDown: cfg.value - big,
      Home: cfg.min,
      End: cfg.max,
    };
    const next = table[e.key];
    if (next === undefined) return;
    e.preventDefault();
    onChange(clampStepValue(next, cfg.min, cfg.max, cfg.step));
  };

  const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;

  return (
    <div className="flex items-center gap-2">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-disabled={disabled}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        className={cn(
          'group relative flex h-7 min-w-0 flex-1 touch-none items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        )}
      >
        {/* 轨道：h-2 可视，上下留热区（容器 h-7）——回应「滑动区域不明确」 */}
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-border">
          <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${percent}%` }} />
        </div>
        {/* 拇指：跟随百分比，hover/聚焦放大提示可拖拽 */}
        <div
          className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-surface shadow-e2 transition-transform group-hover:scale-110"
          style={{ left: `${percent}%` }}
        />
      </div>
      <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-fg-muted">{value}</span>
    </div>
  );
}
