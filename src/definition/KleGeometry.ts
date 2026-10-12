// KLE 几何：KLE 行数组 → KleKey[]（游标累加、异形键、行压紧，架构 §8.6 / A3）。
import type { KleItem, KleKey, KleProps, KleRow, MatrixPos, Rect } from './schema';

export const UNIT = 54;
export const GAP = 4;
export const DEFAULT_KEY_COLOR = '#cccccc';

export interface ParsedKeyName {
  readonly matrix: MatrixPos;
  readonly group: number | null;
  readonly option: number | null;
}

/** 键名解析："0,14\n\n\n0,1" → matrix {0,14} + 布局选项 group=0 / option=1。 */
export function parseKeyName(text: string): ParsedKeyName {
  const parts = text.split('\n');
  const [rowStr = '0', colStr = '0'] = (parts[0] ?? '').split(',');
  const matrix: MatrixPos = {
    row: Number.parseInt(rowStr ?? '0', 10) || 0,
    col: Number.parseInt(colStr ?? '0', 10) || 0,
  };
  const legend = parts[3];
  if (parts.length >= 4 && legend !== undefined && /^\d+,\d+$/.test(legend.trim())) {
    const [g = '0', o = '0'] = legend.trim().split(',');
    return { matrix, group: Number.parseInt(g ?? '0', 10), option: Number.parseInt(o ?? '0', 10) };
  }
  return { matrix, group: null, option: null };
}

/** 键帽色 → 三档主题色（避免上百种颜色污染界面，架构 §8.6）。 */
export function colorTone(hex: string): KleKey['tone'] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  const value = m?.[1] ?? 'cccccc';
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  if (lum > 0xbb) return 'accent';
  if (lum > 0x88) return 'mod';
  if (lum > 0x55) return 'alpha';
  return 'special';
}

export function rectOf(x: number, y: number, w: number, h: number): Rect {
  return { x: x * UNIT, y: y * UNIT, w: w * UNIT - GAP, h: h * UNIT - GAP };
}

/**
 * 是否存在副矩形（异形键的第二块，如 ISO / stepped 键）。
 *
 * ⚠️ 传入的 `x2`/`y2` 已经是**绝对**坐标（computeKeys 里存的是 `cx + x2`），
 * 因此必须与主矩形的 `x`/`y` 比较，不能与 0 比较：
 * 与 0 比较会让所有不在原点（x≠0 或 y≠0）的键都被误判为异形键，
 * 从而多渲染一个与主矩形完全重合的 rect2。
 */
function hasSecondRect(k: {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly x2: number;
  readonly y2: number;
  readonly w2: number;
  readonly h2: number;
}): boolean {
  return k.x2 !== k.x || k.y2 !== k.y || k.w2 !== k.w || k.h2 !== k.h;
}

/**
 * KLE 行数组 → 键位条目（未过滤）。
 * 游标语义：`x`/`y` 为**累加**偏移；新行 `cy += 1; cx = 0`；首行 cy 初值 -1（架构 U5）。
 */
export function computeKeys(rows: readonly KleRow[]): KleKey[] {
  const out: KleKey[] = [];
  let cx = 0;
  let cy = -1;
  let w = 1;
  let h = 1;
  let x2 = 0;
  let y2 = 0;
  let w2: number | null = null;
  let h2: number | null = null;
  let color = DEFAULT_KEY_COLOR;
  let decal = false;

  for (const row of rows) {
    cy += 1;
    cx = 0;
    // decal 不跨行继承：每行开始都复位（见下方 props 块内的说明）
    decal = false;
    for (const item of row) {
      if (typeof item === 'object' && item !== null) {
        const props = item as KleProps;
        cx += props.x ?? 0;
        cy += props.y ?? 0;
        w = props.w ?? 1;
        h = props.h ?? 1;
        x2 = props.x2 ?? 0;
        y2 = props.y2 ?? 0;
        w2 = props.w2 ?? null;
        h2 = props.h2 ?? null;
        // `c`（键帽色）是 KLE 的粘性属性：跨键、跨 props 块继承，直到被下一个 c 覆盖。
        // `d`（decal 装饰键）不是粘性属性：它只对紧跟该 props 块的那些键生效，
        // 出现下一个 props 块时重新判定（缺省 false）。
        // 若把 d 也做成粘性，定义文件底行开头的 {"d":true} 会把整行（含 6u 空格）
        // 全部标记为装饰键 —— 键帽既无底色也无文字，表现为「整行空白宽格」。
        if (props.c !== undefined) color = props.c;
        decal = props.d === undefined ? false : Boolean(props.d);
        continue;
      }
      const rawText = String(item as KleItem);
      const name = parseKeyName(rawText);
      // KLE 标签：去掉矩阵坐标 / 布局选项元数据后的可见文本。
      // 格式 ① "row,col"                → 无可见标签
      // 格式 ② "row,col\n主标签"         → 主标签
      // 格式 ③ "row,col\n\n\ngroup,option\n主标签\n次标签" → 主/次标签
      // 格式 ④ "主标签"（无矩阵元数据） → 整段都是标签
      const labelParts = rawText.split('\n');
      const hasMatrix = /^\d+,\d+$/.test(labelParts[0] ?? '');
      let labelStart = 0;
      if (hasMatrix) {
        // KLE 元数据格式：
        //   行 0: "row,col" 矩阵坐标
        //   行 1-2: 空行（保留给主/副印字上方的 KLE 特殊位置）
        //   行 3: "group,option" 布局选项条件（可选）
        //   行 4+: 真实可见标签
        // 只要第 3 行存在且是 "g,o" 格式，就视为有布局选项；真实标签从第 4 行开始。
        const hasLayoutOption = labelParts.length >= 4 && /^\d+,\d+$/.test(labelParts[3] ?? '');
        labelStart = hasLayoutOption ? 4 : 1;
      }
      const labels = labelParts.slice(labelStart).filter((s) => s !== '');
      const key = {
        matrix: name.matrix,
        group: name.group,
        option: name.option,
        x: cx,
        y: cy,
        w,
        h,
        x2: cx + x2,
        y2: cy + y2,
        w2: w2 ?? w,
        h2: h2 ?? h,
        color,
        decal,
        labels,
      };
      out.push({
        ...key,
        rect: rectOf(key.x, key.y, key.w, key.h),
        rect2: hasSecondRect(key)
          ? rectOf(key.x2, key.y2, key.w2, key.h2)
          : undefined,
        tone: colorTone(color),
      });
      cx += w;
      w = 1;
      h = 1;
      x2 = 0;
      y2 = 0;
      w2 = null;
      h2 = null;
    }
  }
  return out;
}

/** 一行内的条目：常驻键（group 为 null），或某个配列变体的连续键块。 */
interface RowItem {
  readonly kind: 'fixed' | 'variant';
  readonly group: number | null;
  readonly option: number | null;
  /** 条目内各键在 all 中的下标（保持 KLE 顺序） */
  readonly indices: number[];
  /** 原始左 / 右边界（单位 u） */
  readonly left: number;
  right: number;
}

/**
 * 变体键的 x 归一化偏移：下标 → 需要平移的量（单位 u）。
 *
 * 背景：KLE 里同一「槽位」的多个配列变体是**横着排开**写的 —— 作者在前一个变体后面
 * 加一段间隔游标（本定义里行0 是 +2.25u、行1 是 +3u、行2 是 +2u、行3 是 +1.5u）
 * 再摆下一个变体。只按 layout_options 过滤掉未选中的变体后，那段间隔就变成画布
 * 中间的空洞：本定义切到「2u退格 / 大回车 / 2.25U右shift」时，行内会出现 4.25u 的洞，
 * 画布同时凭空宽出约 28%。
 *
 * 归一化规则：变体块必须**与相邻常驻键贴合**——
 *   ① 左边已有已放置的键 → 起点 = 前一个键的右边界；
 *   ② 否则（变体在行首）→ 起点 = 后方第一个常驻键的左边界 − 本变体块宽度；
 *   ③ 整行没有常驻键可参照（如底行整行就是一个变体）→ 保持自身坐标不动。
 * 常驻键（group 为 null）一律保持原始 x 作为锚点，因此不同变体之间左右对齐不会漂移。
 */
function variantXShift(
  all: readonly KleKey[],
  layoutOptions: readonly number[],
): ReadonlyMap<number, number> {
  // 按原始 y 分行（保持 KLE 书写顺序）
  const rows = new Map<number, number[]>();
  for (let i = 0; i < all.length; i += 1) {
    const y = all[i]!.y;
    const bucket = rows.get(y);
    if (bucket) bucket.push(i);
    else rows.set(y, [i]);
  }

  const shifts = new Map<number, number>();

  for (const indices of rows.values()) {
    // 切条目：连续且同 group+option 的变体键合并成一个块
    const items: RowItem[] = [];
    for (const i of indices) {
      const k = all[i]!;
      const last = items[items.length - 1];
      const isVariant = k.group !== null;
      if (
        last !== undefined &&
        isVariant &&
        last.kind === 'variant' &&
        last.group === k.group &&
        last.option === k.option
      ) {
        last.indices.push(i);
        last.right = Math.max(last.right, k.x + k.w);
        continue;
      }
      items.push({
        kind: isVariant ? 'variant' : 'fixed',
        group: k.group,
        option: k.option,
        indices: [i],
        left: k.x,
        right: k.x + k.w,
      });
    }

    let cursor: number | null = null;
    let n = 0;
    while (n < items.length) {
      const item = items[n]!;
      if (item.kind === 'fixed') {
        cursor = item.right;
        n += 1;
        continue;
      }
      // 连续的变体条目 = 同一槽位的互斥变体，只有当前生效的那个参与排版
      const slot: RowItem[] = [];
      while (n < items.length && items[n]!.kind === 'variant') slot.push(items[n++]!);
      const active = slot.find(
        (s) => s.group !== null && layoutOptions[s.group] === s.option,
      );
      if (active === undefined) continue; // 该槽位当前无变体生效（定义异常时兜底）

      const nextFixed = items.slice(n).find((s) => s.kind === 'fixed');
      let start: number;
      if (cursor !== null) start = cursor;
      else if (nextFixed !== undefined) start = nextFixed.left - (active.right - active.left);
      else start = active.left;

      const delta = start - active.left;
      if (delta !== 0) for (const i of active.indices) shifts.set(i, delta);
      cursor = active.right + delta;
    }
  }

  return shifts;
}

/**
 * 行/列压紧（架构 A3，最易漏的一步）：
 * 1) 按 layout_options 过滤出当前生效的键；
 * 2) 按离散 y 值重新分配紧凑行号——否则选中靠后的配列变体时底行会掉到下方留白；
 * 3) 把生效的配列变体沿 x 平移回它所属槽位——否则过滤掉的变体留下的
 *    间隔游标会在行中间留下空洞、并把画布撑宽（见 variantXShift 的说明）。
 */
export function compactRows(
  all: readonly KleKey[],
  layoutOptions: readonly number[],
): KleKey[] {
  const active: { readonly index: number; readonly key: KleKey }[] = [];
  for (let i = 0; i < all.length; i += 1) {
    const k = all[i]!;
    if (k.group === null || layoutOptions[k.group] === k.option) active.push({ index: i, key: k });
  }
  const ys = [...new Set(active.map(({ key }) => key.y))].sort((a, b) => a - b);
  const yMap = new Map(ys.map((y, i) => [y, i]));
  const shifts = variantXShift(all, layoutOptions);
  return active.map(({ index, key: k }) => {
    const y = yMap.get(k.y) ?? k.y;
    const y2 = yMap.get(k.y2) ?? k.y2;
    // x2 是绝对坐标，必须与 x 同步平移，否则异形键的第二块会错位
    const delta = shifts.get(index) ?? 0;
    const base = { ...k, x: k.x + delta, x2: k.x2 + delta, y, y2 };
    return {
      ...base,
      rect: rectOf(base.x, base.y, base.w, base.h),
      rect2: hasSecondRect(base) ? rectOf(base.x2, base.y2, base.w2, base.h2) : undefined,
    };
  });
}

/** 画布包围盒（像素）：原点 + 尺寸。 */
export interface BoundingBox {
  /** 包围盒左边界（像素）；渲染时需要把它当作原点平移掉 */
  readonly minX: number;
  /** 包围盒上边界（像素） */
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * 画布包围盒（像素）。
 *
 * ⚠️ 必须同时给出 minX/minY：
 * KLE 的坐标原点是「整个编辑区」，而不是「可见键帽的左上角」——本定义可见键 x ∈ [2.75u, 17.75u]，
 * 左侧 2.75u 是死区（KLE 显式写了 x:2.75，另有被过滤掉的变体键占用了游标）。
 * 只取 max(right) 会让画布凭空宽出 18.5%，键盘整体右移、右侧更早被容器截断。
 * 消费方渲染时要把每个键的坐标减去 minX/minY（见 KeymapCanvas / KeyTester）。
 */
export function boundingBox(keys: readonly KleKey[]): BoundingBox {
  if (keys.length === 0) return { minX: 0, minY: 0, width: 0, height: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const k of keys) {
    for (const r of [k.rect, k.rect2]) {
      if (!r) continue;
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    }
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/** 缩放系数：容器宽 / 包围盒宽，钳制在 [0.5, 1.2]。 */
export function fitScale(boxWidth: number, containerWidth: number): number {
  if (boxWidth <= 0 || containerWidth <= 0) return 1;
  return Math.min(1.2, Math.max(0.5, containerWidth / boxWidth));
}
