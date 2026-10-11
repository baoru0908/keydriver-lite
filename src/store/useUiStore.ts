// UI 偏好状态：主题、当前面板、侧栏折叠、色空间与值宽度/自定义键码基址等校准项（Q3/Q4/A5）。
import { create } from 'zustand';
// 主题预设单一数据源：类型与循环顺序都来自 ui/layout/themes.ts，避免两处漂移。
import { THEME_CYCLE, isThemePreference, type ThemeMode, type ThemePreference } from '@/ui/layout/themes';

/** 已解析的实际主题（挂载到 <html> 的 class）。 */
export type { ThemeMode, ThemePreference };
export type PanelId = 'keymap' | 'layout' | 'debug' | 'menu' | 'backup' | 'device' | 'macros';
export type ColorSpace = 'hsv' | 'rgb' | 'grb';

const THEME_KEY = 'keydriver:theme';
const PREF_KEY = 'keydriver:uiPrefs';

interface UiPrefs {
  colorSpace: ColorSpace;
  customKeycodeBase: number;
  keymapScale: number;
}

const DEFAULT_PREFS: UiPrefs = {
  colorSpace: 'hsv',
  customKeycodeBase: 0x7e00,
  keymapScale: 1,
};

interface UiState extends UiPrefs {
  /** 已解析的实际主题（组件只消费它做视觉判断） */
  theme: ThemeMode;
  /** 用户偏好（持久化）：system 或某个主题预设 id */
  themePreference: ThemePreference;
  currentPanel: PanelId;
  sidebarOpen: boolean;
  /** 右侧键码面板是否展开 */
  keycodePanelOpen: boolean;
  /** 正在等待键码选择的控件来源（'keymap' 或某个 controlId） */
  keycodeTarget: string | null;
  importDialogOpen: boolean;
  /** 快捷键帮助弹窗（T06-9：TopBar 入口与 ⌘/ 共用） */
  hotkeyHelpOpen: boolean;
  /** 当前打开的自定义菜单 id（来自定义文件，零硬编码） */
  currentMenuId: string | null;
  setThemePreference: (pref: ThemePreference) => void;
  /** 在主题预设之间循环（手动选择，写入偏好） */
  toggleTheme: () => void;
  setCurrentPanel: (panel: PanelId) => void;
  toggleSidebar: (open?: boolean) => void;
  setKeycodePanelOpen: (open: boolean) => void;
  requestKeycode: (target: string) => void;
  clearKeycodeTarget: () => void;
  setImportDialogOpen: (open: boolean) => void;
  setHotkeyHelpOpen: (open: boolean) => void;
  setCurrentMenuId: (menuId: string | null) => void;
  /** 一步切换到某个菜单面板（左侧导航用） */
  openMenu: (menuId: string) => void;
  setPref: <K extends keyof UiPrefs>(key: K, value: UiPrefs[K]) => void;
}

function loadPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<UiPrefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: UiPrefs): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {
    // 持久化失败不影响本次会话
  }
}

/** 读系统偏好（无 matchMedia / 服务端渲染环境回退深色）。 */
function systemTheme(): ThemeMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * 读取持久化的主题偏好。
 * 兼容策略：旧版本存的是 'dark' / 'light' / 'aurora'，这些 id 至今仍合法，直接沿用；
 * 任何非法值（手改 / 旧实验值）一律回落 system，避免挂上不存在的 class 变成无样式。
 */
function loadThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (isThemePreference(saved)) return saved;
  } catch {
    // localStorage 不可用：默认跟随系统
  }
  return 'system';
}

function saveThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    // 持久化失败只影响下次启动，不影响本次会话
  }
}

/** 偏好 → 实际主题（system 走系统查询）。 */
export function resolveTheme(pref: ThemePreference): ThemeMode {
  return pref === 'system' ? systemTheme() : pref;
}

export const useUiStore = create<UiState>((set, get) => ({
  ...loadPrefs(),
  themePreference: loadThemePreference(),
  theme: resolveTheme(loadThemePreference()),
  currentPanel: 'keymap',
  sidebarOpen: true,
  keycodePanelOpen: true,
  keycodeTarget: null,
  importDialogOpen: false,
  hotkeyHelpOpen: false,
  currentMenuId: null,

  setThemePreference: (pref) => {
    saveThemePreference(pref);
    set({ themePreference: pref, theme: resolveTheme(pref) });
  },

  toggleTheme: () => {
    const current = get().theme;
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length] ?? 'dark';
    saveThemePreference(next);
    set({ themePreference: next, theme: next });
  },

  setCurrentPanel: (currentPanel) => set({ currentPanel }),
  toggleSidebar: (open) => set((s) => ({ sidebarOpen: open ?? !s.sidebarOpen })),
  setKeycodePanelOpen: (keycodePanelOpen) => set({ keycodePanelOpen }),
  requestKeycode: (keycodeTarget) => set({ keycodeTarget, keycodePanelOpen: true }),
  clearKeycodeTarget: () => set({ keycodeTarget: null }),
  setImportDialogOpen: (importDialogOpen) => set({ importDialogOpen }),
  setHotkeyHelpOpen: (hotkeyHelpOpen) => set({ hotkeyHelpOpen }),
  setCurrentMenuId: (currentMenuId) => set({ currentMenuId }),
  openMenu: (menuId) => set({ currentMenuId: menuId, currentPanel: 'menu', keycodeTarget: null }),

  setPref: (key, value) => {
    set({ [key]: value } as Partial<UiState>);
    const s = get();
    savePrefs({ colorSpace: s.colorSpace, customKeycodeBase: s.customKeycodeBase, keymapScale: s.keymapScale });
  },
}));
