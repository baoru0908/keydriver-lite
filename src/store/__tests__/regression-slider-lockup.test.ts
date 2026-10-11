// 紧急回归排查：「所有滑块都滑不动，失效」（f631fff 交付后的用户复测）。
//
// 逐条假设实证（详见各用例注释）：
//   A. 写路径锁死 —— f631fff 后回读探测 GET 若抛错（超时/断连），错误是否卡死写入
//      队列 / 污染 busy / 阻断后续写入？不变量：**探测失败绝不影响写入链路**。
//   C. 固件回读恒 0 覆盖乐观值 —— 写入成功后，面板重进（menuLoad 重水合）时固件坏回读
//      不得覆盖用户已输入的值（衔接 f631fff 反清零：写入成功 = 设备已收到，回读不可信）。
//
// 实现方式：独立测试文件 + vi.mock('@/core/hid') 包装 createTransport（仅 dummy 分支），
// 注入「channel 3 GET 回读损坏」的固件替身，两种模式：
//   'zero'  —— GET 恒回 0（真机 brightness/speed 的实际行为，f631fff 前置调查证据）
//   'throw' —— GET 抛 TimeoutError（回读探测失败的最坏情况）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRealDefinitionRaw } from '@/definition/__tests__/fixtures/realDefinition';
import { useDefinitionStore } from '@/store/useDefinitionStore';
import { useDeviceStore, getFacade } from '@/store/useDeviceStore';
import { useMenuStore } from '@/store/useMenuStore';
import { useDebugStore } from '@/store/useDebugStore';
import { DummyTransport } from '@/core/hid/DummyTransport';
import { MSG_LEN, TimeoutError } from '@/core/hid/HidTransport';
import type {
  HidDeviceInfo,
  HidTransport,
  ListDevicesOptions,
  Unsubscribe,
} from '@/core/hid/HidTransport';
import { VIA_CMD } from '@/core/protocol/constants';
import { addressKey } from '@/core/protocol/CustomValueCodec';
import type { CreateTransportOptions } from '@/core/hid';

const probe = vi.hoisted(() => ({ mode: 'zero' as 'zero' | 'throw' }));

vi.mock('@/core/hid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/hid')>();
  return {
    ...actual,
    createTransport: (options: CreateTransportOptions) => {
      const inner = new actual.DummyTransport(options.dummy ?? {});
      if (options.kind !== 'dummy') return inner;
      return new GetBrokenRgbTransport(inner, probe.mode);
    },
  };
});

/** 固件替身：channel 3 的 GET 回读按模式损坏；SET 照常生效并记录。 */
class GetBrokenRgbTransport implements HidTransport {
  readonly kind = 'dummy' as const;
  readonly setFrames: Uint8Array[] = [];

  constructor(
    private readonly inner: DummyTransport,
    private readonly mode: 'zero' | 'throw',
  ) {}

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
    const isRgbGet = request[0] === VIA_CMD.CUSTOM_GET_VALUE && (request[1] ?? 0) === 3;
    if (!isRgbGet) return this.inner.transfer(request, timeoutMs);
    if (this.mode === 'throw') {
      throw new TimeoutError('替身固件：回读超时');
    }
    const zeroed = new Uint8Array(MSG_LEN);
    zeroed.set([VIA_CMD.CUSTOM_GET_VALUE, request[1] ?? 0, request[2] ?? 0], 0);
    return zeroed;
  }
}

async function connectDummy(): Promise<void> {
  useDeviceStore.setState({ transportKind: 'dummy' });
  const ok = await useDeviceStore.getState().connect();
  if (!ok) throw new Error(`前置失败：connect 未成功（${useDeviceStore.getState().error ?? '?'}）`);
}

function lightMenuControls() {
  const definition = useDefinitionStore.getState().definition;
  if (!definition) throw new Error('定义未加载');
  const menu = definition.menus.find((m) => m.label.includes('灯'));
  if (!menu) throw new Error('找不到灯光菜单');
  const brightness = menu.controls.find((c) => c.valueKey === 'id_qmk_rgb_matrix_brightness');
  const speed = menu.controls.find((c) => c.valueKey === 'id_qmk_rgb_matrix_effect_speed');
  if (!brightness || !speed) throw new Error('找不到 Backlight 滑块控件');
  return { menu, brightness, speed };
}

function countSets(): number {
  const facade = getFacade();
  if (!facade) throw new Error('facade 未建立');
  const transport = facade.transport as GetBrokenRgbTransport;
  return transport.setFrames.length;
}

describe('回归：滑块失效（A 写路径不锁死 / C 乐观值不被坏回读覆盖）', () => {
  beforeEach(() => {
    probe.mode = 'zero';
    useDefinitionStore.getState().loadFromJson(loadRealDefinitionRaw(), '回归测试');
    if (!useDefinitionStore.getState().definition) throw new Error('测试定义解析失败');
  });

  afterEach(async () => {
    useDeviceStore.setState({ transportKind: 'dummy' });
    await useDeviceStore.getState().disconnect();
    useMenuStore.getState().reset();
    useDebugStore.getState().clearFrames();
    useDebugStore.getState().clearWarnings();
  });

  it('C. 写入成功后面板重进：固件坏回读（恒 0）不得覆盖用户乐观值', async () => {
    await connectDummy();
    const { menu, brightness } = lightMenuControls();

    // 首次加载：固件坏回读 → 显示 0（这正是用户在真机看到的「滑块停在 0」）
    await useDeviceStore.getState().menuLoad(menu.id);
    const facade = getFacade();
    if (!facade) throw new Error('facade 未建立');
    const keyB = addressKey(brightness.address);
    expect(useMenuStore.getState().addressValues[keyB]).toBe(0);

    // 拖滑块：乐观更新 + 写入成功（SET 已下发），但固件回读恒 0
    expect(await useDeviceStore.getState().menuCommit(brightness, 200)).toBe(true);
    await facade.flushWrites();
    expect(facade.isReadbackUnreliable(keyB)).toBe(true);

    // 面板重进（清 loadedMenus 触发 menuLoad 重新水合）
    useMenuStore.setState({ loadedMenus: new Set() });
    await useDeviceStore.getState().menuLoad(menu.id);

    // 修复前：addressValues[keyB] 被固件坏回读覆盖为 0 —— 用户感知「没生效」
    // 修复后：写入成功 + 回读不可靠 → 保留用户乐观值 200
    expect(useMenuStore.getState().addressValues[keyB]).toBe(200);
  });

  it('A. 回读探测 GET 抛超时：写入链路不锁死、busy 不污染、后续写入照常', async () => {
    probe.mode = 'throw';
    await connectDummy();
    const { menu, brightness, speed } = lightMenuControls();
    await useDeviceStore.getState().menuLoad(menu.id);
    const facade = getFacade();
    if (!facade) throw new Error('facade 未建立');

    // 第一次滑块写入：SET 成功、回读探测抛错 → 不得向 UI 抛异常
    await expect(useDeviceStore.getState().menuCommit(brightness, 200)).resolves.toBe(true);
    expect(useDeviceStore.getState().busy).toBe(false); // busy 不被污染
    expect(useMenuStore.getState().addressValues[addressKey(brightness.address)]).toBe(200); // 乐观值保留
    await facade.flushWrites();
    expect(countSets()).toBe(1);

    // 标记该地址回读不可靠（UI 保留乐观值的依据）
    expect(facade.isReadbackUnreliable(addressKey(brightness.address))).toBe(true);

    // 第二次写入（另一控件）：队列未锁死，照常下发
    await expect(useDeviceStore.getState().menuCommit(speed, 100)).resolves.toBe(true);
    await facade.flushWrites();
    expect(countSets()).toBe(2);
    expect(useDeviceStore.getState().busy).toBe(false);
  });

  it('A2. 回读探测抛错时告警必须是「回读校验失败」而非「值写入失败」（SET 实际已成功）', async () => {
    probe.mode = 'throw';
    await connectDummy();
    const { menu, brightness } = lightMenuControls();
    await useDeviceStore.getState().menuLoad(menu.id);
    const facade = getFacade();
    if (!facade) throw new Error('facade 未建立');

    await useDeviceStore.getState().menuCommit(brightness, 200);
    await facade.flushWrites();

    const warnings = useDebugStore.getState().warnings;
    expect(warnings.some((w) => w.title === '回读校验失败')).toBe(true);
    expect(warnings.some((w) => w.title === '值写入失败')).toBe(false);
  });
});
