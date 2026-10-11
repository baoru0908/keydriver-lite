// 值宽度推断单测：覆盖 255 / 1000 / 1023 三种边界与覆盖表（架构 §8.3 / F5 / Q3）。
import { describe, expect, it } from 'vitest';
import { inferWidth, loadOverrides, saveOverride, verifyWrite } from '@/core/protocol/ValueWidth';
import { makeAddress } from '@/core/protocol/CustomValueCodec';
import type { ControlSpec } from '@/definition/schema';

function control(partial: Partial<ControlSpec> & Pick<ControlSpec, 'type' | 'options'>): ControlSpec {
  return {
    id: 'm0/test#0',
    valueKey: 'test_key',
    label: '测试',
    menuId: 'm0',
    path: ['测试'],
    widthHint: 1,
    address: makeAddress(0, 1, []),
    ...partial,
  };
}

describe('ValueWidth · 按类型推断', () => {
  it('keycode 恒 2 字节', () => {
    expect(inferWidth(control({ type: 'keycode', options: { kind: 'none' } }), {})).toBe(2);
  });

  it('color 恒 3 字节', () => {
    expect(inferWidth(control({ type: 'color', options: { kind: 'none' } }), {})).toBe(2);
  });

  it('toggle / button 恒 1 字节', () => {
    expect(inferWidth(control({ type: 'toggle', options: { kind: 'none' } }), {})).toBe(1);
    expect(inferWidth(control({ type: 'button', options: { kind: 'action', args: [0] } }), {})).toBe(1);
  });

  it('range：max>255 用 2 字节，否则 1 字节（覆盖 255/1000/1023）', () => {
    expect(inferWidth(control({ type: 'range', options: { kind: 'range', min: 0, max: 255 } }), {})).toBe(1);
    expect(inferWidth(control({ type: 'range', options: { kind: 'range', min: 1, max: 255 } }), {})).toBe(1);
    expect(inferWidth(control({ type: 'range', options: { kind: 'range', min: 0, max: 1000 } }), {})).toBe(2);
    expect(inferWidth(control({ type: 'range', options: { kind: 'range', min: 1, max: 1000 } }), {})).toBe(2);
    expect(inferWidth(control({ type: 'range', options: { kind: 'range', min: 1, max: 1023 } }), {})).toBe(2);
  });

  it('dropdown：按选项值上限判定；string[] 形态退化为索引恒 1 字节', () => {
    expect(
      inferWidth(
        control({ type: 'dropdown', options: { kind: 'enum', items: [{ label: 'A', value: 0 }, { label: 'B', value: 300 }] } }),
        {},
      ),
    ).toBe(2);
    expect(
      inferWidth(
        control({ type: 'dropdown', options: { kind: 'enum', items: [{ label: 'A', value: 0 }, { label: 'B', value: 20 }] } }),
        {},
      ),
    ).toBe(1);
  });
});

describe('ValueWidth · 覆盖表', () => {
  it('按地址键覆盖优先于推断', () => {
    const c = control({ type: 'range', options: { kind: 'range', min: 0, max: 255 } });
    expect(inferWidth(c, { '0:1:': 2 })).toBe(2);
  });

  it('按 valueKey 覆盖次之', () => {
    const c = control({ type: 'range', options: { kind: 'range', min: 0, max: 255 } });
    expect(inferWidth(c, { test_key: 2 })).toBe(2);
  });

  it('地址键覆盖优先于 valueKey 覆盖', () => {
    const c = control({ type: 'range', options: { kind: 'range', min: 0, max: 255 } });
    expect(inferWidth(c, { '0:1:': 1, test_key: 2 })).toBe(1);
  });

  it('saveOverride 写回后可在 loadOverrides 中读到（无 localStorage 时至少内存正确）', () => {
    const next = saveOverride('width:probe', 2);
    expect(next['width:probe']).toBe(2);
    expect(loadOverrides()['width:probe'] ?? 2).toBe(2);
  });
});

describe('ValueWidth · 回读自校验', () => {
  const address = makeAddress(6, 2, [1]);

  it('一致时返回 ok', async () => {
    const io = {
      customGetValue: async () => 500,
      customSetValue: async () => undefined,
    };
    const result = await verifyWrite(io, address, 500, 2);
    expect(result.ok).toBe(true);
    expect(result.readBack).toBe(500);
  });

  it('不一致且换宽度成功后给出建议宽度', async () => {
    let usedWidth = 2;
    const io = {
      customGetValue: async (_a: typeof address, width: number) => (width === 1 ? 300 : 0),
      customSetValue: async (_a: typeof address, _v: number, width: number) => {
        usedWidth = width;
      },
    };
    const result = await verifyWrite(io, address, 300, 2);
    expect(result.ok).toBe(false);
    expect(result.suggestedWidth).toBe(1);
    expect(usedWidth).toBe(1);
  });

  it('异常被吞掉并返回失败（不抛到 UI）', async () => {
    const io = {
      customGetValue: async () => {
        throw new Error('设备断开');
      },
      customSetValue: async () => {
        throw new Error('设备断开');
      },
    };
    const result = await verifyWrite(io, address, 1, 1);
    expect(result.ok).toBe(false);
  });
});
