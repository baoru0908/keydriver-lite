// 单键渲染：优先采用 KLE 原始标签，fallback 键码表；shift 副字符右上角小字。
import type { KleKey } from '@/definition/schema';
import { format, formatKeycap, getShiftPair } from '@/keycodes/KeycodeFormatter';
import { cn } from '@/shared/cn';

export interface KeyWidgetProps {
  readonly kleKey: KleKey;
  readonly keycode: number;
  readonly scale: number;
  readonly selected: boolean;
  readonly onSelect: () => void;
  /** 画布原点（包围盒左上角，像素）：键位坐标需减去它才能贴齐画布左上角（默认 0） */
  readonly originX?: number;
  readonly originY?: number;
}

const TONE_CLASS = {
  accent: 'bg-key-accent text-fg',
  mod: 'bg-key-mod text-fg',
  alpha: 'bg-key-base text-fg',
  special: 'bg-key-special text-fg-muted',
} as const;

interface KeycapLabels {
  readonly main: string;
  readonly sub?: string;
}

/** KLE 标签看起来是占位符（如 DF(..) / 0x00..）而非真实印字。 */
function isPlaceholderLabel(text: string): boolean {
  const t = text.trim();
  if (t === '' || t === '...' || t === '..') return true;
  // 被截断的函数式或编码：包含 "..)" / "..]" / "0x.." 等
  if (/\.\.[)\]]/.test(t)) return true;
  if (/^0x[0-9a-fA-F]+\.\.?$/.test(t)) return true;
  return false;
}

/** 双字符键帽优先用 KLE 标签；KLE 只有主字符时，尝试用 ANSI shift 配对补副字符。 */
function deriveLabels(kleKey: KleKey, keycode: number): KeycapLabels {
  const mainLabel = kleKey.labels[0];
  const hasRealKle = typeof mainLabel === 'string' && !isPlaceholderLabel(mainLabel);

  if (hasRealKle) {
    const main = mainLabel;
    const sub = kleKey.labels[1];
    if (sub) return { main, sub };
    if (!kleKey.decal) {
      const pair = getShiftPair(keycode);
      if (pair && pair.main === main) return { main, sub: pair.shift };
    }
    return { main };
  }

  const pair = !kleKey.decal ? getShiftPair(keycode) : undefined;
  if (pair) return { main: pair.main, sub: pair.shift };

  const lines = formatKeycap(keycode);
  return lines.length > 1
    ? { main: lines[0] ?? '', sub: lines[1] }
    : { main: lines[0] ?? '' };
}

export function KeyWidget({
  kleKey,
  keycode,
  scale,
  selected,
  onSelect,
  originX = 0,
  originY = 0,
}: KeyWidgetProps): React.JSX.Element {
  const { rect, rect2, decal } = kleKey;
  const { main, sub } = deriveLabels(kleKey, keycode);
  const isWide = kleKey.w > 1.25;

  const styleOf = (r: { x: number; y: number; w: number; h: number }): React.CSSProperties => ({
    left: (r.x - originX) * scale,
    top: (r.y - originY) * scale,
    width: r.w * scale,
    height: r.h * scale,
  });

  const base = cn(
    'absolute flex items-center overflow-hidden rounded-key transition-colors',
    'text-[11px] font-semibold tracking-tight leading-none',
    TONE_CLASS[kleKey.tone],
    selected
      ? 'ring-2 ring-accent z-10 brightness-110'
      : 'hover:brightness-110',
    // 装饰键也要有底色，避免在键位图上形成「缺键」空洞。
    decal && 'opacity-60',
  );

  return (
    <>
      {rect2 ? (
        <div className={cn(base, 'pointer-events-none')} style={styleOf(rect2)} aria-hidden />
      ) : null}
      <button
        type="button"
        className={cn(base, 'keycap-base')}
        style={styleOf(rect)}
        onClick={onSelect}
        title={`${format(keycode)} · 矩阵 (${kleKey.matrix.row},${kleKey.matrix.col})`}
        aria-label={
          decal
            ? `装饰键 ${format(keycode)} · 矩阵 (${kleKey.matrix.row},${kleKey.matrix.col})`
            : `${format(keycode)} · 矩阵 (${kleKey.matrix.row},${kleKey.matrix.col})`
        }
      >
        {decal ? null : sub ? (
          <span
            className={cn(
              'relative flex h-full w-full items-center px-1',
              isWide ? 'justify-start' : 'justify-center',
            )}
          >
            <span className="absolute top-1 right-1 text-[8px] font-medium opacity-80">
              {sub}
            </span>
            <span className="max-w-full truncate">{main}</span>
          </span>
        ) : (
          <span
            className={cn(
              'max-w-full truncate px-1',
              isWide ? 'text-left' : 'text-center',
            )}
          >
            {main}
          </span>
        )}
      </button>
    </>
  );
}
