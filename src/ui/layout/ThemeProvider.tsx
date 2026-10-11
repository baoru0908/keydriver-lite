// 主题 provider：偏好 → <html> class，跟随系统实时变化，切换时平滑过渡。
//
// 设计约定：
//  · 实际主题 class：`theme-dark` / `theme-light` / `theme-aurora`（CSS 变量覆盖，零组件改动）
//  · 偏好为 `system` 时监听 prefers-color-scheme，系统改深浅即时跟随
//  · 切换瞬间挂 `theme-anim`（320ms 后摘除）——过渡不常驻，避免把 hover/动画整体拖慢
//  · prefers-reduced-motion 下由 CSS 全局把过渡时长归零，此处无需额外判断
import { useEffect, type ReactNode } from 'react';
import { useUiStore, resolveTheme } from '@/store/useUiStore';
import { getBridge } from '@/shared/bridge';

/** 过渡 class 存活时长：与 --duration-slow（320ms）对齐。 */
const TRANSITION_MS = 320;

/** 各主题的窗口底色：直接读 @theme 令牌的当前计算值，避免在 JS 里硬编码 hex。 */
function currentBg(root: HTMLElement): string | null {
  const bg = getComputedStyle(root).getPropertyValue('--color-bg').trim();
  return /^#[0-9a-f]{6}$/i.test(bg) ? bg : null;
}

function applyThemeClass(root: HTMLElement, mode: string): void {
  root.classList.toggle('theme-dark', mode === 'dark');
  root.classList.toggle('theme-light', mode === 'light');
  root.classList.toggle('theme-aurora', mode === 'aurora');
  root.style.colorScheme = mode === 'light' ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const theme = useUiStore((s) => s.theme);
  const preference = useUiStore((s) => s.themePreference);

  // ① 跟随系统：偏好为 system 时监听 prefers-color-scheme 变化
  useEffect(() => {
    if (preference !== 'system') return undefined;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (): void => {
      // 只更新派生值，不写偏好（system 语义保持不变）
      useUiStore.setState({ theme: resolveTheme('system') });
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference]);

  // ② 应用主题 class + 过渡 + 原生窗口底色同步
  useEffect(() => {
    const root = document.documentElement;
    applyThemeClass(root, theme);

    // 过渡只在切换窗口内生效（下一帧挂上，320ms 后摘除）
    root.classList.add('theme-anim');
    const timer = window.setTimeout(() => root.classList.remove('theme-anim'), TRANSITION_MS);

    // 同步原生窗口底色，消除主题切换时的边缝闪色（Tauri/Electron 均走 bridge，浏览器无 bridge 时忽略）
    const bridge = getBridge();
    if (bridge) {
      const bg = currentBg(root);
      if (bg) bridge.setBackgroundColor(bg);
    }

    return () => window.clearTimeout(timer);
  }, [theme]);

  return <>{children}</>;
}
