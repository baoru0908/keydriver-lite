// NativeHidTransport 单测：锁 TS↔Rust 桥的字节与错误语义（不依赖真机，invoke 全 mock）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { NativeHidTransport } from '../NativeHidTransport';
import { TimeoutError, TransportError } from '../HidTransport';

/** 模拟 Tauri WebView 运行时（node 环境默认无 window）。 */
function useTauriEnv(): void {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
}

const viaKbd = {
  path: 'DevSrvsID:1',
  vendor_id: 0x5594,
  product_id: 0x0005,
  product_name: '测试键盘',
  manufacturer_name: 'X',
  serial_number: null,
  usage_page: 0xff60,
  usage: 0x61,
  via_capable: true,
};

const mouse = {
  path: 'DevSrvsID:2',
  vendor_id: 0x1234,
  product_id: 0x0006,
  product_name: '鼠标',
  manufacturer_name: null,
  serial_number: null,
  usage_page: 0x01,
  usage: 0x02,
  via_capable: false,
};

describe('NativeHidTransport', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('非 Tauri 环境 isSupported=false 且 listDevices 直接返回空（不触发 invoke）', async () => {
    const t = new NativeHidTransport();
    expect(t.isSupported()).toBe(false);
    await expect(t.listDevices()).resolves.toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('listDevices 只返回 VIA 可控制设备，lastScan 记录全量与命中数', async () => {
    useTauriEnv();
    invokeMock.mockResolvedValue([viaKbd, mouse]);
    const t = new NativeHidTransport();
    const devices = await t.listDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]?.kind).toBe('nodehid');
    expect(devices[0]?.viaCapable).toBe(true);
    expect(devices[0]?.id.startsWith('nodehid:5594:5:')).toBe(true);
    expect(devices[0]?.native).toEqual({ path: 'DevSrvsID:1' });
    expect(t.lastScan).toEqual({ total: 2, matched: 1 });
    expect(invokeMock).toHaveBeenCalledWith('hid_list');
  });

  it('listDevices includeAll=true 旁路过滤', async () => {
    useTauriEnv();
    invokeMock.mockResolvedValue([viaKbd, mouse]);
    const t = new NativeHidTransport();
    await expect(t.listDevices({ includeAll: true })).resolves.toHaveLength(2);
  });

  it('transfer 请求不足 32 字节时补零，invoke 收到 32 字节数组', async () => {
    useTauriEnv();
    invokeMock.mockResolvedValue(new Array<number>(32).fill(0));
    const t = new NativeHidTransport();
    await t.transfer(new Uint8Array([0x01]), 500);
    const [, args] = invokeMock.mock.calls[0] as [string, { request: number[]; timeoutMs: number }];
    expect(args.request).toHaveLength(32);
    expect(args.request[0]).toBe(0x01);
    expect(args.request.slice(1).every((b) => b === 0)).toBe(true);
    expect(args.timeoutMs).toBe(500);
  });

  it('transfer 响应按 32 字节定长返回', async () => {
    useTauriEnv();
    invokeMock.mockResolvedValue([0x01, 0x00, 0x0c]);
    const t = new NativeHidTransport();
    const resp = await t.transfer(new Uint8Array(32));
    expect(resp).toBeInstanceOf(Uint8Array);
    expect(resp).toHaveLength(32);
    expect(resp[2]).toBe(0x0c);
  });

  it('TIMEOUT: 前缀错误映射为 TimeoutError', async () => {
    useTauriEnv();
    invokeMock.mockRejectedValue('TIMEOUT:固件响应超时');
    const t = new NativeHidTransport();
    await expect(t.transfer(new Uint8Array(32))).rejects.toBeInstanceOf(TimeoutError);
  });

  it('DISCONNECT: 前缀错误映射为 E_TRANSPORT_DISCONNECT', async () => {
    useTauriEnv();
    invokeMock.mockRejectedValue('DISCONNECT:设备未打开');
    const t = new NativeHidTransport();
    const err = await t.transfer(new Uint8Array(32)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).code).toBe('E_TRANSPORT_DISCONNECT');
  });

  it('open 缺 path 时抛断连错误，不触发 invoke', async () => {
    const t = new NativeHidTransport();
    const err = await t
      .open({
        id: 'nodehid:x',
        vendorId: 0x5594,
        productId: 5,
        productName: 'K',
        kind: 'nodehid',
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
