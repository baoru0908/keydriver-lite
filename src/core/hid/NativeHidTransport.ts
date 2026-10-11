// 原生 HID 传输（阶段 B）：经 Tauri IPC 调用 src-tauri/src/hid.rs 的 hidapi 桥。
//
// 与 WebHidTransport 实现同一个 HidTransport 接口——ViaProtocol / DeviceFacade /
// 全部 UI 在原生桥与 WebHID 之间零改动切换。
//
// 字节语义（探针 R1 实测）：
//   · 写：Rust 侧自动补 0x00 report-id 前缀（33 字节），前端照常给 32 字节帧；
//   · 读：本固件 hidapi 返回无前缀 32 字节（与 WebHID event.data 一致）；Rust 侧
//     对 33 字节读出自动剥前缀，前端永远拿到 32 字节；
//   · 无需用户授权（无 requestDevice 手势约束），插上键盘 listDevices 即可见；
//   · 断连：Rust 侧读写失败且设备消失 → emit "hid://disconnect" → 走 lost 状态机。
import {
  MSG_LEN,
  SerialQueue,
  TimeoutError,
  TransportError,
  VIA_USAGE,
  VIA_USAGE_PAGE,
  type HidDeviceInfo,
  type HidTransport,
  type ListDevicesOptions,
  type ScanSummary,
  type Unsubscribe,
} from './HidTransport';
import { filterControllableDevices } from './viaFilter';
import { pad32, frameToHex } from './frame';

const DEFAULT_TIMEOUT_MS = 1000;

/** Tauri 运行时探测：NativeHidTransport 只在 Tauri WebView 里可用。 */
function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Rust 侧 NativeDeviceInfo（serde 序列化，snake_case） */
interface NativeDeviceInfoDto {
  readonly path: string;
  readonly vendor_id: number;
  readonly product_id: number;
  readonly product_name: string;
  readonly manufacturer_name: string | null;
  readonly serial_number: string | null;
  readonly usage_page: number;
  readonly usage: number;
  readonly via_capable: boolean;
}

function toInfo(dto: NativeDeviceInfoDto, index: number): HidDeviceInfo {
  return {
    id: `nodehid:${dto.vendor_id.toString(16)}:${dto.product_id.toString(16)}:${dto.product_name}:${index}`,
    vendorId: dto.vendor_id,
    productId: dto.product_id,
    productName: dto.product_name,
    ...(dto.manufacturer_name !== null ? { manufacturerName: dto.manufacturer_name } : {}),
    ...(dto.serial_number !== null ? { serialNumber: dto.serial_number } : {}),
    usagePage: dto.usage_page,
    usage: dto.usage,
    viaCapable: dto.via_capable,
    kind: 'nodehid',
    native: { path: dto.path },
  };
}

/** Rust 错误串 → 本项目传输层错误（约定：TIMEOUT:/DISCONNECT:/ERROR: 前缀）。 */
function toTransportError(raw: unknown, rawHex?: string): TransportError {
  const message = raw instanceof Error ? raw.message : String(raw);
  if (message.startsWith('TIMEOUT:')) return new TimeoutError(message.slice('TIMEOUT:'.length), rawHex);
  if (message.startsWith('DISCONNECT:') || message.startsWith('ERROR:')) {
    return new TransportError('E_TRANSPORT_DISCONNECT', message.split(':', 2)[1] ?? message, rawHex);
  }
  return new TransportError('E_TRANSPORT_DISCONNECT', message, rawHex);
}

export class NativeHidTransport implements HidTransport {
  readonly kind = 'nodehid' as const;

  private readonly queue = new SerialQueue();
  private readonly disconnectCbs = new Set<(info: HidDeviceInfo) => void>();
  private current: HidDeviceInfo | null = null;
  private scan: ScanSummary | null = null;
  /** Rust 的 hid://disconnect 事件只订阅一次，回调分发到各 onDisconnect 注册方。 */
  private disconnectBound = false;

  get lastScan(): ScanSummary | null {
    return this.scan;
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  isSupported(): boolean {
    return isTauriRuntime();
  }

  async listDevices(options?: ListDevicesOptions): Promise<HidDeviceInfo[]> {
    if (!this.isSupported()) return [];
    const { invoke } = await import('@tauri-apps/api/core');
    const dtos = await invoke<NativeDeviceInfoDto[]>('hid_list').catch((e: unknown) => {
      throw toTransportError(e);
    });
    const infos = dtos.map((dto, index) => toInfo(dto, index));
    const controllable = filterControllableDevices(infos, { knownIds: options?.knownIds });
    this.scan = { total: infos.length, matched: controllable.length };
    return options?.includeAll === true ? infos : controllable;
  }

  /** 原生桥无需用户授权：直接返回当前可控制设备（接口占位，与 WebHID 调用方兼容）。 */
  async requestAccess(options?: ListDevicesOptions): Promise<HidDeviceInfo[]> {
    return this.listDevices(options);
  }

  async open(info: HidDeviceInfo): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    const nativePath = (info.native as { readonly path?: string } | undefined)?.path;
    if (typeof nativePath !== 'string' || nativePath.length === 0) {
      throw new TransportError('E_TRANSPORT_DISCONNECT', '设备缺少 hidapi path，请刷新设备列表后重选');
    }
    const opened = await invoke<NativeDeviceInfoDto>('hid_open', { path: nativePath }).catch((e: unknown) => {
      throw toTransportError(e);
    });
    this.current = { ...info, native: { path: opened.path } };
    void this.bindDisconnect();
  }

  async close(): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    this.current = null;
    await invoke('hid_close').catch(() => undefined);
  }

  transfer(request: Uint8Array, timeoutMs?: number): Promise<Uint8Array> {
    return this.queue.enqueue(() => this.transferOnce(request, timeoutMs));
  }

  onDisconnect(cb: (info: HidDeviceInfo) => void): Unsubscribe {
    this.disconnectCbs.add(cb);
    void this.bindDisconnect();
    return () => {
      this.disconnectCbs.delete(cb);
    };
  }

  /** 订阅 Rust 侧断连事件（幂等）。 */
  private async bindDisconnect(): Promise<void> {
    if (this.disconnectBound || !this.isSupported()) return;
    this.disconnectBound = true;
    const { listen } = await import('@tauri-apps/api/event');
    const { note } = await import('@/shared/note');
    try {
      await listen<string>('hid://disconnect', (event) => {
        void note(`hid-disconnect-event-received payload=${String(event.payload)}`);
        const info = this.current;
        this.current = null;
        if (info) for (const cb of this.disconnectCbs) cb(info);
      });
      void note('hid-disconnect-listen-ok');
    } catch (e) {
      this.disconnectBound = false;
      void note(`hid-disconnect-listen-fail:${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async transferOnce(request: Uint8Array, timeoutMs?: number): Promise<Uint8Array> {
    if (!this.isSupported()) {
      throw new TransportError('E_TRANSPORT_DISCONNECT', '当前环境不是 Tauri 桌面外壳，原生 HID 不可用');
    }
    const frame = pad32(request);
    const { invoke } = await import('@tauri-apps/api/core');
    const response = await invoke<number[]>('hid_transfer', {
      request: Array.from(frame),
      timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
    }).catch((e: unknown) => {
      throw toTransportError(e, frameToHex(frame));
    });
    // Rust 侧保证 32 字节；此处防御性补齐，与 WebHID 路径行为一致
    const data = new Uint8Array(MSG_LEN);
    data.set(response.slice(0, MSG_LEN));
    return data;
  }
}

/** 供工厂/UI 判断原生桥是否可用（Tauri 运行时 + VIA usage 可枚举）。 */
export async function isNativeHidAvailable(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const transport = new NativeHidTransport();
    const devices = await transport.listDevices();
    return devices.some((d) => d.usagePage === VIA_USAGE_PAGE && d.usage === VIA_USAGE);
  } catch {
    return false;
  }
}
