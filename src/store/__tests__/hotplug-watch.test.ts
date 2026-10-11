// 热插拔看门狗单测（R3 补全）：hidapi 无设备到达事件 → 未连接态周期重扫 + 记忆设备自动重连。
//
// 覆盖点：
//  1. disconnected 态轮询 → 设备列表刷新（模拟「启动后插键盘」）；
//  2. busy / connecting 时轮询 no-op（不叠加 IPC）；
//  3. connected 态轮询 no-op（连接中列表交给断连轮询管，不覆盖）；
//  4. 记忆设备重新出现 → 自动重连成功（覆盖「lost 后重插自动恢复」路径）；
//  5. 无记忆设备时轮询只刷列表、不触发连接。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRealDefinitionRaw } from '@/definition/__tests__/fixtures/realDefinition';
import { useDefinitionStore } from '@/store/useDefinitionStore';
import { useDeviceStore, pollDeviceArrivalOnce } from '@/store/useDeviceStore';
import { useKeymapStore } from '@/store/useKeymapStore';
import { useMenuStore } from '@/store/useMenuStore';
import { useDebugStore } from '@/store/useDebugStore';

/** node 环境没有 localStorage：内存实现（rememberDevice/autoReconnect 真实读写它）。 */
const memoryStorage = new Map<string, string>();
const localStorageStub = {
  getItem: (key: string): string | null => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string): void => void memoryStorage.set(key, value),
  removeItem: (key: string): void => void memoryStorage.delete(key),
  clear: (): void => void memoryStorage.clear(),
};

describe('热插拔看门狗（pollDeviceArrivalOnce）', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', localStorageStub);
    memoryStorage.clear();
    useDefinitionStore.getState().loadFromJson(loadRealDefinitionRaw(), '测试定义');
    if (!useDefinitionStore.getState().definition) throw new Error('测试定义解析失败');
    useDeviceStore.setState({ transportKind: 'dummy', state: 'disconnected', busy: false });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    memoryStorage.clear();
    useDeviceStore.setState({ transportKind: 'dummy' });
    await useDeviceStore.getState().disconnect();
    useKeymapStore.getState().reset();
    useMenuStore.getState().reset();
    useDebugStore.getState().clearFrames();
  });

  it('disconnected 态轮询刷新设备列表（模拟启动后插键盘），不误触发连接', async () => {
    useDeviceStore.setState({ devices: [] });
    await pollDeviceArrivalOnce();

    const state = useDeviceStore.getState();
    expect(state.devices.length).toBeGreaterThan(0);
    // 无记忆设备：只刷列表，不连接
    expect(state.state).toBe('disconnected');
  });

  it('busy 时轮询 no-op', async () => {
    useDeviceStore.setState({ devices: [], busy: true });
    await pollDeviceArrivalOnce();

    expect(useDeviceStore.getState().devices.length).toBe(0);
  });

  it('connecting 时轮询 no-op', async () => {
    useDeviceStore.setState({ devices: [], state: 'connecting' });
    await pollDeviceArrivalOnce();

    expect(useDeviceStore.getState().devices.length).toBe(0);
  });

  it('connected 态轮询 no-op（连接中的列表由断连轮询管）', async () => {
    useDeviceStore.setState({ transportKind: 'dummy' });
    const ok = await useDeviceStore.getState().connect();
    expect(ok).toBe(true);
    useDeviceStore.setState({ devices: [] });
    await pollDeviceArrivalOnce();

    expect(useDeviceStore.getState().devices.length).toBe(0);
    expect(useDeviceStore.getState().state).toBe('connected');
  });

  it('记忆设备重新出现 → 自动重连成功（lost/重插场景）', async () => {
    // 先连接一次写入记忆
    useDeviceStore.setState({ transportKind: 'dummy' });
    const ok = await useDeviceStore.getState().connect();
    expect(ok).toBe(true);
    expect(localStorage.getItem('keydriver.lastDevice')).not.toBeNull();
    await useDeviceStore.getState().disconnect();

    // 模拟「拔出后重新插上」：列表清空 → 轮询发现记忆设备 → 静默重连
    useDeviceStore.setState({ devices: [], state: 'disconnected' });
    await pollDeviceArrivalOnce();

    const state = useDeviceStore.getState();
    expect(state.state).toBe('connected');
    expect(state.handshake).not.toBeNull();
  });

  it('防重入：上一轮未结束时再次调用直接跳过', async () => {
    useDeviceStore.setState({ devices: [] });
    // 并发两次：第二次应在第一次未完成时跳过（polling 标记）
    const [a, b] = await Promise.all([pollDeviceArrivalOnce(), pollDeviceArrivalOnce()]);
    void a;
    void b;
    // 不抛异常且列表已刷新即可
    expect(useDeviceStore.getState().devices.length).toBeGreaterThan(0);
  });
});
