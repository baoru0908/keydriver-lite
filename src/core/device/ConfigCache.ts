// 控件值缓存（按设备）：应对「固件回读撒谎」的真机 bug。
//
// 背景（真机帧日志实证）：目标键盘固件 custom_get_value 会返回陈旧值甚至全 0
//   ——实测：写入亮度 254 读回 0、写入灯效 2 读回 8（上一次会话的值）、
//     写入颜色 201 读回 61168（上上次会话的值）。
//   · 一旦亮度被写 0，固件把总开关也读回 0（灯灭状态自激）。
//   · 单纯「信任回读」会让每次开软件都看到全 0，用户感知「配置丢了 / 灯灭了」。
//
// 策略：
//   1) 每次写入成功 → 把值记入本地缓存（按 vid:pid 隔离，换键盘不串）；
//   2) 回读探测矛盾（写入 X 读回非 X）→ 把该地址**及其所在通道**标记为不可信；
//   3) 连接后读取控件时，不可信地址优先展示缓存值（上次真实配置），
//      无缓存值才回落设备回读——绝不编造；
//   4) 「从设备重新读取」可清除不可信标记，以设备为准（用户显式选择）。
//
// 存储：localStorage 单键 `keydriver:configCache`，全部 try/catch 守卫
//（隐私模式 / 配额满时静默降级为「不缓存」，功能退化为旧行为）。
import { addressKey } from '@/core/protocol/CustomValueCodec';
import type { ValueAddress } from '@/definition/schema';

const STORAGE_KEY = 'keydriver:configCache';

/** 回读不可信登记表：具体地址 + 整通道（通道级更稳——实测同通道地址会先后撒谎）。 */
interface Distrust {
  readonly addresses: readonly string[];
  readonly channels: readonly number[];
}

interface DeviceCacheEntry {
  /** addressKey → 最近一次已知真实值（写入成功或回读可信时更新） */
  readonly values: Readonly<Record<string, number>>;
  readonly distrust: Distrust;
}

type CacheShape = Record<string, DeviceCacheEntry>;

const EMPTY_ENTRY: DeviceCacheEntry = { values: {}, distrust: { addresses: [], channels: [] } };

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function loadShape(): CacheShape {
  const store = safeStorage();
  if (!store) return {};
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as CacheShape;
  } catch {
    return {};
  }
}

function saveShape(shape: CacheShape): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(shape));
  } catch {
    // 持久化失败只影响跨会话记忆，不影响本次会话
  }
}

/** 设备缓存键：vid:pid（同一把键盘插不同 USB 口序列号可能变，vid/pid 稳定）。 */
export function deviceCacheKey(vendorId: number, productId: number): string {
  return `${vendorId}:${productId}`;
}

/** 取某设备的缓存（无则空表）。 */
export function loadDeviceCache(key: string): DeviceCacheEntry {
  return loadShape()[key] ?? EMPTY_ENTRY;
}

/** 记录某地址的已知真实值。 */
export function cacheDeviceValue(key: string, addr: ValueAddress, value: number): void {
  const shape = loadShape();
  const entry = shape[key] ?? EMPTY_ENTRY;
  shape[key] = {
    ...entry,
    values: { ...entry.values, [addressKey(addr)]: value >>> 0 },
  };
  saveShape(shape);
}

/** 取某地址的缓存值；从未写过返回 undefined（调用方回落设备回读）。 */
export function cachedDeviceValue(key: string, addr: ValueAddress): number | undefined {
  return loadDeviceCache(key).values[addressKey(addr)];
}

/** 从地址键取通道号（`channel:valueId:indexes`）。 */
export function channelOfAddressKey(addrKey: string): number {
  const channel = Number.parseInt(addrKey.split(':')[0] ?? '', 10);
  return Number.isFinite(channel) ? channel : -1;
}

/** 标记某地址回读不可信（同时标记其所在通道）。 */
export function distrustAddress(key: string, addr: ValueAddress): void {
  const shape = loadShape();
  const entry = shape[key] ?? EMPTY_ENTRY;
  const addrKey = addressKey(addr);
  const channel = addr.channel;
  shape[key] = {
    ...entry,
    distrust: {
      addresses: entry.distrust.addresses.includes(addrKey)
        ? entry.distrust.addresses
        : [...entry.distrust.addresses, addrKey],
      channels: entry.distrust.channels.includes(channel)
        ? entry.distrust.channels
        : [...entry.distrust.channels, channel],
    },
  };
  saveShape(shape);
}

/** 某地址当前是否被判定「回读不可信」。 */
export function isDistrusted(key: string, addr: ValueAddress): boolean {
  const { distrust } = loadDeviceCache(key);
  return (
    distrust.addresses.includes(addressKey(addr)) || distrust.channels.includes(addr.channel)
  );
}

/** 清除一组地址的不可信标记（「从设备重新读取」用：用户显式选择信任设备）。 */
export function clearDistrust(key: string, addrs: readonly ValueAddress[]): void {
  const shape = loadShape();
  const entry = shape[key];
  if (!entry) return;
  const addrKeys = new Set(addrs.map(addressKey));
  const channels = new Set(addrs.map((a) => a.channel));
  shape[key] = {
    ...entry,
    distrust: {
      addresses: entry.distrust.addresses.filter((a) => !addrKeys.has(a)),
      // 通道级标记只在「该菜单覆盖了此通道全部已知地址」时才摘除，
      // 简化处理：重新读取即摘除相关通道（写入时的探测会按需重新标记）。
      channels: entry.distrust.channels.filter((c) => !channels.has(c)),
    },
  };
  saveShape(shape);
}

/** 清空某设备全部缓存（EEPROM 复位后旧值全部作废）。 */
export function clearDeviceCache(key: string): void {
  const shape = loadShape();
  if (!(key in shape)) return;
  delete shape[key];
  saveShape(shape);
}
