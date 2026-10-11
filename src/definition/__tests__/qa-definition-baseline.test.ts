// QA 独立验证 · 定义解析基线。本文件只新增用例，不改动任何已有测试文件。
// 覆盖点：controlId 唯一性、valueKey 重名陷阱、content 长度 → 索引个数、widthHint 与 inferWidth 一致性。
import { describe, expect, it } from 'vitest';
import { loadRealParsedDefinition } from './fixtures/realDefinition';
import { countGroupNodes, controlStats } from '@/definition/DefinitionParser';
import { inferWidth } from '@/core/protocol/ValueWidth';
import type { ControlSpec, MenuGroupNode, MenuNode } from '@/definition/schema';

const def = loadRealParsedDefinition();

/** 收集全部分组节点（含顶层菜单根节点）。 */
function collectGroups(node: MenuNode, out: MenuGroupNode[] = []): MenuGroupNode[] {
  if (node.kind !== 'group') return out;
  out.push(node);
  for (const child of node.children) collectGroups(child, out);
  return out;
}

describe('QA · 定义解析基线（目标定义文件）', () => {
  it('顶层菜单 / 分组节点 / 叶子控件计数与实测基线一致', () => {
    expect(def.menus).toHaveLength(8);
    expect(countGroupNodes(def)).toBe(67);
    expect(def.controls).toHaveLength(349);
    expect(def.controlById.size).toBe(349);
  });

  it('控件类型分布与实测基线一致', () => {
    expect(controlStats(def)).toEqual({
      keycode: 131,
      toggle: 90,
      range: 78,
      dropdown: 33,
      button: 9,
      color: 8,
    });
  });

  it('【高危 4】349 个 controlId 全唯一（valueKey 只有 347 个唯一种，不能当主键）', () => {
    const ids = def.controls.map((c) => c.id);
    expect(new Set(ids).size).toBe(349);

    const valueKeys = def.controls.map((c) => c.valueKey);
    expect(new Set(valueKeys).size).toBe(347);
  });

  it('【高危 4】67 个分组节点 id 全唯一', () => {
    const groups = def.menus.flatMap((m) => collectGroups(m.root));
    expect(groups).toHaveLength(67);
    expect(new Set(groups.map((g) => g.id)).size).toBe(67);
  });

  it('content 长度只有 3/4/5 三种，且与 address.indexes 个数严格对应', () => {
    const lens = new Map<number, number>();
    for (const c of def.controls) {
      const n = 3 + c.address.indexes.length;
      lens.set(n, (lens.get(n) ?? 0) + 1);
    }
    expect(lens.get(3)).toBe(61);
    expect(lens.get(4)).toBe(248);
    expect(lens.get(5)).toBe(40);
    // 没有任何控件出现 6+ 长度或非法的 1/2 长度
    expect([...lens.keys()].sort()).toEqual([3, 4, 5]);
  });

  it('【高危 4】两处重名 valueKey 各自产生不同 controlId', () => {
    const duplicated = new Map<string, ControlSpec[]>();
    for (const c of def.controls) {
      const list = duplicated.get(c.valueKey) ?? [];
      list.push(c);
      duplicated.set(c.valueKey, list);
    }
    const dups = [...duplicated.entries()].filter(([, list]) => list.length > 1);
    expect(dups).toHaveLength(2);

    for (const [key, list] of dups) {
      const ids = list.map((c) => c.id);
      expect(new Set(ids).size, `valueKey ${key} 的 controlId 必须互不相同`).toBe(ids.length);
    }
    expect([...duplicated.keys()].filter((k) => (duplicated.get(k) ?? []).length > 1).sort()).toEqual([
      'id_magic_oneshot_enable',
      'id_save_threshold_data',
    ]);
  });

  it('【高危 4】id_magic_oneshot_enable 的两个控件指向同一个 ValueAddress（channel 7 / value_id 12）', () => {
    const pair = def.controls.filter((c) => c.valueKey === 'id_magic_oneshot_enable');
    expect(pair).toHaveLength(2);
    for (const c of pair) {
      expect(c.address.channel).toBe(7);
      expect(c.address.valueId).toBe(12);
      expect(c.address.indexes).toEqual([]);
    }
    expect(pair[0]?.address.key).toBe(pair[1]?.address.key);
    // 按地址订阅时改一个必须能同步另一个：两者地址键必须完全相同
    expect(pair[0]?.address.key).toBe('7:12:');
  });

  it('【高危 4/5】id_save_threshold_data 的两个 button 同地址但 options 不同（[0] / [1]）', () => {
    const pair = def.controls.filter((c) => c.valueKey === 'id_save_threshold_data');
    expect(pair).toHaveLength(2);
    expect(pair[0]?.address.channel).toBe(0);
    expect(pair[0]?.address.valueId).toBe(4);
    expect(pair[1]?.address.key).toBe(pair[0]?.address.key);

    const args = pair.map((c) => (c.options.kind === 'action' ? [...c.options.args] : null));
    expect(args).toContainEqual([0]);
    expect(args).toContainEqual([1]);
  });

  it('每个控件的 widthHint 必须等于 inferWidth(控件, {})（防止两处规则漂移）', () => {
    const drifted = def.controls.filter((c) => c.widthHint !== inferWidth(c, {}));
    expect(drifted.map((c) => `${c.id}:${c.widthHint}≠${inferWidth(c, {})}`)).toEqual([]);
  });

  it('按类型的宽度基线：keycode=2 / color=2 / toggle=1 / button=1', () => {
    const widths = new Map<string, Set<number>>();
    for (const c of def.controls) {
      const set = widths.get(c.type) ?? new Set<number>();
      set.add(c.widthHint);
      widths.set(c.type, set);
    }
    expect([...(widths.get('keycode') ?? [])]).toEqual([2]);
    expect([...(widths.get('color') ?? [])]).toEqual([2]);
    expect([...(widths.get('toggle') ?? [])]).toEqual([1]);
    expect([...(widths.get('button') ?? [])]).toEqual([1]);
  });

  it('解析结果没有 error 级 issue（防止定义文件存在被静默吞掉的字段错误）', () => {
    expect(def.issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('KLE 键位条目数与实测基线一致（98）', () => {
    expect(def.allKeys).toHaveLength(98);
  });

  it('布局选项组数为 5，且全部被某些键引用', () => {
    expect(def.layoutLabels).toHaveLength(5);
    const used = new Set(def.allKeys.map((k) => k.group).filter((g): g is number => g !== null));
    for (const g of def.layoutLabels) {
      expect(used.has(g.index), `布局组 ${g.index}（${g.label}）没有任何键引用`).toBe(true);
    }
  });
});
