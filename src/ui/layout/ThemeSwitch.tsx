// 主题切换：下拉选择（跟随系统 / 浅色 / 深色 / 极光），键盘可达 + 本地持久化。
//
// 交互与可访问性：
//  · 触发器 aria-haspopup="menu" + aria-expanded；面板 role="menu"，选项 role="menuitemradio" + aria-checked
//  · ↑/↓ 循环移动焦点，Home/End 跳首尾，Enter/Space 选中，Esc 关闭并把焦点还回触发器
//  · 点击外部关闭；挂载/卸载不做动画（动效由 useUiStore/ThemeProvider 的主题过渡统一承载）
import { useEffect, useRef, useState } from 'react';
import { Monitor, Moon, Palette, Sun } from 'lucide-react';
import { useUiStore, type ThemePreference } from '@/store/useUiStore';
import { cn } from '@/shared/cn';

interface ThemeOption {
  readonly value: ThemePreference;
  readonly label: string;
  readonly hint: string;
  readonly icon: typeof Sun;
}

const OPTIONS: readonly ThemeOption[] = [
  { value: 'system', label: '跟随系统', hint: '自动匹配系统深浅色', icon: Monitor },
  { value: 'light', label: '浅色', hint: '明亮通透', icon: Sun },
  { value: 'dark', label: '深色', hint: '低光环境更舒适', icon: Moon },
  { value: 'aurora', label: '极光', hint: '青紫渐变 extended', icon: Palette },
];

export function ThemeSwitch(): React.JSX.Element {
  const preference = useUiStore((s) => s.themePreference);
  const setPreference = useUiStore((s) => s.setThemePreference);
  const [open, setOpen] = useState(false);
  /** 正在播放退场动画（此间菜单仍在 DOM 中，播完才卸载）。 */
  const [closing, setClosing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const current = OPTIONS.find((o) => o.value === preference) ?? OPTIONS[0];
  const CurrentIcon = current?.icon ?? Monitor;

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
      if (restoreFocus) triggerRef.current?.focus();
    }, 140);
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const index = OPTIONS.findIndex((o) => o.value === preference);
      openAt(index >= 0 ? index : 0);
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent, index: number): void => {
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
            'glass-panel absolute right-0 top-full z-50 mt-1.5 w-52 rounded-lg p-1',
            closing ? 'animate-pop-out pointer-events-none' : 'animate-pop',
          )}
        >
          {OPTIONS.map((option, index) => {
            const Icon = option.icon;
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
                onClick={() => {
                  setPreference(option.value);
                  close();
                }}
                onKeyDown={(e) => onMenuKeyDown(e, index)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left',
                  'transition-colors duration-fast ease-standard',
                  active ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:bg-elevated hover:text-fg',
                )}
              >
                <Icon size={14} className="mt-0.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">{option.label}</span>
                  <span className="block text-caption text-fg-dim">{option.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
