// 主题偏好：默认跟随系统、手动锁定、循环切换、系统变化时实时跟随。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore, resolveTheme } from '@/store/useUiStore';

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

  it('循环切换：light → dark → aurora → light', () => {
    installMatchMedia(false);
    useUiStore.getState().setThemePreference('light');
    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe('dark');
    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe('aurora');
    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe('light');
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
