// 值宽度推断 + 覆盖表 + 写后回读自校验（架构 §8.3 / Q3 / 风险 R1）。
import type { ControlSpec, ValueAddress } from '@/definition/schema';
import { addressKey } from './CustomValueCodec';

const STORAGE_KEY = 'keydriver:valueWidthOverrides';

export type WidthOverrides = Readonly<Record<string, number>>;

/** 仅依赖读/写两个方法，避免与 ViaProtocol 形成循环 import。 */
export interface ValueIo {
  customGetValue(addr: ValueAddress, width: number): Promise<number>;
  customSetValue(addr: ValueAddress, value: number, width: number): Promise<void>;
}

export interface VerifyResult {
  readonly ok: boolean;
  readonly width: number;
  readonly readBack: number;
  /** 回读不一致时给出的建议宽度 */
  readonly suggestedWidth?: number;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 读取持久化的宽度覆盖表。 */
export function loadOverrides(): WidthOverrides {
  const store = safeStorage();
  if (!store) return {};
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && v >= 1 && v <= 4) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** 写入覆盖表并持久化（按地址键或 valueKey）。 */
export function saveOverride(key: string, width: number): WidthOverrides {
  const store = safeStorage();
  const next: Record<string, number> = { ...loadOverrides(), [key]: width };
  if (store) {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 持久化失败不阻断内存态
    }
  }
  return next;
}

export function clearOverrides(): void {
  const store = safeStorage();
  if (store) {
    try {
      store.removeItem(STORAGE_KEY);
    } catch {
      // 忽略
    }
  }
}

/**
 * 推断控件值的字节宽度（架构 §8.3 的权威规则）：
 *  1) 显式覆盖优先（先按地址键，再按 valueKey）
 *  2) keycode=2 / color=2 / toggle=1 / button=1
 *  3) range、dropdown 按上限判定：> 255 → 2 字节
 */
export function inferWidth(control: ControlSpec, overrides: WidthOverrides = loadOverrides()): number {
  const byAddress = overrides[addressKey(control.address)];
  if (byAddress !== undefined) return byAddress;
  const byValueKey = overrides[control.valueKey];
  if (byValueKey !== undefined) return byValueKey;

  switch (control.type) {
    case 'keycode':
      return 2;
    case 'color':
      // QMK RGB Matrix 语义（VIA 官方一致）：color = [hue, sat] 两个字节
      return 2;
    case 'toggle':
      return 1;
    case 'button':
      return 1;
    case 'range': {
      if (control.options.kind !== 'range') return 1;
      return control.options.max > 255 ? 2 : 1;
    }
    case 'dropdown': {
      if (control.options.kind !== 'enum') return 1;
      const max = control.options.items.reduce((m, it) => Math.max(m, it.value), 0);
      return max > 255 ? 2 : 1;
    }
    default:
      return 1;
  }
}

/** 便于 UI 展示的推断说明文本。 */
export function describeWidth(control: ControlSpec, overrides: WidthOverrides = loadOverrides()): string {
  const key = addressKey(control.address);
  const w = inferWidth(control, overrides);
  const source =
    overrides[key] !== undefined ? '手动覆盖（地址）' : overrides[control.valueKey] !== undefined ? '手动覆盖（变量名）' : '自动推断';
  return `${w} 字节 · ${source}`;
}
