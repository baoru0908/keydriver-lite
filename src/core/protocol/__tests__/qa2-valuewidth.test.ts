// QA2 高危点 1：值宽度推断必须与 min 完全解耦，且手工覆盖表优先于推断规则。
// 断言基线取自目标定义文件的实测统计（不重新推导）。
// 注：与 qa-valuewidth.test.ts 为同主题的两份独立验证，本文件侧重「min 解耦 + 覆盖表优先级 + 持久化」。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRealParsedDefinition } from '@/definition/__tests__/fixtures/realDefinition';
import {
  clearOverrides,
  inferWidth,
  loadOverrides,
  saveOverride,
  type WidthOverrides,
} from '@/core/protocol/ValueWidth';
import { addressKey } from '@/core/protocol/CustomValueCodec';
import type { ControlSpec } from '@/definition/schema';

type RangeOptions = { readonly kind: 'range'; readonly min: number; readonly max: number };

function ranges(): ControlSpec[] {
  return loadRealParsedDefinition().controls.filter((c) => c.type === 'range');
}

function rangeOptions(c: ControlSpec): RangeOptions {
  return c.options as RangeOptions;
}

function makeRange(min: number, max: number, channel = 0, valueId = 1): ControlSpec {
  return {
    id: `t/${min}-${max}`,
    valueKey: `vk_${min}_${max}`,
    label: `range ${min}-${max}`,
    type: 'range',
    options: { kind: 'range', min, max },
    address: { channel, valueId, indexes: [], key: `${channel}:${valueId}:` },
    menuId: 'm0',
    path: ['t'],
    widthHint: 0,
  };
}

/** 统计 [min,max] 组合出现次数。 */
function comboHistogram(list: readonly ControlSpec[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of list) {
    const { min, max } = rangeOptions(c);
    const k = `[${min},${max}]`;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

describe('QA2-1 值宽度推断与 min 解耦（真实定义文件）', () => {
  it('78 个 range 的组合分布与实测基线一致', () => {
    const list = ranges();
    expect(list).toHaveLength(78);
    expect(comboHistogram(list)).toEqual({
      '[0,255]': 21,
      '[1,255]': 22,
      '[0,1000]': 22,
      '[1,1000]': 10,
      '[1,1023]': 3,
    });
  });

  it('min 维度与字节宽度维度各自计数相同（43/35），但两集合交集仅 13 个 —— 证明二者无关', () => {
    const list = ranges();
    const minZero = list.filter((c) => rangeOptions(c).min === 0);
    const minOne = list.filter((c) => rangeOptions(c).min === 1);
    const w1 = list.filter((c) => inferWidth(c, {}) === 1);
    const w2 = list.filter((c) => inferWidth(c, {}) === 2);

    // 两个 35 是数值巧合：若实现按 min 推导宽度，这里必然对不上。
    expect({ minZero: minZero.length, minOne: minOne.length }).toEqual({ minZero: 43, minOne: 35 });
    expect({ w1: w1.length, w2: w2.length }).toEqual({ w1: 43, w2: 35 });

    const minOneAnd2Bytes = list.filter(
      (c) => rangeOptions(c).min === 1 && inferWidth(c, {}) === 2,
    );
    expect(minOneAnd2Bytes).toHaveLength(13);
    expect(minOneAnd2Bytes.length).toBeLessThan(minOne.length);
  });

  it('若误用「min=1 即 2 字节」推导，78 个里会错 44 个（误判面量化）', () => {
    const list = ranges();
    const misjudged = list.filter((c) => {
      const { min } = rangeOptions(c);
      const byMin = min === 1 ? 2 : 1;
      return byMin !== inferWidth(c, {});
    });
    expect(misjudged).toHaveLength(44);
  });

  it('关键对照对：[1,255] → 1 字节，[1,1023] → 2 字节（min 相同但宽度不同）', () => {
    const a = makeRange(1, 255);
    const b = makeRange(1, 1023);
    expect(rangeOptions(a).min).toBe(rangeOptions(b).min);
    expect(inferWidth(a, {})).toBe(1);
    expect(inferWidth(b, {})).toBe(2);
    expect(inferWidth(a, {})).not.toBe(inferWidth(b, {}));
  });

  it('[0,1000]（min=0）→ 2 字节', () => {
    expect(inferWidth(makeRange(0, 1000), {})).toBe(2);
  });

  it('每个 [min,max] 组合的推断宽度必须与实测一致（逐组合快照）', () => {
    const seen = new Map<string, number>();
    for (const c of ranges()) {
      const { min, max } = rangeOptions(c);
      seen.set(`[${min},${max}]`, inferWidth(c, {}));
    }
    expect(Object.fromEntries([...seen.entries()].sort())).toEqual({
      '[0,1000]': 2,
      '[0,255]': 1,
      '[1,1000]': 2,
      '[1,1023]': 2,
      '[1,255]': 1,
    });
  });

  it('全量 78 个 range：宽度恒等于 max>255?2:1', () => {
    for (const c of ranges()) {
      const { max } = rangeOptions(c);
      expect(inferWidth(c, {})).toBe(max > 255 ? 2 : 1);
    }
  });

  it('min 分组内同时存在 1 字节与 2 字节（min=0 与 min=1 都是混合分布）', () => {
    const list = ranges();
    for (const m of [0, 1]) {
      const group = list.filter((c) => rangeOptions(c).min === m);
      const widths = new Set(group.map((c) => inferWidth(c, {})));
      expect([...widths].sort()).toEqual([1, 2]);
    }
  });

  it('边界：max=255→1 字节，max=256→2 字节（阈值恰在 255/256 之间）', () => {
    expect(inferWidth(makeRange(0, 255), {})).toBe(1);
    expect(inferWidth(makeRange(1, 255), {})).toBe(1);
    expect(inferWidth(makeRange(0, 256), {})).toBe(2);
    expect(inferWidth(makeRange(1, 256), {})).toBe(2);
    expect(inferWidth(makeRange(0, 65535), {})).toBe(2);
  });

  it('其它控件类型固定宽度：keycode=2 / color=3 / toggle=1 / button=1', () => {
    const base = {
      id: 'x',
      valueKey: 'vk',
      label: 'l',
      options: { kind: 'none' as const },
      address: { channel: 0, valueId: 1, indexes: [], key: '0:1:' },
      menuId: 'm0',
      path: [],
      widthHint: 0,
    };
    expect(inferWidth({ ...base, type: 'keycode' }, {})).toBe(2);
    expect(inferWidth({ ...base, type: 'color' }, {})).toBe(2);
    expect(inferWidth({ ...base, type: 'toggle' }, {})).toBe(1);
    expect(inferWidth({ ...base, type: 'button' }, {})).toBe(1);
  });

  it('dropdown 按最大枚举值判定宽度（>255 → 2 字节）', () => {
    const base = {
      id: 'x',
      valueKey: 'vk',
      label: 'l',
      type: 'dropdown' as const,
      address: { channel: 0, valueId: 1, indexes: [], key: '0:1:' },
      menuId: 'm0',
      path: [],
      widthHint: 0,
    };
    expect(
      inferWidth(
        { ...base, options: { kind: 'enum', items: [{ label: 'a', value: 0 }, { label: 'b', value: 255 }] } },
        {},
      ),
    ).toBe(1);
    expect(
      inferWidth(
        { ...base, options: { kind: 'enum', items: [{ label: 'a', value: 0 }, { label: 'b', value: 1023 }] } },
        {},
      ),
    ).toBe(2);
  });
});

describe('QA2-1 手工覆盖表优先于推断规则', () => {
  it('地址键覆盖优先于推断：max=255 的 range 可被强制为 2 字节', () => {
    const c = makeRange(1, 255);
    expect(inferWidth(c, {})).toBe(1);
    expect(inferWidth(c, { [addressKey(c.address)]: 2 })).toBe(2);
    expect(inferWidth(c, { [addressKey(c.address)]: 1 })).toBe(1);
  });

  it('地址键覆盖优先于 valueKey 覆盖（两者同时命中时以地址键为准）', () => {
    const c = makeRange(1, 255);
    const overrides: WidthOverrides = { [addressKey(c.address)]: 2, [c.valueKey]: 1 };
    expect(inferWidth(c, overrides)).toBe(2);
  });

  it('无地址键覆盖时回退到 valueKey 覆盖', () => {
    const c = makeRange(1, 255);
    expect(inferWidth(c, { [c.valueKey]: 2 })).toBe(2);
    expect(inferWidth(c, { [c.valueKey]: 3 })).toBe(3);
  });

  it('覆盖值对 button/color 等固定宽度类型同样生效（覆盖优先于类型规则）', () => {
    const btn: ControlSpec = {
      id: 'b',
      valueKey: 'vk',
      label: 'b',
      type: 'button',
      options: { kind: 'action', args: [1] },
      address: { channel: 0, valueId: 4, indexes: [], key: '0:4:' },
      menuId: 'm0',
      path: [],
      widthHint: 0,
    };
    expect(inferWidth(btn, {})).toBe(1);
    expect(inferWidth(btn, { '0:4:': 2 })).toBe(2);
  });

  it('覆盖表对真实定义文件全局生效：全部 78 个 range 强制 2 字节后无例外', () => {
    const list = ranges();
    const overrides: Record<string, number> = {};
    for (const c of list) overrides[addressKey(c.address)] = 2;
    for (const c of list) expect(inferWidth(c, overrides)).toBe(2);
  });
});

describe('QA2-1 覆盖表持久化（loadOverrides / saveOverride / clearOverrides）', () => {
  const store = new Map<string, string>();
  const fakeLocalStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };

  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = fakeLocalStorage;
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    store.clear();
  });

  it('saveOverride 写入后可被 loadOverrides 读回，并影响 inferWidth', () => {
    const c = makeRange(1, 255, 3, 7);
    expect(loadOverrides()).toEqual({});
    saveOverride(addressKey(c.address), 2);
    expect(loadOverrides()[addressKey(c.address)]).toBe(2);
    expect(inferWidth(c)).toBe(2);
  });

  it('saveOverride 是增量合并，不覆盖既有键', () => {
    saveOverride('0:1:', 2);
    saveOverride('0:2:', 1);
    expect(loadOverrides()).toEqual({ '0:1:': 2, '0:2:': 1 });
  });

  it('loadOverrides 过滤非法值：非数字、0、负数、>4 一律丢弃', () => {
    store.set('keydriver:valueWidthOverrides', JSON.stringify({ a: 1, b: 0, c: 5, d: -1, e: '2', f: 2 }));
    expect(loadOverrides()).toEqual({ a: 1, f: 2 });
  });

  it('损坏的 JSON 与空内容返回空表，不抛异常', () => {
    store.set('keydriver:valueWidthOverrides', '{ not json');
    expect(loadOverrides()).toEqual({});
    store.set('keydriver:valueWidthOverrides', JSON.stringify(null));
    expect(loadOverrides()).toEqual({});
    store.set('keydriver:valueWidthOverrides', '');
    expect(loadOverrides()).toEqual({});
  });

  it('clearOverrides 清空持久化，随后 inferWidth 回落到推断规则', () => {
    const c = makeRange(1, 255, 3, 7);
    saveOverride(addressKey(c.address), 2);
    expect(inferWidth(c)).toBe(2);
    clearOverrides();
    expect(loadOverrides()).toEqual({});
    expect(inferWidth(c)).toBe(1);
  });
});
