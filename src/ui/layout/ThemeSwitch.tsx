// 主题切换：下拉选择「主题预设」（跟随系统 + 4 套浅色 + 4 套深色），键盘可达 + 本地持久化。
//
// 交互与可访问性：
//  · 触发器 aria-haspopup="menu" + aria-expanded；面板 role="menu"，选项 role="menuitemradio" + aria-checked
//  · ↑/↓ 循环移动焦点，Home/End 跳首尾，Enter/Space 选中，Esc 关闭并把焦点还回触发器
//  · 每项带三色预览（底色 / 表面 / 强调色），色值来自主题注册表，与 CSS 令牌同源
//  · 点击外部关闭；退场由 closing 标记驱动（播放 animate-pop-out 后再卸载）
import { useEffect, useRef, useState } from 'react';
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { useUiStore, type ThemePreference } from '@/store/useUiStore';
import { DARK_THEMES, LIGHT_THEMES, type ThemePreset } from '@/ui/layout/themes';
import { cn } from '@/shared/cn';

interface ThemeOption {
  readonly value: ThemePreference;
  readonly label: string;
  readonly hint: string;
  /** 预设主题的三色预览；跟随系统没有固定配色，用图标代替 */
  readonly swatch?: readonly [string, string, string];
}

function presetOption(preset: ThemePreset): ThemeOption {
  return { value: preset.id, label: preset.label, hint: preset.hint, swatch: preset.swatch };
}

const SYSTEM_OPTION: ThemeOption = {
  value: 'system',
  label: '跟随系统',
  hint: '自动匹配系统深浅色',
};

const LIGHT_OPTIONS: readonly ThemeOption[] = LIGHT_THEMES.map(presetOption);
const DARK_OPTIONS: readonly ThemeOption[] = DARK_THEMES.map(presetOption);

/** 分组 + 扁平索引：键盘导航按扁平顺序走，分组标题不可聚焦。 */
const GROUPS: readonly { readonly title: string | null; readonly items: readonly ThemeOption[] }[] = [
  { title: null, items: [SYSTEM_OPTION] },
  { title: '浅色', items: LIGHT_OPTIONS },
  { title: '深色', items: DARK_OPTIONS },
];

const OPTIONS: readonly ThemeOption[] = GROUPS.flatMap((group) => group.items);

/** 三色预览：帮用户在切换前就「看见」配色，而不是盲选名字。 */
function Swatch({ colors }: { readonly colors: readonly [string, string, string] }): React.JSX.Element {
  return (
    <span aria-hidden className="mt-0.5 flex shrink-0 overflow-hidden rounded-xs border border-border-strong/50">
      {colors.map((color) => (
        <span key={color} className="h-3.5 w-3.5" style={{ backgroundColor: color }} />
      ))}
    </span>
  );
}

export function ThemeSwitch(): React.JSX.Element {
  const preference = useUiStore((s) => s.themePreference);
  const theme = useUiStore((s) => s.theme);
  const setPreference = useUiStore((s) => s.setThemePreference);
  const [open, setOpen] = useState(false);
  /** 正在播放退场动画（此间菜单仍在 DOM 中，播完才卸载）。 */
  const [closing, setClosing] = useState(false);
  /** 防止 pointerdown + click 双发（菜单进场动画移动 target 时 click 可能不合成）。 */
  const selectingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const current = OPTIONS.find((o) => o.value === preference) ?? SYSTEM_OPTION;
  // 触发器图标表达「明暗归属」：跟随系统用显示器，其余按当前实际主题的 scheme 给日/月
  const CurrentIcon =
    preference === 'system' ? Monitor : DARK_THEMES.some((p) => p.id === theme) ? Moon : Sun;

  // 点击外部 / 失焦关闭（focusout 保证键盘 Tab 走开也会收起）
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    const onFocusOut = (e: FocusEvent): void => {
      if (!rootRef.current?.contains(e.relatedTarget as Node)) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, [open]);

  const openAt = (index: number): void => {
    setClosing(false);
    setOpen(true);
    requestAnimationFrame(() => itemRefs.current[index]?.focus());
  };

  /**
   * 退场：先播动画再卸载（与 Radix 浮层观感一致，避免「啪」地消失）。
   * restoreFocus=false 用于「点击外部 / 焦点离开」场景——此时不该把焦点抢回触发器。
   */
  const close = (restoreFocus = true): void => {
    setClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      selectingRef.current = false;
      if (restoreFocus) triggerRef.current?.focus();
    }, 140);
  };

  /** pointerdown 即选中：绕过 click 合成对「down/up target 不一致」的拒绝。 */
  const handleSelect = (value: ThemePreference): void => {
    if (selectingRef.current) return;
    selectingRef.current = true;
    setPreference(value);
    close();
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const index = OPTIONS.findIndex((o) => o.value === preference);
      openAt(index >= 0 ? index : 0);
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent, index: number): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const option = OPTIONS[index];
      if (option) handleSelect(option.value);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      itemRefs.current[(index + 1) % OPTIONS.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      itemRefs.current[(index - 1 + OPTIONS.length) % OPTIONS.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      itemRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      itemRefs.current[OPTIONS.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  /** 分组渲染时的扁平索引游标（键盘导航按它定位，每次渲染归位）。 */
  let flatIndex = -1;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`主题：${current?.label ?? '跟随系统'}`}
        title={`主题：${current?.label ?? '跟随系统'}`}
        onClick={() => (open ? close() : openAt(OPTIONS.findIndex((o) => o.value === preference)))}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-card text-fg-muted',
          'transition-[background-color,color,box-shadow] duration-fast ease-standard',
          'hover:bg-elevated hover:text-fg',
          open && 'bg-elevated text-fg shadow-glow',
        )}
      >
        <CurrentIcon size={15} />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="主题偏好"
          className={cn(
            'glass-panel absolute right-0 top-full z-50 mt-1.5 max-h-[70vh] w-60 overflow-y-auto rounded-lg p-1',
            closing ? 'animate-pop-out pointer-events-none' : 'animate-pop',
          )}
        >
          {GROUPS.map((group) => (
            <div key={group.title ?? 'system'}>
              {group.title ? (
                <div className="px-2 pb-0.5 pt-1.5 text-caption text-fg-dim">{group.title}</div>
              ) : null}
              {group.items.map((option) => {
            flatIndex += 1;
            const index = flatIndex;
            const active = option.value === preference;
            return (
              <button
                key={option.value}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  handleSelect(option.value);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelect(option.value);
                }}
                onKeyDown={(e) => onMenuKeyDown(e, index)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left',
                  'transition-colors duration-fast ease-standard',
                  active ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:bg-elevated hover:text-fg',
                )}
              >
                {option.swatch ? <Swatch colors={option.swatch} /> : <Monitor size={14} className="mt-0.5 shrink-0" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">{option.label}</span>
                  <span className="block text-caption text-fg-dim">{option.hint}</span>
                </span>
                {active ? <Check size={13} className="mt-0.5 shrink-0" aria-hidden /> : null}
              </button>
              );
              })}
            </div>
          ))}
          <div className="mt-0.5 flex items-center gap-1 border-t border-border px-2 pt-1.5 text-caption text-fg-dim">
            <Palette size={11} aria-hidden /> 深浅与材质随主题切换
          </div>
        </div>
      ) : null}
    </div>
  );
}
