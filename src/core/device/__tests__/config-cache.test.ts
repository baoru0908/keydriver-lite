// 配置缓存（固件回读撒谎的对策）回归测试。
//
// 背景（真机帧日志实证，EC_BM60 / Em60）：custom_get_value 会返回陈旧值甚至全 0
//   ——实测：写入亮度 254 读回 0、写入灯效 2 读回 8（上次会话的值）、
//     写入颜色 201 读回 61168（上上次会话的值）；亮度写 0 后总开关也读回 0。
// 单纯信任回读 → 每次开软件灯光菜单全显示 0，用户感知「配置丢了 / 灯灭了」。
//
// 本文件锁定五条不变量：
//   A. 写入成功 → 值入本地缓存（按 vid:pid 隔离）；
//   B. 回读探测矛盾 → 地址 + 所在通道标记不可信，且**持久化**（跨会话）；
//   C. 重连后（全新 facade、内存标记全空）不可信地址展示缓存值而非撒谎回读；
//   D. 「从设备重新读取」(force) 清除不可信标记，以设备为准；
//   E. eepromReset 清空本设备缓存（旧值不得冒充新配置）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRealDefinitionRaw } from '@/definition/__tests__/fixtures/realDefinition';
import { useDefinitionStore } from '@/store/useDefinitionStore';
import { useDeviceStore, getFacade } from '@/store/useDeviceStore';
import { useMenuStore } from '@/store/useMenuStore';
import { useDebugStore } from '@/store/useDebugStore';
import { DummyTransport } from '@/core/hid/DummyTransport';
import { MSG_LEN } from '@/core/hid/HidTransport';
import type {
  HidDeviceInfo,
  HidTransport,
  ListDevicesOptions,
  Unsubscribe,
} from '@/core/hid/HidTransport';
import { VIA_CMD } from '@/core/protocol/constants';
import { addressKey } from '@/core/protocol/CustomValueCodec';
import type { CreateTransportOptions } from '@/core/hid';

const CACHE_STORAGE_KEY = 'keydriver:configCache';

/** node 环境无 localStorage：装一个内存替身（与 theme-preference.test 同款）。 */
const memoryStorage = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string): string | null => memoryStorage.get(k) ?? null,
  setItem: (k: string, v: string): void => void memoryStorage.set(k, v),
  removeItem: (k: string): void => void memoryStorage.delete(k),
  clear: (): void => void memoryStorage.clear(),
};
vi.stubGlobal('localStorage', localStorageStub);

vi.mock('@/core/hid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/hid')>();
  return {
    ...actual,
    createTransport: (options: CreateTransportOptions) => {
      const inner = new actual.DummyTransport(options.dummy ?? {});
      if (options.kind !== 'dummy') return inner;
      return new LyingRgbTransport(inner);
    },
  };
});

/**
 * 撒谎固件替身：channel 3（RGB Matrix）与 channel 5（总开关）的 GET 恒回 0
 * （真机 brightness/speed/toggle 的实际行为）；SET 照常生效并记录。
 */
class LyingRgbTransport implements HidTransport {
  readonly kind = 'dummy' as const;
  readonly setFrames: Uint8Array[] = [];

  constructor(private readonly inner: DummyTransport) {}

  get isOpen(): boolean {
    return this.inner.isOpen;
  }

  isSupported(): boolean {
    return this.inner.isSupported();
  }

  async listDevices(options?: ListDevicesOptions): Promise<HidDeviceInfo[]> {
    return this.inner.listDevices(options);
  }

  async requestAccess(options?: { readonly includeAll?: boolean }): Promise<HidDeviceInfo[]> {
    return this.inner.requestAccess(options);
  }

  async open(info: HidDeviceInfo): Promise<void> {
    return this.inner.open(info);
  }

  async close(): Promise<void> {
    return this.inner.close();
  }

  onDisconnect(cb: (info: HidDeviceInfo) => void): Unsubscribe {
    return this.inner.onDisconnect(cb);
  }

  async transfer(request: Uint8Array, timeoutMs?: number): Promise<Uint8Array> {
    if (request[0] === VIA_CMD.CUSTOM_SET_VALUE) this.setFrames.push(request.slice());
    const channel = request[1] ?? 0;
    const isLyingGet =
      request[0] === VIA_CMD.CUSTOM_GET_VALUE && (channel === 3 || channel === 5);
    if (!isLyingGet) return this.inner.transfer(request, timeoutMs);
    const zeroed = new Uint8Array(MSG_LEN);
    zeroed.set(request.subarray(0, 4), 0); // 回显前缀（cmd/channel/valueId/index）后值恒 0
    return zeroed;
  }
}

async function connectDummy(): Promise<void> {
  useDeviceStore.setState({ transportKind: 'dummy' });
  const ok = await useDeviceStore.getState().connect();
  if (!ok) throw new Error(`前置失败：connect 未成功（${useDeviceStore.getState().error ?? '?'}）`);
}

function lightMenuControls(): {
  menu: { id: string };
  brightness: { address: unknown; valueKey: string };
} {
  const definition = useDefinitionStore.getState().definition;
  if (!definition) throw new Error('定义未加载');
  const menu = definition.menus.find((m) => m.label.includes('灯'));
  if (!menu) throw new Error('找不到灯光菜单');
  const brightness = menu.controls.find((c) => c.valueKey === 'id_qmk_rgb_matrix_brightness');
  if (!brightness) throw new Error('找不到亮度控件');
  return { menu, brightness };
}

/** 本测试设备的缓存键（vid:pid，与 ConfigCache.deviceCacheKey 一致）。 */
function deviceCacheKeyOfDefinition(): string {
  const definition = useDefinitionStore.getState().definition;
  if (!definition) throw new Error('定义未加载');
  return `${definition.vid}:${definition.pid}`;
}

function readCacheEntry(): {
  values: Record<string, number>;
  distrust: { addresses: string[]; channels: number[] };
} {
  const shape = JSON.parse(memoryStorage.get(CACHE_STORAGE_KEY) ?? '{}') as Record<
    string,
    {
      values: Record<string, number>;
      distrust: { addresses: string[]; channels: number[] };
    }
  >;
  return (
    shape[deviceCacheKeyOfDefinition()] ?? { values: {}, distrust: { addresses: [], channels: [] } }
  );
}

describe('配置缓存：固件回读撒谎的对策', () => {
  beforeEach(() => {
    memoryStorage.clear();
    useDefinitionStore.getState().loadFromJson(loadRealDefinitionRaw(), '缓存测试');
    if (!useDefinitionStore.getState().definition) throw new Error('测试定义解析失败');
  });

  afterEach(async () => {
    useDeviceStore.setState({ transportKind: 'dummy' });
    await useDeviceStore.getState().disconnect();
    useMenuStore.getState().reset();
    useDebugStore.getState().clearFrames();
    useDebugStore.getState().clearWarnings();
  });

  it('A. 写入成功即入缓存；回读矛盾把地址与通道标记为不可信（持久化）', async () => {
    await connectDummy();
    const { menu, brightness } = lightMenuControls();
    const facade = getFacade();
    if (!facade) throw new Error('facade 未建立');
    const key = addressKey(brightness.address as never);

    await useDeviceStore.getState().menuLoad(menu.id);
    // 撒谎固件：首读即 0（这就是用户在真机看到的「滑块停在 0」）
    expect(useMenuStore.getState().addressValues[key]).toBe(0);

    expect(await useDeviceStore.getState().menuCommit(brightness as never, 200)).toBe(true);
    await facade.flushWrites();

    // 写入成功（SET 回显正确）→ 缓存记下真实值
    expect(readCacheEntry().values[key]).toBe(200);
    // 回读不一致 → 地址级 + 通道级双重标记，且已落 localStorage（跨会话生效）
    expect(readCacheEntry().distrust.addresses).toContain(key);
    expect(readCacheEntry().distrust.channels).toContain(3);
    expect(facade.isReadbackUnreliable(key)).toBe(true);
  });

  it('C. 重连后（全新 facade、内存标记全空）不可信地址展示缓存值而非撒谎的 0', async () => {
    await connectDummy();
    const { menu, brightness } = lightMenuControls();
    const key = addressKey(brightness.address as never);

    await useDeviceStore.getState().menuLoad(menu.id);
    await useDeviceStore.getState().menuCommit(brightness as never, 200);
    await getFacade()?.flushWrites();
    const facadeBefore = getFacade();

    // 关软件：disconnect 清 facade 与全部内存状态（localStorage 保留）
    await useDeviceStore.getState().disconnect();
    expect(getFacade()).toBeNull();

    // 重开软件：新 facade，内存 unreliableReadback / verified 全空
    await connectDummy();
    const facadeAfter = getFacade();
    if (!facadeAfter) throw new Error('facade 未重建');
    expect(facadeAfter).not.toBe(facadeBefore);
    expect(facadeAfter.isReadbackUnreliable(key)).toBe(false);

    // connect 内部 menuPreloadAll（静默）已完成缓存优先解析：
    // 修复前这里会被固件坏回读覆盖成 0——用户感知「配置丢了 / 灯又灭了」
    expect(useMenuStore.getState().addressValues[key]).toBe(200);
    expect(facadeAfter.isShowingCachedValue(brightness as never)).toBe(true);
  });

  it('D. 「从设备重新读取」(force) 清除不可信标记，以设备回读为准', async () => {
    await connectDummy();
    const { menu, brightness } = lightMenuControls();
    const key = addressKey(brightness.address as never);

    await useDeviceStore.getState().menuLoad(menu.id);
    await useDeviceStore.getState().menuCommit(brightness as never, 200);
    await getFacade()?.flushWrites();
    await useDeviceStore.getState().disconnect();
    await connectDummy();
    expect(useMenuStore.getState().addressValues[key]).toBe(200); // 缓存优先

    // 用户显式选择信任设备：强制重读 → 撒谎固件的 0 上位，标记被摘除
    await useDeviceStore.getState().menuLoad(menu.id, { force: true });
    expect(useMenuStore.getState().addressValues[key]).toBe(0);
    expect(readCacheEntry().distrust.addresses).not.toContain(key);
    expect(readCacheEntry().distrust.channels).not.toContain(3);
    expect(getFacade()?.isShowingCachedValue(brightness as never)).toBe(false);
  });

  it('E. eepromReset 清空本设备缓存（旧值不得冒充新配置）', async () => {
    await connectDummy();
    const { menu, brightness } = lightMenuControls();
    const key = addressKey(brightness.address as never);

    await useDeviceStore.getState().menuLoad(menu.id);
    await useDeviceStore.getState().menuCommit(brightness as never, 200);
    await getFacade()?.flushWrites();
    expect(readCacheEntry().values[key]).toBe(200);

    expect(await useDeviceStore.getState().deviceEepromReset()).toBe(true);
    expect(readCacheEntry().values).toEqual({});

    await useDeviceStore.getState().disconnect();
    await connectDummy();
    // 无缓存 + 无标记 → 回落设备回读
    expect(useMenuStore.getState().addressValues[key]).toBe(0);
    expect(getFacade()?.isShowingCachedValue(brightness as never)).toBe(false);
  });
});
