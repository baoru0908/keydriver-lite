// range 控件：下限取 options[0]（35 个控件下限是 1，写死 0 会越界），宽度由 ValueWidth 推断。
// 两条调整路径：拖滑块（200ms 防抖写入）+ 数字输入框（失焦/回车提交，防逐键写 EEPROM）。
import { useEffect, useState } from 'react';
import type { ControlSpec } from '@/definition/schema';
import { Slider } from '@/ui/primitives/Slider';
import { describeWidth } from '@/core/protocol/ValueWidth';
import { useControlValue } from '@/store/useMenuStore';
import { useDeviceStore } from '@/store/useDeviceStore';

export interface RangeControlProps {
  readonly control: ControlSpec;
  readonly disabled?: boolean;
}

export function RangeControl({ control, disabled }: RangeControlProps): React.JSX.Element {
  const value = useControlValue(control);
  const menuCommit = useDeviceStore((s) => s.menuCommit);
  const range = control.options.kind === 'range' ? control.options : { min: 0, max: 255 };
  const min = range.min;
  const max = range.max;
  const clamped = Math.min(max, Math.max(min, value));

  // 数字草稿：外部值变化时同步；用户输入期间不动设备，失焦/回车一次性提交
  const [draft, setDraft] = useState(String(clamped));
  useEffect(() => {
    setDraft(String(clamped));
  }, [clamped]);

  const commitDraft = (): void => {
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(clamped));
      return;
    }
    const next = Math.min(max, Math.max(min, parsed));
    if (next === clamped) {
      setDraft(String(clamped));
      return;
    }
    void menuCommit(control, next);
  };

  return (
    <div className="flex w-full items-center gap-3">
      <div className="min-w-0 flex-1">
        <Slider
          value={clamped}
          min={min}
          max={max}
          disabled={disabled}
          ariaLabel={control.label || control.valueKey}
          onChange={(next) => void menuCommit(control, next)}
        />
      </div>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        disabled={disabled}
        aria-label={`${control.label || control.valueKey} 数值`}
        title={`范围 ${min}–${max} · ${describeWidth(control)}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitDraft();
            e.currentTarget.blur();
          }
        }}
        className="w-16 shrink-0 rounded-card border border-border bg-elevated px-2 py-1 text-right font-mono text-xs text-fg outline-none transition-colors focus-visible:border-accent disabled:opacity-50"
      />
      <span
        className="w-14 shrink-0 font-mono text-[10px] text-fg-dim"
        title={`下限 ${min} / 上限 ${max} · ${describeWidth(control)}`}
      >
        {min}–{max}
      </span>
    </div>
  );
}
