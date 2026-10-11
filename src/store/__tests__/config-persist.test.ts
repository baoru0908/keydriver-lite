// 配置持久化与读优先语义（QMK via.c 实证：id_custom_set_value 走 *_noeeprom()，断电即丢；
// id_custom_save(0x09) 才写 EEPROM）。不落盘 = 每次开机配置回到出厂值。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRealDefinitionRaw } from '@/definition/__tests__/fixtures/realDefinition';
import { useDefinitionStore } from '@/store/useDefinitionStore';
import { useDeviceStore, getFacade } from '@/store/useDeviceStore';
import { useKeymapStore } from '@/store/useKeymapStore';
import { useMenuStore } from '@/store/useMenuStore';
import { useDebugStore } from '@/store/useDebugStore';

async function connectDummy(): Promise<void> {
  useDeviceStore.setState({ transportKind: 'dummy' });
  const ok = await useDeviceStore.getState().connect();
  if (!ok) throw new Error(`连接失败：${useDeviceStore.getState().error ?? '?'}`);
}

describe('配置持久化（自动落盘）', () => {
  beforeEach(() => {
    useDefinitionStore.getState().loadFromJson(loadRealDefinitionRaw(), '测试定义');
    if (!useDefinitionStore.getState().definition) throw new Error('测试定义解析失败');
  });

  afterEach(async () => {
    useDeviceStore.setState({ transportKind: 'dummy' });
    await useDeviceStore.getState().disconnect();
    useKeymapStore.getState().reset();
    useMenuStore.getState().reset();
    useDebugStore.getState().clearFrames();
    vi.useRealTimers();
  });

  it('写入后空闲到点自动发 0x09 落盘（VIA SET 只改 RAM，不落盘会丢配置）', async () => {
    vi.useFakeTimers();
    await connectDummy();
    const facade = getFacade();
    if (!facade) throw new Error('facade 未建立');
    const saveSpy = vi.spyOn(facade.protocol, 'customSave');
    const definition = useDefinitionStore.getState().definition;
    const brightness = [...(definition?.controls ?? [])].find((c) => c.type === 'range');
    if (!brightness) throw new Error('定义里没有 range 控件');

    expect(await useDeviceStore.getState().menuCommit(brightness, 200)).toBe(true);
    expect(saveSpy).not.toHaveBeenCalled();

    // 先过防抖写入窗口（200ms），再过落盘空闲窗口（1.5s）
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(1600);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('连续拖动只落盘一次（空闲防抖，避免 EEPROM 写穿）', async () => {
    vi.useFakeTimers();
    await connectDummy();
    const facade = getFacade();
    if (!facade) throw new Error('facade 未建立');
    const saveSpy = vi.spyOn(facade.protocol, 'customSave');
    const definition = useDefinitionStore.getState().definition;
    const brightness = [...(definition?.controls ?? [])].find((c) => c.type === 'range');
    if (!brightness) throw new Error('定义里没有 range 控件');

    for (const v of [10, 60, 120, 200]) {
      expect(await useDeviceStore.getState().menuCommit(brightness, v)).toBe(true);
      await vi.advanceTimersByTimeAsync(100); // 每次间隔 100ms < 空闲阈值
    }
    expect(saveSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1600);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('断开连接前把待落盘改动刷进 EEPROM', async () => {
    vi.useFakeTimers();
    await connectDummy();
    const facade = getFacade();
    if (!facade) throw new Error('facade 未建立');
    const saveSpy = vi.spyOn(facade.protocol, 'customSave');
    const definition = useDefinitionStore.getState().definition;
    const brightness = [...(definition?.controls ?? [])].find((c) => c.type === 'range');
    if (!brightness) throw new Error('定义里没有 range 控件');

    expect(await useDeviceStore.getState().menuCommit(brightness, 180)).toBe(true);
    await vi.advanceTimersByTimeAsync(300); // 还没到空闲阈值
    await useDeviceStore.getState().disconnect();
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });
});

describe('读优先（连接后呈现设备真实值）', () => {
  beforeEach(() => {
    useDefinitionStore.getState().loadFromJson(loadRealDefinitionRaw(), '测试定义');
  });

  afterEach(async () => {
    useDeviceStore.setState({ transportKind: 'dummy' });
    await useDeviceStore.getState().disconnect();
    useKeymapStore.getState().reset();
    useMenuStore.getState().reset();
    useDebugStore.getState().clearFrames();
  });

  it('连接后预载全部菜单：界面值是设备读回值，不写设备', async () => {
    await connectDummy();
    const facade = getFacade();
    if (!facade) throw new Error('facade 未建立');
    const setSpy = vi.spyOn(facade.protocol, 'customSetValue');

    await useDeviceStore.getState().menuPreloadAll();

    const definition = useDefinitionStore.getState().definition;
    expect(definition?.menus.length ?? 0).toBeGreaterThan(0);
    for (const menu of definition?.menus ?? []) {
      expect(useMenuStore.getState().loadedMenus.has(menu.id)).toBe(true);
    }
    // 预载是纯读语义：不得产生任何写入
    expect(setSpy).not.toHaveBeenCalled();
  });
});
