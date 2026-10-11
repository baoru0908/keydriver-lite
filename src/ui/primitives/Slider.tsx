// 滑块：自研拖拽实现。
// 事件选型（真机帧日志实证的 WKWebView 坑）：
//   · Radix Slider（pointer capture）→ onValueChange 从不触发，弃用；
//   · window 级 pointermove → 拖动期间不派发（点击可跳值、拖动不跟手），不可用；
//   · window 级 mousemove/mouseup（触摸走 touchmove/touchend）→ 连续派发 ✓，
//     与真机验证过的 react-colorful useDrag 同款（其源码即绑 mouse 事件而非 pointer 事件）。
import { useCallback, useRef } from 'react';
import { cn } from '@/shared/cn';
import { note } from '@/shared/note';

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

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    const cfg = latestRef.current;
    if (cfg.disabled || e.button !== 0) return;
    e.preventDefault();
    draggingRef.current = true;
    onChange(valueFromClientX(e.clientX));
    let lastNoteAt = 0;
    const move = (ev: MouseEvent): void => {
      if (!draggingRef.current) return;
      if (ev.buttons === 0) {
        stop();
        return;
      }
      ev.preventDefault();
      onChange(valueFromClientX(ev.clientX));
      // 诊断：拖动期间 mousemove 是否派发/节流（100ms 采样）
      const now = Date.now();
      if (now - lastNoteAt > 100) {
        lastNoteAt = now;
        void note(`slider-move clientX=${ev.clientX} buttons=${ev.buttons}`);
      }
    };
    const stop = (): void => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
      void note('slider-up');
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
    void note(`slider-down clientX=${e.clientX} value=${cfg.value}`);
  };

  /** 触摸路径：与 react-colorful 同款（touchmove + touches[0]），preventDefault 防页面滚动。 */
  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>): void => {
    const cfg = latestRef.current;
    if (cfg.disabled || e.touches.length === 0) return;
    e.preventDefault();
    draggingRef.current = true;
    const touch = e.touches[0];
    if (touch) onChange(valueFromClientX(touch.clientX));
    const move = (ev: TouchEvent): void => {
      if (!draggingRef.current || ev.touches.length === 0) return;
      ev.preventDefault();
      const t = ev.touches[0];
      if (t) onChange(valueFromClientX(t.clientX));
    };
    const stop = (): void => {
      draggingRef.current = false;
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', stop);
      window.removeEventListener('touchcancel', stop);
    };
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', stop);
    window.addEventListener('touchcancel', stop);
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
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
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
