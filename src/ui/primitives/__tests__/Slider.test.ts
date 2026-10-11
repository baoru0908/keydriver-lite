// Slider 值换算单测：clampStepValue 的步进取整、边界夹紧与浮点噪声清理。
// （指针坐标→值的几何换算依赖 getBoundingClientRect，纯逻辑部分抽成 clampStepValue 便于单测。）
import { describe, expect, it } from 'vitest';

import { clampStepValue } from '@/ui/primitives/Slider';

describe('clampStepValue', () => {
  it('步进取整：0-255、step 1 取整到最近整数', () => {
    expect(clampStepValue(150.4, 0, 255, 1)).toBe(150);
    expect(clampStepValue(150.6, 0, 255, 1)).toBe(151);
  });

  it('非 1 步长按步长对齐（min 有偏移时相对 min 取整）', () => {
    expect(clampStepValue(52, 0, 255, 10)).toBe(50);
    expect(clampStepValue(7, 5, 255, 10)).toBe(5);
    expect(clampStepValue(18, 5, 255, 10)).toBe(15);
  });

  it('边界夹紧：低于 min 回 min，高于 max 回 max', () => {
    expect(clampStepValue(-3, 35, 255, 1)).toBe(35);
    expect(clampStepValue(999, 35, 255, 1)).toBe(255);
  });

  it('浮点噪声清理：0.1+0.2 类结果收敛到稳定值', () => {
    expect(clampStepValue(0.3, 0, 1, 0.1)).toBeCloseTo(0.3, 6);
  });

  it('min===max 时恒等于 min', () => {
    expect(clampStepValue(50, 100, 100, 1)).toBe(100);
  });
});
