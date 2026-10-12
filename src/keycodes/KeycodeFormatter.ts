// keycode → 显示名（含参数化键码格式化、Custom 短名、特殊图标，架构 §8.10）。
import { QK_PAGE } from '@/core/protocol/constants';
import { toHex16Short } from '@/shared/hex';
import { KeycodeTable, CUSTOM_KEYCODE_BASE } from './KeycodeTable';
import { MOD_TAP_DEFS } from './modTap';

/** 修饰键页（LCTL/LSFT/LALT/LGUI 的 `MOD(kc)` 组合）。 */
const MOD_PAGES: readonly { readonly page: number; readonly prefix: string }[] = [
  { page: QK_PAGE.LCTL, prefix: 'LCTL' },
  { page: QK_PAGE.LSFT, prefix: 'LSFT' },
  { page: QK_PAGE.LALT, prefix: 'LALT' },
  { page: QK_PAGE.LGUI, prefix: 'LGUI' },
];

const MOD_BIT_TO_NAME = new Map<number, string>(
  MOD_TAP_DEFS.map((m) => [m.bit, m.name] as const),
);

/** 参数化键码解析结果：外层前缀 + 参数 + 内层键码。 */
export interface ParsedKeycode {
  readonly kind: 'exact' | 'mod' | 'modtap' | 'layertap' | 'layer' | 'custom' | 'raw';
  readonly prefix: string;
  readonly param?: number;
  readonly inner?: number;
  readonly def?: import('./types').KeycodeDef;
}

function innerName(inner: number): string {
  const def = KeycodeTable.byCodeMap().get(inner & 0xff);
  if (def) return def.short ?? def.label ?? def.name.replace(/^KC_/, '');
  return toHex16Short(inner);
}

/** v9 层操作页基址（keycodes_0.0.1.hjson：每类 0x20 空间，层号 5 位）。 */
const V9_LAYER_BASES: readonly { readonly base: number; readonly prefix: string }[] = [
  { base: 0x5200, prefix: 'TO' },
  { base: 0x5220, prefix: 'MO' },
  { base: 0x5240, prefix: 'DF' },
  { base: 0x5260, prefix: 'TG' },
  { base: 0x5280, prefix: 'OSL' },
  { base: 0x52a0, prefix: 'OSM' },
  { base: 0x52c0, prefix: 'TT' },
];

/**
 * 键码字典方言：0x5200–0x521F 段在旧编码下是 DF(n)、v9 下是 TO(n)，真歧义。
 * 'auto'（默认）按旧字典解析；握手读到字典版本后显式设置，或由启发式（层中出现
 * 0x5220+ 的 v9 特征键码）切换为 'v9'。
 */
export type KeycodeDialect = 'legacy' | 'v9' | 'auto';
let keycodeDialect: KeycodeDialect = 'auto';

export function setKeycodeDialect(d: KeycodeDialect): void {
  keycodeDialect = d;
}

export function getKeycodeDialect(): KeycodeDialect {
  return keycodeDialect;
}

/** 解析任意 16 位键码的结构（先精确表，再按页解析）。 */
export function parseKeycode(keycode: number): ParsedKeycode {
  const kc = keycode & 0xffff;
  // v9 方言下 0x5200–0x521F 归 TO（与旧 DF 编码重叠，只有字典版本能消除歧义）
  if (keycodeDialect === 'v9' && kc >= 0x5200 && kc < 0x5220) {
    return { kind: 'layer', prefix: 'TO', param: kc & 0x1f };
  }
  const exact = KeycodeTable.byCodeMap().get(kc);
  // 退化的 Mod-Tap 基码（MT(mod, KC_NO)）不参与精确匹配。
  // 它恰好等于 MIDI / 音序器 / 可编程按键 / RGB 等 Quantum 页的基址（0x7100/0x7200/0x7400/0x7800），
  // 命中会把固件下发的灯效键、多媒体键显示成 "RGUI_T(kc)" 这类错误名字。
  // 排除后交给下面的按页解析处理，内层为 0 时回落为原始 hex。
  const isDegenerateModTap = exact?.group === 'modtap' && (kc & 0xff) === 0x00;
  // Custom 键码优先显示键帽短名（可含换行），与键帽渲染保持一致
  if (exact && !isDegenerateModTap) {
    return {
      kind: 'exact',
      prefix: exact.group === 'custom' ? (exact.short ?? exact.label ?? exact.name) : (exact.label ?? exact.name),
      def: exact,
    };
  }

  // 修饰键组合 LCTL(kc) 等
  for (const m of MOD_PAGES) {
    if ((kc & 0xff00) === m.page) {
      return { kind: 'mod', prefix: m.prefix, inner: kc & 0xff };
    }
  }

  // Mod-Tap：QK_MOD_TAP(0x6000) | ((MOD_*) << 8) | kc，mod 占 5 位。
  //
  // ⚠️ 判定必须排除退化的内层键码：MT(mod, KC_NO=0x00) 与 MT(mod, KC_TRNS=0x01)
  // 不是有意义的按键（固件不会下发），却恰好落在 Quantum 页基址及其 +1 偏移上。
  // 若不排除，0x7100/0x7101 这类 MIDI 页键码会被误判为 Mod-Tap 并显示成 *_T(kc)。
  // 排除后：0x7100/0x7101 回落为原始值，而 0x7104（RCTL_T(A)）仍正确识别为 Mod-Tap。
  if (kc >= QK_PAGE.MOD_TAP && kc <= 0x7fff) {
    const inner = kc & 0xff;
    if (inner !== 0x00 && inner !== 0x01) {
      const modName = MOD_BIT_TO_NAME.get((kc >> 8) & 0x1f);
      if (modName) return { kind: 'modtap', prefix: `${modName}_T`, inner };
    }
  }

  // Layer-Tap：QK_LAYER_TAP(0x4000) | (layer << 8) | kc
  if ((kc & 0xf000) === QK_PAGE.LAYER_TAP) {
    return { kind: 'layertap', prefix: 'LT', param: (kc >> 8) & 0x0f, inner: kc & 0xff };
  }

  // 层操作页
  // —— QMK v9 新编码兜底（keycodes_0.0.1.hjson）——
  // v9 把层操作页改为 0x20 步进：TO=0x5200|n, MO=0x5220|n, DF=0x5240|n, TG=0x5260|n,
  // OSL=0x5280|n, OSM=0x52A0|m, TT=0x52C0|n（层号仅 5 位，0–31）。
  // 旧编码下 0x52xx 低 8 位 ≥ 0x20 的值对应 DF(32+)/DF(33+) 等非法层号（QMK 上限 16 层），
  // 合法固件永不返回 → 该区间可无歧义按 v9 解析，无需依赖字典版本握手。
  // 实证：目标固件协议 v12 但使用 v9 键码（0x5221 = MO(1)，VIA 同样显示 MO(1)）。
  if (kc >= 0x5200 && kc < 0x5300 && (kc & 0xff) >= 0x20) {
    const v9 = V9_LAYER_BASES.find((b) => kc >= b.base && kc < b.base + 0x20);
    if (v9) return { kind: 'layer', prefix: v9.prefix, param: kc & 0x1f };
  }
  // v9 的 QK_QUANTUM 基址 0x7C00（QK_BOOTLOADER）；旧编码下 0x7C00 无定义。
  if (kc === 0x7c00) {
    return { kind: 'exact', prefix: 'QK_BOOT' };
  }

  const layerPages: readonly { readonly page: number; readonly prefix: string }[] = [
    { page: QK_PAGE.TO, prefix: 'TO' },
    { page: QK_PAGE.MOMENTARY, prefix: 'MO' },
    { page: QK_PAGE.DEF_LAYER, prefix: 'DF' },
    { page: QK_PAGE.TOGGLE_LAYER, prefix: 'TG' },
    { page: QK_PAGE.ONE_SHOT_LAYER, prefix: 'OSL' },
    { page: QK_PAGE.LAYER_TAP_TOGGLE, prefix: 'TT' },
    { page: QK_PAGE.ONE_SHOT_MOD, prefix: 'OSM' },
    { page: QK_PAGE.TAP_DANCE, prefix: 'TD' },
    { page: QK_PAGE.MACRO, prefix: 'M' },
  ];
  for (const p of layerPages) {
    if ((kc & 0xff00) === p.page) {
      return { kind: 'layer', prefix: p.prefix, param: kc & 0xff };
    }
  }

  // Custom：基址 + index（架构 A5）
  if ((kc & 0xff00) === CUSTOM_KEYCODE_BASE) {
    const index = kc & 0xff;
    const def = KeycodeTable.custom()[index];
    if (def) return { kind: 'custom', prefix: def.short ?? def.label ?? def.name, def };
  }

  return { kind: 'raw', prefix: `0x${toHex16Short(kc)}` };
}

/** 完整显示名（键码面板与键帽悬浮提示使用）。 */
export function format(keycode: number): string {
  const p = parseKeycode(keycode);
  switch (p.kind) {
    case 'exact':
      return p.prefix;
    case 'mod':
      return `${p.prefix}(${innerName(p.inner ?? 0)})`;
    case 'modtap':
      return `${p.prefix}(${innerName(p.inner ?? 0)})`;
    case 'layertap':
      return `LT${p.param ?? 0}(${innerName(p.inner ?? 0)})`;
    case 'layer':
      return `${p.prefix}(${p.param ?? 0})`;
    case 'custom':
      return p.prefix;
    default:
      return p.prefix;
  }
}

/** 键帽短名：优先 shortName（可含 \n），其次截断。 */
export function formatShort(keycode: number, maxLength = 8): string {
  const text = format(keycode);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

/** 键帽显示用：把短名按换行切成两行文本。 */
export function formatKeycap(keycode: number): string[] {
  const p = parseKeycode(keycode);
  // 自定义键码的 shortName 可含换行，渲染为两行
  if (p.def?.group === 'custom' && p.def.short) return p.def.short.split('\n');
  if (p.kind === 'exact') {
    if (keycode === 0x0000) return ['✕'];
    if (keycode === 0x0001) return ['▽'];
    return [p.def?.short ?? p.def?.label ?? p.prefix];
  }
  // 层操作键：主行显示前缀，右上角小字显示层号，避免括号挤在一行变成“DF(..)”
  if (p.kind === 'layer' && p.param !== undefined) {
    return [p.prefix, String(p.param)];
  }
  return [formatShort(keycode)];
}

/** Shift 层配对：主字符 + 副字符。仅覆盖标准 ANSI 数字/符号行。 */
const SHIFT_PAIR: Record<number, { main: string; shift: string }> = {
  [0x0035]: { main: '`', shift: '~' }, // KC_GRV
  [0x001e]: { main: '1', shift: '!' }, // KC_1
  [0x001f]: { main: '2', shift: '@' }, // KC_2
  [0x0020]: { main: '3', shift: '#' }, // KC_3
  [0x0021]: { main: '4', shift: '$' }, // KC_4
  [0x0022]: { main: '5', shift: '%' }, // KC_5
  [0x0023]: { main: '6', shift: '^' }, // KC_6
  [0x0024]: { main: '7', shift: '&' }, // KC_7
  [0x0025]: { main: '8', shift: '*' }, // KC_8
  [0x0026]: { main: '9', shift: '(' }, // KC_9
  [0x0027]: { main: '0', shift: ')' }, // KC_0
  [0x002d]: { main: '-', shift: '_' }, // KC_MINS
  [0x002e]: { main: '=', shift: '+' }, // KC_EQL
  [0x002f]: { main: '[', shift: '{' }, // KC_LBRC
  [0x0030]: { main: ']', shift: '}' }, // KC_RBRC
  [0x0031]: { main: '\\', shift: '|' }, // KC_BSLS
  [0x0033]: { main: ';', shift: ':' }, // KC_SCLN
  [0x0034]: { main: "'", shift: '"' }, // KC_QUOT
  [0x0036]: { main: ',', shift: '<' }, // KC_COMM
  [0x0037]: { main: '.', shift: '>' }, // KC_DOT
  [0x0038]: { main: '/', shift: '?' }, // KC_SLSH
};

/** 取 keycode 的 shift 层配对；仅对基础 HID 键码有效，包装键码返回 undefined。 */
export function getShiftPair(keycode: number): { main: string; shift: string } | undefined {
  // 只处理基础键码（<= 0xff），避免 Mod-Tap/Layer-Tap 等包装键码被误配对
  if (keycode > 0xff) return undefined;
  return SHIFT_PAIR[keycode];
}

/** 是否为「特殊」键码（透明 / 禁用），UI 用不同底色标识。 */
export function isSpecial(keycode: number): boolean {
  return keycode === 0x0000 || keycode === 0x0001;
}
