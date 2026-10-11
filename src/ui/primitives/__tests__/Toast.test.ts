// Toast 进出场链路：进场即挂载，退场必须先播完动画再从 DOM 移除（不允许「硬切消失」）。
// 这条链路是我们自己实现的（Radix 浮层由 data-state 驱动，Toast 无 Radix 依赖），
// 故用单测锁定：leaving 标记 → 延迟 → 真正移除，缺一步都会让观感倒退。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '../Toast';

describe('Toast 进出场链路', () => {
  beforeEach(() => {
    useToastStore.setState({ items: [], leaving: [] });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dismiss 先进 leaving 播退场，动画结束才从 items 移除', async () => {
    useToastStore.getState().push('success', '已保存');
    const id = useToastStore.getState().items[0]?.id;
    expect(id).toBeDefined();

    useToastStore.getState().dismiss(id as number);
    // 退场中：仍在列表里（否则动画没机会播），但已标记 leaving（渲染层据此挂 animate-slide-out）
    expect(useToastStore.getState().leaving).toContain(id);
    expect(useToastStore.getState().items).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(160);
    expect(useToastStore.getState().items).toHaveLength(0);
    expect(useToastStore.getState().leaving).not.toContain(id);
  });

  it('成功提示 2s 后自动走同一条退场链路（观感与手动关闭一致）', async () => {
    useToastStore.getState().push('success', '已连接');
    const id = useToastStore.getState().items[0]?.id as number;

    await vi.advanceTimersByTimeAsync(1999);
    expect(useToastStore.getState().items).toHaveLength(1);
    expect(useToastStore.getState().leaving).not.toContain(id);

    await vi.advanceTimersByTimeAsync(1);
    expect(useToastStore.getState().leaving).toContain(id);

    await vi.advanceTimersByTimeAsync(160);
    expect(useToastStore.getState().items).toHaveLength(0);
  });

  it('错误提示不自动消失，只能手动关闭', async () => {
    useToastStore.getState().push('error', '写入失败');
    await vi.advanceTimersByTimeAsync(5000);
    expect(useToastStore.getState().items).toHaveLength(1);
    expect(useToastStore.getState().leaving).toHaveLength(0);
  });

  it('重复 dismiss 同一条不排队两次移除（避免闪烁）', async () => {
    useToastStore.getState().push('info', '同步中');
    const id = useToastStore.getState().items[0]?.id as number;
    useToastStore.getState().dismiss(id);
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().leaving.filter((l) => l === id)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(160);
    expect(useToastStore.getState().items).toHaveLength(0);
  });
});
