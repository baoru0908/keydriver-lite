// QA 探边（Backlight BugFix 回归轮）：writeValueDirect 只读自校验的边界场景。
//
// 与 write-verify-readonly.test.ts（真机复现：回读恒 0）互补，专测：
//  E1. >255 合法 2 字节控件：首写宽度正确（max>255→2 字节）时，回读一致、不误发
//      「宽度可能不正确」警告、不重写（1 次 SET）。
//  E2. 同地址多次写入：自校验每地址仅一次（verified 集合），GET 探测有界（≤2 次），
//      绝不因回读探测产生额外 SET（无死循环/重复刷警告）。
//  E3. 调试面板宽度覆盖机制（localStorage 覆盖表）仍生效：覆盖为 2 字节后 SET 帧变 2 字节。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DeviceFacade } from '@/core/device/DeviceFacade';
import { DummyTransport } from '@/core/hid/DummyTransport';
import type { HidDeviceInfo, HidTransport, ListDevicesOptions, Unsubscribe } from '@/core/hid/HidTransport';
import { loadRealParsedDefinition } from '@/definition/__tests__/fixtures/realDefinition';
import { VIA_CMD } from '@/core/protocol/constants';
import { addressKey, encodeSet } from '@/core/protocol/CustomValueCodec';
import { frameToHex } from '@/core/hid/frame';
import { saveOverride } from '@/core/protocol/ValueWidth';
import type { ParsedDefinition } from '@/definition/schema';

const definition: ParsedDefinition = loadRealParsedDefinition();
const OVERRIDES_KEY = 'keydriver:valueWidthOverrides';

/** 记录 0x07 SET / 0x08 GET 帧的透传包装（固件行为照常，不做任何篡改）。 */
class RecordingTransport implements HidTransport {
  readonly kind = 'dummy' as const;
  readonly inner: DummyTransport;
  readonly setFrames: Uint8Array[] = [];
  readonly getFrames: Uint8Array[] = [];

  constructor(inner: DummyTransport) {
    this.inner = inner;
  }

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

  async transfer(request: Uint8Array): Promise<Uint8Array> {
    if (request[0] === VIA_CMD.CUSTOM_SET_VALUE) this.setFrames.push(request.slice());
    if (request[0] === VIA_CMD.CUSTOM_GET_VALUE) this.getFrames.push(request.slice());
    return this.inner.transfer(request);
  }
}

async function connected() {
  const warnings: string[] = [];
  const inner = new DummyTransport({
    vendorId: definition.vid,
    productId: definition.pid,
    rows: definition.matrix.rows,
    cols: definition.matrix.cols,
    layerCount: 4,
  });
  const transport = new RecordingTransport(inner);
  const device = (await transport.listDevices())[0];
  if (!device) throw new Error('设备列表为空');
  const facade = new DeviceFacade(transport, device, {
    definition,
    onWarning: (w) => warnings.push(`${w.title}:${w.detail}`),
  });
  await facade.connect();
  return { transport, facade, warnings };
}

function framesFor(frames: Uint8Array[], channel: number, valueId: number): Uint8Array[] {
  return frames.filter((f) => f[1] === channel && f[2] === valueId);
}

function brightnessControl(): ParsedDefinition['controls'][number] {
  const control = definition.controls.find((c) => c.valueKey === 'id_qmk_rgb_matrix_brightness');
  if (!control) throw new Error('定义缺少 brightness 控件');
  return control;
}

describe('QA 探边 · 只读自校验边界', () => {
  beforeEach(() => {
    // E3 需要覆盖表（node 环境无 localStorage，注入最小 stub）；其余用例从干净覆盖表开始
    if (typeof globalThis.localStorage === 'undefined') {
      const backing = new Map<string, string>();
      (globalThis as { localStorage?: Storage }).localStorage = {
        getItem: (k: string) => backing.get(k) ?? null,
        setItem: (k: string, v: string) => void backing.set(k, v),
        removeItem: (k: string) => void backing.delete(k),
        clear: () => backing.clear(),
        key: () => null,
        get length() {
          return backing.size;
        },
      } as Storage;
    }
    globalThis.localStorage.removeItem(OVERRIDES_KEY);
  });

  afterEach(() => {
    globalThis.localStorage.removeItem(OVERRIDES_KEY);
  });

  it('E1. >255 合法 2 字节控件：1 次 SET、2 字节大端编码、无宽度警告', async () => {
    const control = definition.controls.find(
      (c) => c.type === 'range' && c.options.kind === 'range' && c.options.max > 255,
    );
    if (!control) throw new Error('定义中没有 max>255 的 range 控件（前置失败）');

    const { transport, facade, warnings } = await connected();
    await facade.writeValueNow(control, 1000);

    const frames = framesFor(transport.setFrames, control.address.channel, control.address.valueId);
    expect(frames).toHaveLength(1); // 只有一次用户触发的写入，无自校验重写
    const first = frames[0];
    if (!first) throw new Error('未捕获 SET 帧');
    expect(frameToHex(first)).toBe(frameToHex(encodeSet(control.address, 1000, 2)));
    // 回读一致（Dummy 正常回读 2 字节）→ 不允许误发「宽度可能不正确」
    expect(warnings.filter((w) => w.startsWith('值宽度可能不正确'))).toHaveLength(0);
  });

  it('E2. 同地址重复写入：GET 探测有界（≤2 次）且绝不产生自校验额外 SET', async () => {
    const control = brightnessControl();
    const { transport, facade, warnings } = await connected();

    await facade.writeValueNow(control, 50);
    await facade.writeValueNow(control, 200);

    // 2 次用户写入 = 恰好 2 帧 SET（自校验只读，不追加）
    const sets = framesFor(transport.setFrames, control.address.channel, control.address.valueId);
    expect(sets).toHaveLength(2);
    // GET 有界：首次自校验最多 readBack + altRead = 2 次；第二次写入 verified 命中为 0 次
    const gets = framesFor(transport.getFrames, control.address.channel, control.address.valueId);
    expect(gets.length).toBeLessThanOrEqual(2);
    // 警告至多 1 次（每地址一次），不存在重复刷警告/死循环
    expect(warnings.filter((w) => w.startsWith('值宽度可能不正确')).length).toBeLessThanOrEqual(1);
  });

  it('E3. 调试面板宽度覆盖仍生效：覆盖 2 字节后 SET 帧按 2 字节编码', async () => {
    const control = brightnessControl();
    saveOverride(addressKey(control.address), 2); // 与调试面板同源：saveOverride → localStorage → loadOverrides

    const { transport, facade } = await connected();
    await facade.writeValueNow(control, 200);

    const sets = framesFor(transport.setFrames, control.address.channel, control.address.valueId);
    expect(sets).toHaveLength(1);
    const first = sets[0];
    if (!first) throw new Error('未捕获 SET 帧');
    expect(frameToHex(first)).toBe(frameToHex(encodeSet(control.address, 200, 2)));
  });
});
