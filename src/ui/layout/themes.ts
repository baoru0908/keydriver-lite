// 主题预设注册表：新增主题 = 这里加一条 + index.css 加一组变量覆盖，其余零改动。
//
// 设计约定：
//  · id 即 CSS class 后缀（`html.theme-<id>`）与持久化值，故必须稳定——dark/light/aurora 沿用旧值，
//    保证老用户的 localStorage 选择不失效；新增主题用新 id。
//  · scheme 决定原生控件配色（colorScheme）与下拉分组，不等于「看起来深浅」。
//  · swatch 是下拉里的三色预览（底色 / 表面 / 强调），取值与 CSS 令牌保持一致，避免两处漂移。

/** 已解析的实际主题（挂载到 <html> 的 class）。 */
export type ThemeMode =
  | 'dark'
  | 'light'
  | 'aurora'
  | 'nothing'
  | 'nothing-light'
  | 'cyber'
  | 'chiikawa'
  | 'matcha'
  | 'milk';

/** 用户偏好：system = 跟随系统并实时响应变化；其余为手动锁定。 */
export type ThemePreference = 'system' | ThemeMode;

export interface ThemePreset {
  readonly id: ThemeMode;
  /** 下拉显示名（中文优先，与产品文案一致） */
  readonly label: string;
  /** 一句话气质说明，帮用户判断要不要切 */
  readonly hint: string;
  /** 明暗归属：决定 colorScheme 与下拉分组 */
  readonly scheme: 'light' | 'dark';
  /** 三色预览：底色 / 表面 / 强调色 */
  readonly swatch: readonly [string, string, string];
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  // —— 浅色组 ——
  {
    id: 'light',
    label: '晴昼',
    hint: '明亮通透 · 通用浅色',
    scheme: 'light',
    swatch: ['#f4f6fa', '#ffffff', '#1fa894'],
  },
  {
    id: 'chiikawa',
    label: '吉伊卡哇',
    hint: '奶油底 + 樱花粉 · 大圆角软阴影',
    scheme: 'light',
    swatch: ['#fff8ec', '#ffe4ec', '#c9245e'],
  },
  {
    id: 'matcha',
    label: '抹茶',
    hint: '米白配抹茶绿 · 柔和自然',
    scheme: 'light',
    swatch: ['#f4f7ee', '#e2f0d6', '#4f7a35'],
  },
  {
    id: 'milk',
    label: '奶茶',
    hint: '暖棕奶调 · 低饱和耐看',
    scheme: 'light',
    swatch: ['#f7f1e8', '#f3e3d2', '#8f5a33'],
  },
  {
    id: 'nothing-light',
    label: 'Nothing 浅',
    hint: '白底点阵 · 直角硬边红点',
    scheme: 'light',
    swatch: ['#ffffff', '#f4f4f5', '#ff3b30'],
  },
  // —— 深色组 ——
  {
    id: 'dark',
    label: '午夜',
    hint: '低光舒适 · 通用深色',
    scheme: 'dark',
    swatch: ['#0f1115', '#161a21', '#4dd4c0'],
  },
  {
    id: 'aurora',
    label: '极光',
    hint: '青紫渐变 · 冷调发光',
    scheme: 'dark',
    swatch: ['#10131f', '#171b2b', '#7c8cff'],
  },
  {
    id: 'nothing',
    label: 'Nothing',
    hint: '纯黑点阵 · 零模糊直角红点',
    scheme: 'dark',
    swatch: ['#000000', '#111111', '#ff3b30'],
  },
  {
    id: 'cyber',
    label: '赛博霓虹',
    hint: '品红青霓虹 · 强发光',
    scheme: 'dark',
    swatch: ['#080a14', '#0e1220', '#ff4fd8'],
  },
];

/** 全部主题 id（挂载 class / 摘除旧 class 时用）。 */
export const THEME_IDS: readonly ThemeMode[] = THEME_PRESETS.map((p) => p.id);

/** 循环顺序（快捷键 / 旧切换按钮共用）：浅色组 → 深色组。 */
export const THEME_CYCLE: readonly ThemeMode[] = THEME_IDS;

export const LIGHT_THEMES: readonly ThemePreset[] = THEME_PRESETS.filter((p) => p.scheme === 'light');
export const DARK_THEMES: readonly ThemePreset[] = THEME_PRESETS.filter((p) => p.scheme === 'dark');

/** 类型守卫：把持久化里的任意字符串收敛为合法主题（非法值一律回退 system）。 */
export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && THEME_PRESETS.some((p) => p.id === value);
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || isThemeMode(value);
}

/** 取预设；id 非法时回退到 dark（调用方保证只传合法值，这里是防御性兜底）。 */
export function themePresetOf(id: ThemeMode): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) ?? (THEME_PRESETS[4] as ThemePreset);
}

/** 主题归属的明暗：决定原生滚动条 / 表单控件配色。 */
export function themeSchemeOf(id: ThemeMode): 'light' | 'dark' {
  return themePresetOf(id).scheme;
}
