// 菜单扁平化单测：断言 8 菜单 / 67 分组 / 349 控件 / 类型分布 / controlId 唯一性（架构 F1/F2/F3）。
import { describe, expect, it } from 'vitest';
import { loadRealParsedDefinition } from './fixtures/realDefinition';
import { countGroupNodes, controlStats } from '@/definition/DefinitionParser';
import { flattenMenus } from '@/definition/MenuFlattener';
import type { MenuNode, MenuNodeRaw } from '@/definition/schema';

const definition = loadRealParsedDefinition();

describe('MenuFlattener · 目标定义文件', () => {
  it('解析出 8 个顶层菜单', () => {
    expect(definition.menus).toHaveLength(8);
    expect(definition.menus.map((m) => m.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']);
  });

  it('解析出 67 个分组节点（含 8 个顶层菜单根节点）', () => {
    expect(countGroupNodes(definition)).toBe(67);
  });

  it('解析出 349 个叶子控件', () => {
    expect(definition.controls).toHaveLength(349);
  });

  it('控件类型分布与实测完全一致', () => {
    expect(controlStats(definition)).toEqual({
      keycode: 131,
      toggle: 90,
      range: 78,
      dropdown: 33,
      button: 9,
      color: 8,
    });
  });

  it('F1：349 个 controlId 全局唯一（即使 valueKey 重复）', () => {
    const ids = definition.controls.map((c) => c.id);
    expect(new Set(ids).size).toBe(349);
    // 反向验证：valueKey 确实存在重复，证明不能用它做主键
    const keys = definition.controls.map((c) => c.valueKey);
    expect(new Set(keys).size).toBeLessThan(keys.length);
    expect(new Set(keys).size).toBe(347);
  });

  it('F2：存在 2 个无 label 的条件分组，且分组层也带 showIf', () => {
    let noLabel = 0;
    let groupWithShowIf = 0;
    const visit = (node: MenuNode): void => {
      if (node.kind !== 'group') return;
      if (node.label === undefined) noLabel += 1;
      if (node.showIf !== undefined) groupWithShowIf += 1;
      for (const child of node.children) visit(child);
    };
    for (const menu of definition.menus) visit(menu.root);
    expect(noLabel).toBe(2);
    expect(groupWithShowIf).toBe(2);
  });

  it('F3：菜单用 content 承载子节点，Parser 同时兼容 children 写法', () => {
    const menuRaw = definition.raw.menus?.[0];
    expect(menuRaw).toBeDefined();
    // menus 元素允许是官方预设菜单的 id 字符串，故先收敛到对象分支再断言
    expect(typeof menuRaw === 'object').toBe(true);
    expect(Array.isArray((menuRaw as MenuNodeRaw).content)).toBe(true);
    // 兼容分支：手工构造一份 children 写法（含一层分组），验证仍能解析
    const legacy = flattenMenus([
      {
        label: 'G',
        children: [{ label: 'S', children: [{ label: 'T', type: 'toggle', content: ['k', 1, 2] }] }],
      },
    ]);
    expect(legacy.controls).toHaveLength(1);
    expect(legacy.controls[0]?.id).toContain('m0/G/S#0');
    expect(legacy.groupCount).toBe(2);
  });

  it('controlId 由「菜单路径 + 序号」生成，格式稳定', () => {
    const first = definition.controls[0];
    expect(first?.id).toMatch(/^m\d+\/.+#\d+$/);
    expect(first?.menuId).toBe('m0');
    expect(first?.path.length).toBeGreaterThan(0);
  });

  it('每个菜单的 controls 与该菜单下叶子数一致', () => {
    for (const menu of definition.menus) {
      const byMenu = definition.controlsByMenu.get(menu.id) ?? [];
      expect(byMenu).toHaveLength(menu.root.controlCount);
      expect(menu.controls).toHaveLength(menu.root.controlCount);
    }
  });

  it('controlById 索引覆盖全部控件', () => {
    expect(definition.controlById.size).toBe(349);
    expect(definition.controlById.get(definition.controls[10]?.id ?? '')?.id).toBe(
      definition.controls[10]?.id,
    );
  });

  it('值宽度推断：range max>255 用 2 字节，其余按类型', () => {
    const ranges = definition.controls.filter((c) => c.type === 'range');
    expect(ranges.every((c) => c.widthHint === (c.options.kind === 'range' && c.options.max > 255 ? 2 : 1))).toBe(true);
    expect(definition.controls.filter((c) => c.type === 'keycode').every((c) => c.widthHint === 2)).toBe(true);
    expect(definition.controls.filter((c) => c.type === 'color').every((c) => c.widthHint === 2)).toBe(true);
    expect(definition.controls.filter((c) => c.type === 'toggle').every((c) => c.widthHint === 1)).toBe(true);
  });

  it('无 error 级解析告警', () => {
    expect(definition.issues.filter((i) => i.level === 'error')).toHaveLength(0);
  });
});
