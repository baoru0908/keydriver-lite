// VIA V3 定义文件的原始类型与归一化产物类型（架构 §4.2.1 / §4.2.2 权威版本）。

/** 定义文件原始形态（VIA V3） */
export interface ViaDefinition {
  name: string;
  vendorId: string; // 十六进制字符串，如 "0x1234"
  productId: string; // 十六进制字符串，如 "0x0001"
  matrix: { rows: number; cols: number };
  customKeycodes?: CustomKeycode[];
  menus?: MenuEntryRaw[];
  layouts: {
    labels?: LayoutLabel[];
    keymap: KleRow[];
  };
  /** V2 遗留字段，V3 不再使用，解析时忽略并告警 */
  lighting?: unknown;
}

export interface CustomKeycode {
  /** 键码面板显示名 */
  name: string;
  /** 完整名 */
  title: string;
  /** 键帽短名，可含换行 */
  shortName: string;
}

/** string = 2 选开关（组名即标签）；string[] = n 选（[0] 是组名，[1..] 是选项） */
export type LayoutLabel = string | string[];

export type KleRow = KleItem[];
export type KleItem = string | KleProps;

/** KLE 属性对象；字段名均为 KLE 单字母缩写 */
export interface KleProps {
  x?: number;
  y?: number; // 累加偏移（单位 u）
  w?: number;
  h?: number; // 键宽高，默认 1
  x2?: number;
  y2?: number; // 第二矩形偏移，默认 0
  w2?: number;
  h2?: number; // 第二矩形宽高，默认等于 w/h
  c?: string; // 键帽颜色 hex
  d?: boolean; // decal：装饰键，不参与改键
  r?: number;
  rx?: number;
  ry?: number; // 旋转（本期渲染忽略，仅保留数据）
}

/**
 * menus 原始节点。三种形态：
 *  1) 分组：     { label, content: MenuNodeRaw[] }
 *  2) 条件分组： { showIf, content: MenuNodeRaw[] }   ← 可无 label
 *  3) 控件：     { label, type, options?, content: ValueContent, showIf? }
 * 判别规则：有 `type` 即为控件；否则为分组。
 */

/** 六类导航分组 id（Wootility 风格导航基准，架构 §UI-NAV）。 */
export type CategoryId = 'keycaps' | 'lighting' | 'actuation' | 'macros' | 'profiles' | 'device';

/**
 * menus 元素：既可以是内联菜单对象，也可以是官方预设菜单的 id 字符串
 * （官方 the-via/app 的 menusSlice.tryResolveCommonMenu 会把字符串展开成完整菜单）。
 */
export type MenuEntryRaw = MenuNodeRaw | string;

export interface MenuNodeRaw {
  label?: string;
  /** 六类导航分组归属（来自定义文件，零硬编码；缺省表示不进入分类导航） */
  category?: CategoryId;
  type?: string;
  options?: unknown;
  content?: MenuNodeRaw[] | ValueContent;
  showIf?: string;
  /** 兼容 VIA 官方文档的 children 写法（架构 F3） */
  children?: MenuNodeRaw[];
}

/** content 数组：[valueKey, channel, valueId, index?, index2?]，长度 3/4/5 */
export type ValueContent = [string, number, number, ...number[]];

export type ControlType = 'dropdown' | 'range' | 'toggle' | 'button' | 'color' | 'keycode';

/** 归一化后的值地址。key = `${channel}:${valueId}:${indexes.join('.')}` */
export interface ValueAddress {
  readonly channel: number;
  readonly valueId: number;
  readonly indexes: readonly number[];
  readonly key: string;
}

export type ControlOptions =
  | { readonly kind: 'none' }
  | { readonly kind: 'range'; readonly min: number; readonly max: number }
  /** 归一化形态：string[] 会被转成 { label, value }[] */
  | {
      readonly kind: 'enum';
      readonly items: ReadonlyArray<{ readonly label: string; readonly value: number }>;
    }
  /** button 的动作参数，原样透传 */
  | { readonly kind: 'action'; readonly args: readonly number[] };

export interface ControlSpec {
  /** 稳定唯一 ID（F1：不可用 valueKey）。格式 `${menuId}/${path.join('/')}#${seq}` */
  readonly id: string;
  /** content[0]，仅作 showIf 变量名，可能重复 */
  readonly valueKey: string;
  readonly label: string;
  readonly type: ControlType;
  readonly options: ControlOptions;
  readonly address: ValueAddress;
  readonly showIf?: string;
  readonly menuId: string;
  /** 分组路径（菜单名 + 各级分组名，均来自定义文件） */
  readonly path: readonly string[];
  /** 由 ValueWidth.infer 得出的字节宽度（1 / 2 / 3） */
  readonly widthHint: number;
}

export interface MenuGroupNode {
  readonly kind: 'group';
  readonly id: string;
  /** 可缺省（条件分组，架构 F2） */
  readonly label?: string;
  readonly showIf?: string;
  readonly children: readonly MenuNode[];
  readonly controlCount: number;
}

export interface MenuLeafNode {
  readonly kind: 'control';
  readonly control: ControlSpec;
}

export type MenuNode = MenuGroupNode | MenuLeafNode;

export interface MenuDef {
  /** 内部唯一 ID（格式 `m${index}`），与 label 无关：同名顶层菜单也不会撞车 */
  readonly id: string; // `m${index}`
  readonly label: string;
  /** 六类导航分组归属（来自定义文件） */
  readonly category?: CategoryId;
  /** 由官方预设菜单展开而来时的预设 id；内联菜单为 undefined */
  readonly commonKey?: string;
  readonly root: MenuGroupNode;
  /** 该菜单下全部控件（含被 showIf 隐藏的），供懒加载与导出使用 */
  readonly controls: readonly ControlSpec[];
}

export interface MatrixPos {
  readonly row: number;
  readonly col: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface KleKey {
  readonly matrix: MatrixPos;
  /** 布局选项组/选项；null 表示无条件生效 */
  readonly group: number | null;
  readonly option: number | null;
  /** 归一化后的逻辑坐标（单位 u，已行压紧） */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly x2: number;
  readonly y2: number;
  readonly w2: number;
  readonly h2: number;
  readonly color: string;
  readonly decal: boolean;
  /**
   * KLE 原始标签，按 '\n' 分割后的数组。
   * KLE 约定：第 0 项是主标签（键帽正面），第 1 项常为 shift / Fn 层标签。
   * 若定义文件未提供标签（如纯矩阵坐标 "0,0"），数组为空。
   */
  readonly labels: readonly string[];
  /** 像素矩形（UNIT=54, GAP=4） */
  readonly rect: Rect;
  readonly rect2?: Rect;
  /** 键帽色三档映射结果（架构 §8.6） */
  readonly tone: 'accent' | 'mod' | 'alpha' | 'special';
}

/**
 * 布局选项组的形态（来自 labels 的形态，VIA 规范）：
 * - 'toggle'：labels 元素为 string —— 2 选开关，组名即标签，取值 0 / 1；
 * - 'select'：labels 元素为 string[] —— n 选下拉，[0] 是组名、[1..] 是选项名。
 */
export type LayoutOptionKind = 'toggle' | 'select';

export interface LayoutOptionGroup {
  readonly index: number;
  readonly label: string;
  /** 决定 UI 用开关还是下拉（不再靠 options.length 猜测，避免 2 选项的 n 选被降级成开关） */
  readonly kind: LayoutOptionKind;
  readonly options: readonly string[];
  readonly bitWidth: number;
  readonly bitOffset: number;
}

export interface DefinitionIssue {
  readonly level: 'error' | 'warn';
  readonly path: string; // 'menus[2].content[5].content'
  readonly message: string;
}

export interface ParsedDefinition {
  readonly raw: ViaDefinition;
  readonly name: string;
  readonly vid: number;
  readonly pid: number;
  readonly matrix: { readonly rows: number; readonly cols: number };
  readonly menus: readonly MenuDef[];
  readonly controls: readonly ControlSpec[];
  readonly controlById: ReadonlyMap<string, ControlSpec>;
  readonly controlsByMenu: ReadonlyMap<string, readonly ControlSpec[]>;
  /** 行压紧后 */
  readonly keys: readonly KleKey[];
  /** 未过滤的原始键位（用于调试与统计） */
  readonly allKeys: readonly KleKey[];
  readonly layoutLabels: readonly LayoutOptionGroup[];
  readonly customKeycodes: readonly CustomKeycode[];
  readonly issues: readonly DefinitionIssue[];
}

/** 控件类型集合，用于校验与统计 */
export const CONTROL_TYPES: readonly ControlType[] = [
  'keycode',
  'toggle',
  'range',
  'dropdown',
  'button',
  'color',
];
