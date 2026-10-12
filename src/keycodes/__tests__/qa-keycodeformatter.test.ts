// QA 独立验证 · 键码显示层（KeycodeFormatter）的页判定边界。
import { describe, expect, it } from 'vitest';
import { parseKeycode, format, isSpecial } from '@/keycodes/KeycodeFormatter';
import { KeycodeTable } from '@/keycodes/KeycodeTable';
import { QK_PAGE } from '@/core/protocol/constants';

describe('QA · 各键码页的归属判定', () => {
  it('精确表优先：已注册的键一律按 exact 解析（含层操作键 MO(3)）', () => {
    expect(parseKeycode(0x0004).kind).toBe('exact');
    // MO(0)…MO(15) 在 LAYER_KEYCODES 里已注册，因此优先走精确表
    expect(parseKeycode(0x5103).kind).toBe('exact');
    expect(parseKeycode(0x5103).prefix).toBe('MO(3)');
    // 超出注册范围（layer ≥ 16）才退化为按页解析
    expect(parseKeycode(0x5120).kind).toBe('layer');
    expect(parseKeycode(0x6104).kind).toBe('modtap');
  });

  it('修饰组合页范围内的每个值都归为 mod（含边界 0x01FF）', () => {
    expect(parseKeycode(0x0100).prefix).toBe('LCTL');
    expect(parseKeycode(0x01ff).prefix).toBe('LCTL');
    expect(parseKeycode(0x0800).prefix).toBe('LGUI');
    expect(parseKeycode(0x08ff).prefix).toBe('LGUI');
    expect(format(0x0104)).toBe('LCTL(A)');
  });

  it('Layer-Tap 页：层号 0–15 都能解出', () => {
    for (let layer = 0; layer <= 15; layer += 1) {
      const kc = (QK_PAGE.LAYER_TAP | (layer << 8) | 0x04) & 0xffff;
      const parsed = parseKeycode(kc);
      expect(parsed.kind).toBe('layertap');
      expect(parsed.param).toBe(layer);
    }
  });

  it('Mod-Tap 页：8 个修饰位都能解出且名字与构造端一致', () => {
    const expected = ['LCTL', 'LSFT', 'LALT', 'LGUI', 'RCTL', 'RSFT', 'RALT', 'RGUI'];
    const bits = [0x01, 0x02, 0x04, 0x08, 0x11, 0x12, 0x14, 0x18];
    bits.forEach((bit, i) => {
      const kc = (QK_PAGE.MOD_TAP | (bit << 8) | 0x04) & 0xffff;
      const parsed = parseKeycode(kc);
      expect(parsed.kind).toBe('modtap');
      expect(parsed.prefix).toBe(`${expected[i]}_T`);
    });
  });

  it('层操作页：MO/TO/TG/DF/OSL/TT/OSM/TD/MACRO 都能解出前缀与参数', () => {
    const cases: [number, string][] = [
      [QK_PAGE.MOMENTARY, 'MO'],
      [QK_PAGE.TO, 'TO'],
      [QK_PAGE.TOGGLE_LAYER, 'TG'],
      [QK_PAGE.DEF_LAYER, 'DF'],
      [QK_PAGE.ONE_SHOT_LAYER, 'OSL'],
      [QK_PAGE.LAYER_TAP_TOGGLE, 'TT'],
      [QK_PAGE.ONE_SHOT_MOD, 'OSM'],
      [QK_PAGE.TAP_DANCE, 'TD'],
      [QK_PAGE.MACRO, 'M'],
    ];
    for (const [page, prefix] of cases) {
      // 取 layer ≥ 16 的参数值，绕开 LAYER_KEYCODES 已注册的 0–15
      const parsed = parseKeycode((page | 20) & 0xffff);
      expect([parsed.kind, parsed.prefix, parsed.param]).toEqual(['layer', prefix, 20]);
    }
  });

  it('透明 / 禁用标记为特殊键', () => {
    expect(isSpecial(0x0000)).toBe(true);
    expect(isSpecial(0x0001)).toBe(true);
    expect(isSpecial(0x0004)).toBe(false);
  });
});

describe('QA · QMK v9 新编码兜底（keycodes_0.0.1.hjson）', () => {
  // 实证：目标固件协议 v12 但使用 v9 键码字典（真机日志 0x04 逐键读）。
  // v9 层操作页 0x20 步进：TO=0x5200|n, MO=0x5220|n, DF=0x5240|n, TG=0x5260|n …
  // 旧编码下 0x52xx 低 8 位 ≥ 0x20 为非法层号（QMK 上限 16 层），可无歧义按 v9 解析。
  it('0x5221/0x5222 按 v9 解析为 MO(1)/MO(2)（真机：右下角 Fn 键）', () => {
    expect(parseKeycode(0x5221)).toMatchObject({ kind: 'layer', prefix: 'MO', param: 1 });
    expect(format(0x5221)).toBe('MO(1)');
    expect(parseKeycode(0x5222)).toMatchObject({ kind: 'layer', prefix: 'MO', param: 2 });
  });

  it('v9 各层操作基址都能解出', () => {
    // 0x5200-0x521F 与旧 DF 页重叠（真歧义），保守保持旧解析 DF(n)
    expect(format(0x5203)).toBe('DF(3)');
    expect(format(0x5241)).toBe('DF(1)');
    expect(format(0x5262)).toBe('TG(2)');
    expect(format(0x5283)).toBe('OSL(3)');
    expect(format(0x52c4)).toBe('TT(4)');
  });

  it('旧编码合法值不受影响（MO(3)=0x5103 仍走精确表）', () => {
    expect(parseKeycode(0x5103).prefix).toBe('MO(3)');
  });

  it('v9 的 QK_QUANTUM 基址 0x7C00 显示为 QK_BOOT', () => {
    expect(format(0x7c00)).toBe('QK_BOOT');
  });

  it('HID Keyboard Menu (0x76) 有可读名', () => {
    expect(format(0x0076)).toBe('Menu');
  });
});

// 【QA 缺陷候选】两条独立成因都会把 Quantum 页（0x7100/0x7200/0x7400/0x7800…）的键码
// 显示成 Mod-Tap：
//   ① KeycodeTable 注册了 MT(mod, 0) 作为 8 个 Mod-Tap 条目的基准码，
//     其中 RCTL_T/RSFT_T/RALT_T/RGUI_T 恰好等于 MIDI / Sequencer / Programmable / RGB 页基址；
//   ② KeycodeFormatter.parseKeycode 用 `kc >= 0x6000 && kc <= 0x7fff` 判定 Mod-Tap，
//     覆盖了整个 0x7000–0x7FFF 的 Quantum 区间（只要 (kc>>8)&0x1f 命中某个 mod 位）。
// 症状：固件返回一个灯效/多媒体/可编程键时，界面显示成 "RGUI_T(kc)" 之类的错误名字。
// 注：本文件的 base 区用例命中 ①，offset 区用例命中 ②。
describe('qa-regression · Quantum 页键码被误解为 Mod-Tap', () => {
  const pages: [number, string][] = [
    [0x7100, 'MIDI 页（QK_MIDI）'],
    [0x7200, '音序器页（QK_SEQUENCER）'],
    [0x7400, '可编程按键页（QK_PROGRAMMABLE_BUTTON）'],
    [0x7800, 'RGB 页（QK_RGB，含灯效键）'],
  ];

  for (const [base, desc] of pages) {
    it(`${desc} 页基址 0x${base.toString(16).toUpperCase()} 不得显示为 Mod-Tap`, () => {
      // 成因①：MT(mod, 0) 的注册码与该页基址撞车
      const parsed = parseKeycode(base);
      expect(parsed.kind, `${desc} 被解析为 ${parsed.kind} / ${parsed.prefix}`).not.toBe('modtap');
      expect(format(base), `${desc} 显示名不应是 *_T(...)`).not.toMatch(/_T\(/);
    });

    it(`${desc} 页内偏移键 0x${(base + 1).toString(16).toUpperCase()} 不得显示为 Mod-Tap`, () => {
      // 成因②：Mod-Tap 判定区间过宽（mod 位取 (kc>>8)&0x1f 恰好命中）
      const kc = base + 1;
      expect((kc >> 8) & 0x1f).not.toBe(0);
      const parsed = parseKeycode(kc);
      expect(parsed.kind, `${desc} 页内键被解析为 ${parsed.kind} / ${parsed.prefix}`).not.toBe(
        'modtap',
      );
      expect(format(kc)).not.toMatch(/_T\(/);
    });
  }
  it('（对照）mod 位命中的上限仍被正确识别，未命中的 mod 位回落到 raw', () => {
    // 0x68FF → (0x68 & 0x1f) = 0x08 = MOD_LGUI
    expect(parseKeycode(0x68ff).kind).toBe('modtap');
    // 0x6904 → mod 位 0x09 不是合法修饰组合，应回落原始 hex
    expect(parseKeycode(0x6904).kind).toBe('raw');
  });
});

describe('QA · KeycodeTable 覆盖度观察（供报告引用）', () => {
  it('已补齐 media 与 quantum 两组；lighting 仍为空（待补）', () => {
    const defined = new Set(KeycodeTable.builtins().map((d) => d.group));
    expect([...defined].sort()).toEqual(['basic', 'layers', 'media', 'modtap', 'quantum']);
    // groups() 按 order 排序，且会省略空分组
    const groupIds = KeycodeTable.groups().map((g) => g.id);
    expect(groupIds).toEqual(['basic', 'layers', 'modtap', 'media', 'quantum']);
    // 此前完全缺失的多媒体键与鼠标键，现在在键码面板里可选
    expect(KeycodeTable.itemsOf('media').length).toBeGreaterThan(0);
    expect(KeycodeTable.itemsOf('quantum').length).toBeGreaterThan(0);
    // ⚠️ 仍缺：灯效键（RGB_TOG 等）属于 lighting 组，尚无条目，待数值核实后补齐
    expect(KeycodeTable.itemsOf('lighting')).toHaveLength(0);
  });
});
