// T04 验收测试（Dummy 全链路，无硬件）：
//   1) 349 个控件 100% 可读可写
//   2) 灯光 Effect 选 All Off → Speed/Color 隐藏；选回 Breathing → 重新出现（两级 showIf）
//   3) 导出 → EEPROM 复位 → 导入 → 逐项一致
//   4) 同地址的两个控件（快捷入口）改一处两处同步刷新
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRealParsedDefinition } from '@/definition/__tests__/fixtures/realDefinition';
import { useDefinitionStore } from '@/store/useDefinitionStore';
import { useDeviceStore, getFacade } from '@/store/useDeviceStore';
import { readValue, useMenuStore, visibleControls } from '@/store/useMenuStore';
import { inferWidth } from '@/core/protocol/ValueWidth';
import type { ControlSpec, ParsedDefinition } from '@/definition/schema';
import { diffBackup } from '@/io/backup';

let definition: ParsedDefinition;

beforeAll(async () => {
  definition = loadRealParsedDefinition();
  useDefinitionStore.getState().loadFromJson(definition.raw, definition.name);
  useMenuStore.getState().indexControls(definition);
  const ok = await useDeviceStore.getState().connect();
  expect(ok, 'Dummy 设备必须能连接').toBe(true);
});

/** 给每个控件挑一个合法范围内的写入值（按类型与 options 取值，不越界）。 */
function probeValueOf(control: ControlSpec): number {
  if (control.options.kind === 'range') {
    const { min, max } = control.options;
    return min === max ? min : max - 1 < min ? min : max - 1;
  }
  if (control.options.kind === 'enum') {
    return control.options.items.at(-1)?.value ?? 0;
  }
  switch (control.type) {
    case 'color':
      // [hue, sat] 16 位语义（QMK RGB Matrix，VIA 官方一致）：探针取 16 位中段避免 0 值歧义
      return 0x1234;
    case 'keycode':
      return 0x0028;
    case 'toggle':
      return 1;
    default:
      return 1;
  }
}

describe('T04.1 · 349 个控件 100% 可读可写', () => {
  it('控件总数与类型分布符合基线', () => {
    const stats: Record<string, number> = {};
    for (const c of definition.controls) stats[c.type] = (stats[c.type] ?? 0) + 1;
    expect(definition.controls.length).toBe(349);
    expect(stats).toEqual({
      keycode: 131,
      toggle: 90,
      range: 78,
      dropdown: 33,
      button: 9,
      color: 8,
    });
  });

  it('每个控件都能从设备读到值', async () => {
    const facade = getFacade();
    expect(facade).not.toBeNull();
    if (!facade) return;
    let n = 0;
    for (const control of definition.controls) {
      const value = await facade.readValue(control);
      expect(Number.isFinite(value), `${control.id} 读到的值不是有限数`).toBe(true);
      n += 1;
    }
    expect(n).toBe(349);
  });

  it('每个控件写入后都能原值读回（含二维索引的 40 个控件）', async () => {
    const facade = getFacade();
    if (!facade) throw new Error('未连接');
    const twoDim = definition.controls.filter((c) => c.address.indexes.length === 2);
    expect(twoDim.length).toBe(40);

    let checked = 0;
    for (const control of definition.controls) {
      const probe = probeValueOf(control);
      await facade.writeValueNow(control, probe);
      const back = await facade.readValue(control);
      expect(back, `${control.id}（${control.label}）写入 ${probe} 读回 ${back}`).toBe(probe >>> 0);
      checked += 1;
    }
    expect(checked).toBe(349);
  }, 60000);
});

describe('T04.2 · 两级 showIf：灯光 Effect 联动 Speed / Color', () => {
  it('Effect 选 All Off 时 Speed 与 Color 自动隐藏', () => {
    const effect = definition.controls.find((c) => c.valueKey === 'id_qmk_rgb_matrix_effect');
    expect(effect).toBeDefined();
    if (!effect) return;
    const menuId = effect.menuId;
    const items = effect.options.kind === 'enum' ? effect.options.items : [];
    const offIndex = items.findIndex((i) => i.label === 'All Off');
    const breathIndex = items.findIndex((i) => i.label === 'Breathing');
    expect(offIndex).toBeGreaterThanOrEqual(0);
    expect(breathIndex).toBeGreaterThanOrEqual(0);

    const idsOf = (value: number): string[] =>
      visibleControls(definition, menuId, { id_qmk_rgb_matrix_effect: value }).map((c) => c.valueKey);

    const offVisible = idsOf(offIndex);
    expect(offVisible).toContain('id_qmk_rgb_matrix_effect');
    expect(offVisible).not.toContain('id_qmk_rgb_matrix_effect_speed');
    expect(offVisible).not.toContain('id_qmk_rgb_matrix_color');

    const breathVisible = idsOf(breathIndex);
    expect(breathVisible).toContain('id_qmk_rgb_matrix_effect_speed');
    expect(breathVisible).toContain('id_qmk_rgb_matrix_color');
  });

  it('showIf 总数 60 = 2 分组级 + 58 叶子级', () => {
    let groupLevel = 0;
    let leafLevel = 0;
    const walk = (node: unknown): void => {
      const n = node as { showIf?: string; content?: unknown[]; children?: unknown[]; type?: string };
      if (n.showIf) {
        if (n.type) leafLevel += 1;
        else groupLevel += 1;
      }
      for (const child of n.content ?? n.children ?? []) {
        if (child && typeof child === 'object') walk(child);
      }
    };
    for (const menu of definition.raw.menus ?? []) walk(menu);
    expect(groupLevel + leafLevel).toBe(60);
    expect(groupLevel).toBe(2);
    expect(leafLevel).toBe(58);
  });
});

describe('T04.3 · 快捷入口：同地址控件改一处两处同步', () => {
  it('指向同一 ValueAddress 的两个控件值始终一致', () => {
    const same = definition.controls.filter((c) => c.valueKey === 'id_magic_oneshot_enable');
    expect(same.length).toBe(2);
    const [a, b] = same as [ControlSpec, ControlSpec];
    expect(a.id).not.toBe(b.id);
    expect(`${a.address.channel}:${a.address.valueId}`).toBe(`${b.address.channel}:${b.address.valueId}`);

    useMenuStore.getState().setValue(a, 1);
    expect(readValue(useMenuStore.getState(), a)).toBe(1);
    // 关键：另一处（另一个分组里的快捷入口）必须同步刷新
    expect(readValue(useMenuStore.getState(), b)).toBe(1);

    useMenuStore.getState().setValue(b, 0);
    expect(readValue(useMenuStore.getState(), a)).toBe(0);
  });
});

describe('T04.4 · 导出 → EEPROM 复位 → 导入 → 逐项一致', () => {
  it('全程往返无差异', async () => {
    const store = useDeviceStore.getState();

    // 先把全部菜单的值拉进内存（含被 showIf 隐藏的控件）
    for (const menu of definition.menus) {
      await store.menuLoad(menu.id);
    }

    const backup = store.backupExport();
    expect(backup).not.toBeNull();
    if (!backup) return;
    // 主键必须是 controlId：349 个控件 → 349 个键（用 valueKey 只有 347 个，会丢 2 个）
    expect(Object.keys(backup.values).length).toBe(349);

    // 复位：值应回到固件默认（与备份不同，否则导入验不出东西）
    const resetOk = await store.deviceEepromReset();
    expect(resetOk).toBe(true);
    for (const menu of definition.menus) {
      await useDeviceStore.getState().menuLoad(menu.id);
    }
    const afterReset: Record<string, number> = {};
    for (const control of definition.controls) {
      afterReset[control.id] = readValue(useMenuStore.getState(), control);
    }
    const resetDiff = diffBackup(definition, backup, afterReset);
    expect(resetDiff.length, '复位后应与备份存在差异，否则导入验证无意义').toBeGreaterThan(0);

    // 导入
    const result = await useDeviceStore.getState().backupImport({ ok: true, backup });
    expect(result.applied).toBe(349);
    expect(result.missing).toBe(0);

    // 逐项从设备读回比对（不走内存缓存，确保是真的写进去了）
    const facade = getFacade();
    expect(facade).not.toBeNull();
    if (!facade) return;
    await facade.flushWrites();
    const actual: Record<string, number> = {};
    for (const control of definition.controls) {
      actual[control.id] = await facade.readValue(control);
    }
    const diff = diffBackup(definition, backup, actual);
    expect(diff).toEqual([]);
  }, 120000);
});

describe('T04.5 · 值宽度与下限是两个独立维度', () => {
  it('range 下限取 options[0]：min=1 的有 35 个，与 2 字节的 35 个不是同一批', () => {
    const ranges = definition.controls.filter((c) => c.type === 'range');
    expect(ranges.length).toBe(78);
    const minOne = ranges.filter((c) => c.options.kind === 'range' && c.options.min === 1);
    const twoByte = ranges.filter((c) => inferWidth(c, {}) === 2);
    expect(minOne.length).toBe(35);
    expect(twoByte.length).toBe(35);
    const intersection = minOne.filter((c) => twoByte.includes(c));
    expect(intersection.length).toBe(13);
  });

  it('button 的 options 原样透传（含那个 [1]）', () => {
    const buttons = definition.controls.filter((c) => c.type === 'button');
    expect(buttons.length).toBe(9);
    const argsList = buttons.map((c) => (c.options.kind === 'action' ? c.options.args : null));
    expect(argsList.filter((a) => a !== null && a.length === 1 && a[0] === 0).length).toBe(7);
    expect(argsList.filter((a) => a !== null && a.length === 1 && a[0] === 1).length).toBe(1);
    expect(argsList.filter((a) => a !== null && a.length === 0).length).toBe(1);
  });
});
