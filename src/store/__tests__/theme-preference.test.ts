// 主题偏好：默认跟随系统、手动锁定、循环切换、系统变化时实时跟随。
// 另含主题预设注册表的完整性校验（新增主题若漏配 CSS，这里会先炸）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore, resolveTheme, type ThemeMode, type ThemePreference } from '@/store/useUiStore';
import {
  DARK_THEMES,
  LIGHT_THEMES,
  THEME_CYCLE,
  THEME_IDS,
  isThemePreference,
  themeSchemeOf,
} from '@/ui/layout/themes';

const memoryStorage = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string): string | null => memoryStorage.get(k) ?? null,
  setItem: (k: string, v: string): void => void memoryStorage.set(k, v),
  removeItem: (k: string): void => void memoryStorage.delete(k),
  clear: (): void => memoryStorage.clear(),
};

/** 装一个可变的 matchMedia（后续可触发 change 事件模拟系统切换）。 */
function installMatchMedia(prefersLight: boolean): {
  setPrefersLight: (v: boolean) => void;
} {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  let light = prefersLight;
  const mql = {
    get matches() {
      return light;
    },
    media: '(prefers-color-scheme: light)',
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => void listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => void listeners.delete(cb),
  };
  vi.stubGlobal('window', { matchMedia: () => mql });
  return {
    setPrefersLight: (v: boolean) => {
      light = v;
      for (const cb of listeners) cb({ matches: v } as MediaQueryListEvent);
    },
  };
}

describe('主题偏好', () => {
  beforeEach(() => {
    memoryStorage.clear();
    vi.stubGlobal('localStorage', localStorageStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    memoryStorage.clear();
  });

  it('无历史记录时默认「跟随系统」', () => {
    installMatchMedia(true);
    useUiStore.setState({ themePreference: 'system', theme: resolveTheme('system') });
    expect(useUiStore.getState().themePreference).toBe('system');
    // 系统浅色 → 实际浅色
    expect(resolveTheme('system')).toBe('light');
  });

  it('手动选择写入持久化，并覆盖系统偏好', () => {
    installMatchMedia(true); // 系统浅色
    useUiStore.getState().setThemePreference('dark');
    expect(useUiStore.getState().theme).toBe('dark');
    expect(memoryStorage.get('keydriver:theme')).toBe('dark');
    // 系统虽浅色，手动锁定深色后不再跟随
    expect(resolveTheme('system')).toBe('light');
    expect(useUiStore.getState().theme).toBe('dark');
  });

  it('循环切换走完整预设序列，末位回到首位', () => {
    installMatchMedia(false);
    useUiStore.getState().setThemePreference(THEME_CYCLE[0] as ThemeMode);
    // 依次走完一圈，末位再切一次回到首位
    for (let i = 1; i < THEME_CYCLE.length; i += 1) {
      useUiStore.getState().toggleTheme();
      expect(useUiStore.getState().theme).toBe(THEME_CYCLE[i]);
    }
    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe(THEME_CYCLE[0]);
  });

  it('非法持久化值（手改 / 旧实验值）回落 system', () => {
    installMatchMedia(false);
    memoryStorage.set('keydriver:theme', 'neon-pink'); // 从未存在过的主题
    // 模拟 loadThemePreference 的读取路径：类型守卫 + 回落
    const loadedPref: ThemePreference = ((): ThemePreference => {
      const raw: unknown = memoryStorage.get('keydriver:theme');
      return isThemePreference(raw) ? raw : 'system';
    })();
    expect(loadedPref).toBe('system');
    expect(resolveTheme(loadedPref)).toBe('dark'); // system + 系统深色
  });

  it('偏好为 system 时，系统深浅变化可被实时解析', () => {
    const media = installMatchMedia(false); // 初始深色
    expect(resolveTheme('system')).toBe('dark');
    media.setPrefersLight(true); // 系统切浅色
    expect(resolveTheme('system')).toBe('light');
  });

  it('localStorage 不可用时安全回退（不抛异常）', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
      clear: () => undefined,
    });
    expect(() => useUiStore.getState().setThemePreference('dark')).not.toThrow();
    expect(useUiStore.getState().theme).toBe('dark');
  });
});

describe('主题预设注册表', () => {
  it('id 唯一，循环序列与注册表一致', () => {
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length);
    expect([...THEME_CYCLE]).toEqual([...THEME_IDS]);
  });

  it('每套都带三色预览与合法的 hex（下拉色卡靠它渲染）', () => {
    for (const preset of [...LIGHT_THEMES, ...DARK_THEMES]) {
      expect(preset.swatch).toHaveLength(3);
      for (const color of preset.swatch) expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(themeSchemeOf(preset.id)).toBe(preset.scheme);
    }
  });

  it('浅色与深色各不少于两套（主题可切换的产品底线）', () => {
    expect(LIGHT_THEMES.length).toBeGreaterThanOrEqual(2);
    expect(DARK_THEMES.length).toBeGreaterThanOrEqual(2);
  });

  it('类型守卫：已知 id 通过，未知值与 null 拒绝', () => {
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('chiikawa')).toBe(true);
    expect(isThemePreference('nothing')).toBe(true);
    expect(isThemePreference('neon-pink')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  it('旧持久化值 dark / light / aurora 仍然合法（不破坏老用户选择）', () => {
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('aurora')).toBe(true);
  });
});
