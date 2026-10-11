// BugFix 回归：Backlight（channel 3）Brightness / Effect Speed 滑块「不生效」。
//
// 根因：DeviceFacade.writeValueDirect 的写后回读自校验在「回读不一致」时用 alt 宽度
// **重写设备**。真机上该固件对 channel 3 的 get 返回 0（UI 截图证据：滑块读值停在 0），
// 于是首次拖动滑块：写 1 字节 [0x07,3,1,200] → 回读 0 ≠ 200 → 自动改用 2 字节重写
// [0x07,3,1,0x00,0xC8]。标准固件按 1 字节取 value_data[0] = 0x00 → **亮度/速度被清零**。
// （2 字节大端编码值 ≤255 时首字节恒 0，凡触发此分支 1 字节控件必被清零。）
//
// 锁定不变量：回读自校验**只读不写**——除用户触发的首次按推断宽度的写入外，
// 不得对设备产生任何额外写入。
import { describe, expect, it } from 'vitest';
import { DeviceFacade } from '@/core/device/DeviceFacade';
import { DummyTransport } from '@/core/hid/DummyTransport';
import type { HidDeviceInfo, HidTransport, ListDevicesOptions, Unsubscribe } from '@/core/hid/HidTransport';
import type { ProtocolWarning } from '@/core/device/handshake';
import { loadRealParsedDefinition } from '@/definition/__tests__/fixtures/realDefinition';
import { VIA_CMD } from '@/core/protocol/constants';
import { encodeSet } from '@/core/protocol/CustomValueCodec';
import { frameToHex } from '@/core/hid/frame';
import { MSG_LEN } from '@/core/hid/HidTransport';
import type { ParsedDefinition } from '@/definition/schema';

const definition: ParsedDefinition = loadRealParsedDefinition();

/**
 * 包装传输层：模拟「该固件对 channel 3 的 get_value 未实现/恒回 0」的真机行为。
 * 其余请求原样转发 Dummy（SET 照常生效，键位/握手不受影响）。
 */
class GetZeroRgbTransport implements HidTransport {
  readonly kind = 'dummy' as const;
  readonly inner: DummyTransport;
  /** 收到的 0x07 SET 帧原始字节（按序） */
  readonly setFrames: Uint8Array[] = [];

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
    // 记录 SET 帧后再转发（保证 SET 对固件照常生效）
    if (request[0] === VIA_CMD.CUSTOM_SET_VALUE) {
      this.setFrames.push(request.slice());
    }
    const response = await this.inner.transfer(request);
    // 模拟真机：channel 3 的 get_value 恒回 0（前缀回显照常，值字节全 0）
    if (request[0] === VIA_CMD.CUSTOM_GET_VALUE && (request[1] ?? 0) === 3) {
      const zeroed = new Uint8Array(MSG_LEN);
      zeroed.set([VIA_CMD.CUSTOM_GET_VALUE, request[1] ?? 0, request[2] ?? 0], 0);
      return zeroed;
    }
    return response;
  }
}

async function connected() {
  const warnings: ProtocolWarning[] = [];
  const inner = new DummyTransport({
    vendorId: definition.vid,
    productId: definition.pid,
    rows: definition.matrix.rows,
    cols: definition.matrix.cols,
    layerCount: 4,
  });
  const transport = new GetZeroRgbTransport(inner);
  const device = (await transport.listDevices())[0];
  if (!device) throw new Error('设备列表为空');
  const facade = new DeviceFacade(transport, device, {
    definition,
    onWarning: (w) => warnings.push(w),
  });
  await facade.connect();
  return { transport, facade, warnings };
}

describe('写后回读自校验只读不写（Backlight 滑块清零 bug 回归）', () => {
  it.each([
    ['Brightness', 'id_qmk_rgb_matrix_brightness'],
    ['Effect Speed', 'id_qmk_rgb_matrix_effect_speed'],
  ])('%s：回读为 0 时不得触发 alt 宽度重写（值不得被清零）', async (_label, valueKey) => {
    const control = definition.controls.find((c) => c.valueKey === valueKey);
    if (!control) throw new Error(`定义缺少控件 ${valueKey}`);
    expect(control.address.channel).toBe(3);
    expect(control.type).toBe('range');

    const { transport, facade, warnings } = await connected();
    await facade.writeValueNow(control, 200);

    // 不变量 ①：对该地址只有一次 SET（修复前：回读不一致 → alt=2 字节重写 → 2 次）
    const target = transport.setFrames.filter(
      (f) => f[1] === control.address.channel && f[2] === control.address.valueId,
    );
    expect(target).toHaveLength(1);
    // 不变量 ②：SET 帧为 1 字节宽度且值字节 = 200（修复前：第二帧为 [7,3,1,0x00,0xC8]，首字节清零）
    const first = target[0];
    if (!first) throw new Error('未捕获到 SET 帧');
    expect(frameToHex(first)).toBe(frameToHex(encodeSet(control.address, 200, 1)));

    // 自检能力保留：回读不一致必须给出警告（指引调试面板覆盖宽度），但设备不被二次写入
    expect(warnings.some((w) => w.title === '值宽度可能不正确' && w.detail.includes('回读不一致'))).toBe(true);
  });
});
