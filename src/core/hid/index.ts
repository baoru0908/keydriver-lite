// 传输层工厂：按 kind 创建具体实现。WebHID（浏览器/Electron）与原生 hidapi 桥（Tauri）双轨。
import type { HidTransport, TransportKind } from './HidTransport';
import { DummyTransport, type DummyConfig } from './DummyTransport';
import { WebHidTransport } from './WebHidTransport';
import { NativeHidTransport } from './NativeHidTransport';

export * from './HidTransport';
export * from './frame';
export * from './viaFilter';
export { DummyTransport, DEFAULT_DUMMY_CONFIG } from './DummyTransport';
export type { DummyConfig } from './DummyTransport';
export { WebHidTransport } from './WebHidTransport';
export { NativeHidTransport, isNativeHidAvailable } from './NativeHidTransport';
export { SimulatedFirmware, DEFAULT_FIRMWARE_CONFIG } from './SimulatedFirmware';
export type { FirmwareConfig } from './SimulatedFirmware';

export interface CreateTransportOptions {
  readonly kind: TransportKind;
  readonly dummy?: Partial<DummyConfig>;
}

export function createTransport(options: CreateTransportOptions): HidTransport {
  switch (options.kind) {
    case 'dummy':
      return new DummyTransport(options.dummy ?? {});
    case 'webhid':
      return new WebHidTransport();
    case 'nodehid':
      return new NativeHidTransport();
    default:
      throw new Error(`未知传输类型：${String(options.kind)}`);
  }
}
