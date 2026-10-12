// 设备状态：设备列表、连接态、握手结论、传输类型。UI 只通过它发起连接，不直接碰 ViaProtocol。
import { create } from 'zustand';
import type { HidDeviceInfo, ListDevicesOptions, ScanSummary, TransportKind } from '@/core/hid/HidTransport';
import { createTransport } from '@/core/hid';
import { knownIdKey } from '@/core/hid/viaFilter';
import type { DummyConfig } from '@/core/hid/DummyTransport';
import { createDeviceFacade, type DeviceFacade } from '@/core/device';
import type { HandshakeResult } from '@/core/device/handshake';
import type { ControlSpec, ParsedDefinition } from '@/definition/schema';
import { parseId } from '@/definition/validate';
import { findByVidPid, listDefinitions, setCurrentDefinitionId } from '@/definition/DefinitionRepository';
import { addressKey } from '@/core/protocol/CustomValueCodec';
import { readValue, useMenuStore, type ValueEntry } from './useMenuStore';
import { applyBackup, buildBackup, type BackupFile, type ParseBackupResult } from '@/io/backup';
import { useDebugStore } from './useDebugStore';
import { useDefinitionStore } from './useDefinitionStore';
import { useKeymapStore, selectKeycode } from './useKeymapStore';
import { toErrorInfo } from '@/shared/result';
import { toast } from '@/ui/primitives/Toast';
import type { Unsubscribe } from '@/core/hid/HidTransport';

/** 判断异常是否意味着「设备已经不在了」（重启 / 进入 bootloader / 被拔出）。 */
function isGoneError(e: unknown): boolean {
  const name = e instanceof Error ? e.name : '';
  return name === 'TimeoutError' || name === 'DisconnectedError';
}

/**
 * 写入前钳制到控件合法区间。
 * ⚠️ range 的下限必须取 options[0]（35 个控件下限是 1 而不是 0），
 * 且宽度推断与下限是两个独立维度，这里只管值域，不管字节数。
 */
function clampValue(control: ControlSpec, value: number): number {
  if (control.options.kind === 'range') {
    const { min, max } = control.options;
    return Math.min(max, Math.max(min, Math.round(value)));
  }
  if (control.type === 'color') return Math.max(0, Math.min(0xffff, Math.round(value)));
  return Math.round(value) >>> 0;
}

/**
 * 连接态（T06-2 增 'lost'）：
 *  - 'lost' = 意外断连（设备被拔出 / 重启 / 进 bootloader），**刻意与主动断开区分**：
 *    保留键位与菜单的脏值（不 reset），供重连后继续编辑。
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'lost';

interface DeviceState {
  transportKind: TransportKind;
  devices: readonly HidDeviceInfo[];
  selectedDeviceId: string | null;
  state: ConnectionState;
  handshake: HandshakeResult | null;
  layoutOptions: number;
  error: string | null;
  busy: boolean;
  /** false = 只显示可控制的键盘；true = 列出全部已授权 HID（调试/救急） */
  showAllDevices: boolean;
  /** 最近一次扫描摘要：共 N 台已授权 HID，其中 M 台可控制 */
  scanSummary: ScanSummary | null;
  setShowAllDevices: (value: boolean) => void;
  setTransportKind: (kind: TransportKind) => void;
  refreshDevices: () => Promise<void>;
  selectDevice: (id: string | null) => void;
  connect: (deviceId?: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
  /** 意外断连处理：置 lost、清 facade/handshake，但保留键位/菜单脏值（禁 reset）。 */
  handleLost: (reason: string) => void;
  /** 连接后拉取全部层键位 */
  reloadKeymap: () => Promise<void>;
  applyKeycode: (layer: number, row: number, col: number, keycode: number) => Promise<boolean>;
  applyLayoutOptions: (value: number) => Promise<void>;
  // —— 菜单（T04）——
  /**
   * 懒加载某菜单的全部控件值（含被 showIf 隐藏的，因为要做条件变量）。
   * silent=true 用于连接后预载：只读不刷状态条，避免加载态闪烁。
   * force=true 用于「从设备重新读取」：绕过 loadedMenus 守卫并先清除
   * 回读不可信标记，让本次读取以设备为准（忽略本地缓存）。
   */
  menuLoad: (menuId: string, options?: { readonly silent?: boolean; readonly force?: boolean }) => Promise<void>;
  /** 乐观更新内存值 + 下发写入（range/color 走 200ms 防抖） */
  menuCommit: (control: ControlSpec, value: number) => Promise<boolean>;
  /** button 类动作：options 原样透传，执行后探活，设备消失则按断开处理 */
  menuTrigger: (control: ControlSpec) => Promise<boolean>;
  /**
   * 连接后预载全部菜单值：**只读**，把设备当前配置读进界面（读优先语义）。
   * 连接/重连后界面必须呈现设备真实值，绝不允许拿默认值冒充——否则用户一动控件就把配置写没了。
   */
  menuPreloadAll: () => Promise<void>;
  /** 把全部脏值刷入设备并逐个地址持久化（0x09） */
  menuSaveAll: () => Promise<number>;
  /** 启动时自动重连上次连接过的设备（记忆在 localStorage）；无记忆/设备不在时返回 false */
  autoReconnect: () => Promise<boolean>;
  /** 撤销会话中最近一次变更（R-P1-07） */
  undoLast: () => Promise<boolean>;
  undoDepth: () => number;
  deviceEepromReset: () => Promise<boolean>;
  // —— 宏缓冲区（VIA MACRO）——
  macroGetBuffer: (offset: number, size: number) => Promise<Uint8Array>;
  macroSetBuffer: (offset: number, data: Uint8Array) => Promise<void>;
  // —— 备份（T04.4）——
  backupExport: () => BackupFile | null;
  backupImport: (parsed: ParseBackupResult) => Promise<{ applied: number; missing: number }>;
}

/**
 * 设备自动识别：按设备的 VID/PID 在已保存的定义库中查找，命中即自动切换到对应配置。
 * 这样换一把键盘插上就能直接用它自己的配置，不必每次手工重新导入。
 * 未命中时保持当前定义（由调用方提示导入）。
 */
async function ensureDefinitionForDevice(device: HidDeviceInfo): Promise<ParsedDefinition | null> {
  const saved = await findByVidPid(device.vendorId, device.productId).catch(() => null);
  if (saved?.raw) {
    const current = useDefinitionStore.getState().definition;
    const currentId = current ? `${current.vid}:${current.pid}` : null;
    const savedId = `${parseId(saved.raw.vendorId)}:${parseId(saved.raw.productId)}`;
    if (currentId !== savedId) {
      useDefinitionStore.getState().loadFromJson(saved.raw, saved.meta.name);
    }
    // 记住这把设备对应的定义，下次启动自动恢复
    await setCurrentDefinitionId(saved.meta.id).catch(() => undefined);
  }
  return useDefinitionStore.getState().definition;
}

/**
 * 定义库里已登记设备的 "vid:pid"（十进制）列表。
 * 命中即视为「可控制」——覆盖固件没规范声明 VIA RAW HID usage、但用户已导入定义的情况。
 * 取不到时退化为空列表（只按 usage 过滤），不让扫描整体失败。
 */
async function knownDefinitionIds(): Promise<string[]> {
  try {
    const metas = await listDefinitions();
    return metas.map((meta) => knownIdKey(parseId(meta.vendorId), parseId(meta.productId)));
  } catch {
    return [];
  }
}

/** 组装 listDevices 的过滤选项：includeAll 为 true 时旁路过滤（调试/救急）。 */
async function buildListOptions(includeAll: boolean): Promise<ListDevicesOptions> {
  return { includeAll, knownIds: await knownDefinitionIds() };
}

/** 句柄放在模块作用域：避免把不可序列化的对象放进 store 引发多余重渲染。 */
let facade: DeviceFacade | null = null;
/** 当前 facade 所用传输层的断连订阅退订函数（T06-2）。 */
let unsubscribeDisconnect: Unsubscribe | null = null;
/**
 * 主动断开守卫（T06-2 正确性前提）：disconnect() 全程置位，
 * 防止主动 close 过程中（或竞态窗口内）传输层的断连事件把状态误标为 'lost'。
 */
let intentionalClose = false;

export function getFacade(): DeviceFacade | null {
  return facade;
}

const EMPTY_DEVICES: readonly HidDeviceInfo[] = [];

/** 记忆设备的 localStorage 键（下次启动自动重连用）。 */
const LAST_DEVICE_KEY = 'keydriver.lastDevice';

/** 按运行环境选默认传输：Tauri → 原生桥；有 WebHID → WebHID；测试/兜底 → Dummy。 */
function defaultTransportKind(): TransportKind {
  if (typeof window === 'undefined') return 'dummy';
  // 测试/自动化逃生门：?transport=dummy|webhid|nodehid 强制指定（UI 不暴露入口）
  try {
    const forced = new URLSearchParams(window.location.search).get('transport');
    if (forced === 'dummy' || forced === 'webhid' || forced === 'nodehid') return forced;
  } catch {
    // URL 解析失败按环境默认
  }
  if ('__TAURI_INTERNALS__' in window) return 'nodehid';
  if (typeof navigator !== 'undefined' && 'hid' in navigator) return 'webhid';
  return 'dummy';
}

/** 记忆本次连接成功的设备（隐私模式等 localStorage 不可用时静默跳过）。 */
function rememberDevice(device: HidDeviceInfo): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      LAST_DEVICE_KEY,
      JSON.stringify({
        vendorId: device.vendorId,
        productId: device.productId,
        productName: device.productName,
        serialNumber: device.serialNumber ?? null,
      }),
    );
  } catch {
    // localStorage 不可用（隐私模式/配额）：记忆失败不影响连接本身
  }
}

interface RememberedDevice {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly serialNumber: string | null;
}

function readRememberedDevice(): RememberedDevice | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAST_DEVICE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as RememberedDevice).vendorId === 'number' &&
      typeof (parsed as RememberedDevice).productId === 'number'
    ) {
      return parsed as RememberedDevice;
    }
    return null;
  } catch {
    return null;
  }
}

export const useDeviceStore = create<DeviceState>((set, get) => ({
  transportKind: defaultTransportKind(),
  devices: EMPTY_DEVICES,
  selectedDeviceId: null,
  state: 'disconnected',
  handshake: null,
  layoutOptions: 0,
  error: null,
  busy: false,
  showAllDevices: false,
  scanSummary: null,

  setShowAllDevices: (value) => {
    set({ showAllDevices: value });
    // 开关一变就重扫：否则用户看到的还是上一次过滤的结果
    void get().refreshDevices();
  },

  setTransportKind: (transportKind) => set({ transportKind, devices: EMPTY_DEVICES, selectedDeviceId: null }),

  refreshDevices: async () => {
    const { transportKind, showAllDevices } = get();
    try {
      const transport = createTransport({ kind: transportKind, dummy: dummyConfigFromDefinition() });
      const devices = await transport.listDevices(await buildListOptions(showAllDevices));
      set({
        devices,
        scanSummary: transport.lastScan ?? null,
        selectedDeviceId: get().selectedDeviceId ?? devices[0]?.id ?? null,
      });
    } catch (e) {
      set({ error: toErrorInfo(e).message });
    }
  },

  selectDevice: (selectedDeviceId) => set({ selectedDeviceId }),

  connect: async (deviceId) => {
    const { transportKind, devices } = get();
    const id = deviceId ?? get().selectedDeviceId;
    set({ state: 'connecting', error: null, busy: true });
    try {
      const transport = createTransport({ kind: transportKind, dummy: dummyConfigFromDefinition() });
      const list = devices.length > 0 ? devices : await transport.listDevices(await buildListOptions(get().showAllDevices));
      const device = list.find((d) => d.id === id) ?? list[0];
      if (!device) {
        set({ state: 'error', error: '未找到可用设备', busy: false });
        return false;
      }
      // 先按设备的 VID/PID 自动切换到定义库里对应的配置，再判断是否已具备可用定义
      const definition = await ensureDefinitionForDevice(device);
      if (!definition) {
        set({ state: 'error', error: '请先导入定义文件', busy: false });
        return false;
      }
      facade = createDeviceFacade(transport, device, {
        definition,
        onFrame: (record) => useDebugStore.getState().pushFrame(record),
        onWarning: (warning) => useDebugStore.getState().pushWarning(warning),
      });
      // T06-2：订阅传输层断连事件（Dummy 的 simulateDisconnect / WebHID 的 disconnect）
      // → 走 lost 状态机。旧订阅先退订，防重复触发。
      unsubscribeDisconnect?.();
      unsubscribeDisconnect = transport.onDisconnect((info) => {
        get().handleLost(`设备「${info.productName}」已从系统中移除`);
      });
      const result = await facade.connect();
      set({ state: 'connected', handshake: result, layoutOptions: result.layoutOptions, busy: false, devices: list });
      rememberDevice(device);
      await get().reloadKeymap();
      // 读优先：把设备当前配置读进界面（只读，零写入）——界面必须呈现设备真实值
      await get().menuPreloadAll();
      // 重连对账：固件回读撒谎时把可信缓存重新下发到设备，避免 reload 后灯灭 / 配置丢失
      // （reload 走 beforeunload，落盘不可靠；冷启动有关窗可靠落盘，故只有 reload 复现）。
      await facade?.reconcileFromCache().catch(() => undefined);
      return true;
    } catch (e) {
      const info = toErrorInfo(e);
      set({ state: 'error', error: info.message, busy: false });
      useDebugStore.getState().pushWarning({
        level: 'warn',
        title: '连接失败',
        detail: info.message,
        rawHex: info.rawHex,
      });
      facade = null;
      // 连接失败即丢弃 transport：必须退订本次订阅的断连监听，
      // 否则残留回调会在用户之后拔设备时把 'error' 态误报成 'lost' 并弹 Toast。
      unsubscribeDisconnect?.();
      unsubscribeDisconnect = null;
      return false;
    }
  },

  disconnect: async () => {
    // T06-2：先置位守卫再断开——主动断开期间传输层若冒出断连事件，不得误报 lost。
    intentionalClose = true;
    try {
      await facade?.disconnect();
    } catch {
      // 断开失败也要重置本地态
    }
    unsubscribeDisconnect?.();
    unsubscribeDisconnect = null;
    facade = null;
    intentionalClose = false;
    set({ state: 'disconnected', handshake: null, busy: false });
    useKeymapStore.getState().reset();
    useMenuStore.getState().reset();
  },

  /**
   * 启动自动重连：读取记忆的上次设备，在当前列表里按 VID/PID（+序列号）匹配后静默重连。
   * 记忆在每次 connect 成功时写入（rememberDevice）；拔出/lost 不清除——设备重新插上仍可连。
   * AppShell 挂载时调用一次。
   */
  autoReconnect: async () => {
    const { note } = await import('@/shared/note');
    const saved = readRememberedDevice();
    if (saved === null) {
      void note('auto-reconnect: no memory');
      return false;
    }
    void note(`auto-reconnect: memory vid=0x${saved.vendorId.toString(16)} pid=0x${saved.productId.toString(16)}`);
    await get().refreshDevices();
    const devices = get().devices;
    void note(`auto-reconnect: listed ${devices.length} devices`);
    // ⚠️ 必须限 viaCapable：键盘的非 VIA 接口（标准键盘/HID 接口）vid/pid/序列号完全相同，
    // 只按 vid/pid 匹配会连到打字接口上——握手必败，表现为「假连接」
    const match = devices.find(
      (d) =>
        d.viaCapable === true &&
        d.vendorId === saved.vendorId &&
        d.productId === saved.productId &&
        (saved.serialNumber === null || d.serialNumber === saved.serialNumber),
    );
    if (!match) {
      void note('auto-reconnect: no match');
      return false;
    }
    void note(`auto-reconnect: matching ${match.productName}, initiating connection`);
    const ok = await get().connect(match.id);
    void note(`auto-reconnect: connect=${ok ? 'ok' : 'fail'}`);
    return ok;
  },

  /**
   * 意外断连（T06-2）：置 lost、清 facade/handshake、busy 复位（写队列随 facade 丢弃，
   * flushWrites 失败由 ValueWriteQueue.onError 静默记录）。
   * ⚠️ 刻意**不调用** useKeymapStore.reset() / useMenuStore.reset()：断连保留脏值，
   * 与主动断开（disconnect，全部重置）区分，重连后用户可继续编辑。
   */
  handleLost: (reason) => {
    if (intentionalClose) return;
    facade = null;
    unsubscribeDisconnect?.();
    unsubscribeDisconnect = null;
    set({ state: 'lost', handshake: null, busy: false, error: reason });
    toast.error('设备已断开');
    useDebugStore.getState().pushWarning({
      level: 'warn',
      title: '设备已断开',
      detail: reason,
    });
  },

  reloadKeymap: async () => {
    const active = facade;
    if (!active) return;
    const keymap = useKeymapStore.getState();
    const layerCount = active.getLayerCount();
    keymap.setLoading(true, 0);
    try {
      const layers: Uint16Array[] = [];
      for (let layer = 0; layer < layerCount; layer += 1) {
        layers.push(await active.getKeymap(layer));
        keymap.setLoading(true, Math.round(((layer + 1) / layerCount) * 100));
      }
      const definition = useDefinitionStore.getState().definition;
      useKeymapStore.getState().setLayers(
        layers,
        definition?.matrix.rows ?? 0,
        definition?.matrix.cols ?? 0,
      );
      set({ layoutOptions: await active.getLayoutOptions() });
      keymap.setLoading(false, 100);
    } catch (e) {
      keymap.setLoading(false, 0);
      set({ error: toErrorInfo(e).message });
    }
  },

  applyKeycode: async (layer, row, col, keycode) => {
    const active = facade;
    if (!active) return false;
    set({ busy: true });
    try {
      await active.setKeycode(layer, row, col, keycode);
      useKeymapStore.getState().setKeycode(layer, row, col, keycode);
      useKeymapStore.getState().markClean(layer, row, col);
      set({ busy: false, error: null });
      return true;
    } catch (e) {
      set({ busy: false, error: toErrorInfo(e).message });
      return false;
    }
  },

  applyLayoutOptions: async (value) => {
    const active = facade;
    if (!active) return;
    try {
      await active.setLayoutOptions(value);
      set({ layoutOptions: value });
    } catch (e) {
      set({ error: toErrorInfo(e).message });
    }
  },

  // —— 菜单 ——

  menuLoad: async (menuId, options) => {
    const active = facade;
    const definition = useDefinitionStore.getState().definition;
    if (!active || !definition) return;
    const controls = definition.controlsByMenu.get(menuId) ?? [];
    const force = options?.force === true;
    // 强制重读：用户显式选择信任设备——先摘掉「回读不可信」标记，
    // 本次及后续读取都以设备回读为准（缓存优先逻辑随标记一同失效）。
    if (force) active.clearDistrustFor(controls);
    if (!force && useMenuStore.getState().loadedMenus.has(menuId)) return;
    const silent = options?.silent === true;
    const menu = useMenuStore.getState();
    if (!silent) menu.setStatus('loading', 0, null);
    const entries: ValueEntry[] = [];
    let done = 0;
    for (const control of controls) {
      try {
        const readBack = await active.readValue(control);
        // 缓存优先解析（固件回读撒谎的对策）：不可信地址展示上次真实配置，
        // 可信地址照常信任回读并同步缓存。
        const resolved = active.resolveDisplayValue(control, readBack);
        // BugFix C：回读不可靠的地址（写入成功但固件回读恒 0 / 校验失败），
        // 保留用户已输入的乐观值，不让固件坏回读覆盖界面（衔接 f631fff 反清零）。
        const key = addressKey(control.address);
        const existing = useMenuStore.getState().addressValues[key];
        entries.push({
          control,
          value: existing !== undefined && active.isReadbackUnreliable(key) ? existing : resolved.value,
        });
      } catch {
        // 单个控件读失败不阻断整菜单：保留默认值，错误已由门面记录到调试面板
      }
      done += 1;
      if (!silent && (done % 8 === 0 || done === controls.length)) {
        useMenuStore
          .getState()
          .setStatus('loading', Math.round((done / Math.max(1, controls.length)) * 100));
      }
    }
    useMenuStore.getState().hydrate(menuId, entries);
    if (!silent) useMenuStore.getState().setStatus('ready', 100);
  },

  menuCommit: async (control, value) => {
    const active = facade;
    if (!active) return false;
    const next = clampValue(control, value);
    const before = readValue(useMenuStore.getState(), control);
    // 乐观更新：同一地址的全部控件（快捷入口）立即同步刷新
    useMenuStore.getState().setValue(control, next);
    try {
      if (control.type === 'range' || control.type === 'color') {
        // 拖动/取色是高频输入，必须防抖，否则会把 EEPROM 写穿
        active.writeValueDebounced(control, next);
      } else {
        await active.writeValueNow(control, next);
      }
      active.session.pushChange({ kind: 'value', target: control.id, before, after: next });
      return true;
    } catch (e) {
      const info = toErrorInfo(e);
      set({ error: info.message });
      useDebugStore.getState().pushWarning({
        level: 'warn',
        title: '控件写入失败',
        detail: `${control.label || control.valueKey}：${info.message}`,
        rawHex: info.rawHex,
      });
      return false;
    }
  },

  menuTrigger: async (control) => {
    const active = facade;
    if (!active) return false;
    set({ busy: true, error: null });
    try {
      // options 字节原样透传（含那个 [1]）——UI 上看不出差别，只有报文能证伪
      await active.triggerAction(control);
      // 动作可能让设备重启或进入 bootloader：探活，失败即按断开处理
      let alive = true;
      try {
        await active.protocol.getProtocolVersion();
      } catch (e) {
        alive = !isGoneError(e);
      }
      if (!alive) {
        // 动作后设备消失属「意外断连」：走 lost 状态机保留脏值（主动 disconnect 会清空）
        get().handleLost('动作执行后设备无响应，可能已重启或进入了 bootloader');
      }
      set({ busy: false });
      return true;
    } catch (e) {
      const info = toErrorInfo(e);
      set({ busy: false, error: info.message });
      useDebugStore.getState().pushWarning({
        level: 'warn',
        title: '动作执行失败',
        detail: `${control.label || control.valueKey}：${info.message}`,
        rawHex: info.rawHex,
      });
      return false;
    }
  },

  menuPreloadAll: async () => {
    const active = facade;
    const definition = useDefinitionStore.getState().definition;
    if (!active || !definition) return;
    for (const menu of definition.menus) {
      await get().menuLoad(menu.id, { silent: true });
    }
  },

  menuSaveAll: async () => {
    const active = facade;
    const definition = useDefinitionStore.getState().definition;
    if (!active || !definition) return 0;
    set({ busy: true });
    try {
      await active.flushWrites();
      const dirtyIds = [...useMenuStore.getState().dirty];
      // 同一地址只需保存一次（快捷入口的两个控件指向同一地址）
      const seen = new Set<string>();
      const targets: ControlSpec[] = [];
      for (const id of dirtyIds) {
        const control = definition.controlById.get(id);
        if (!control) continue;
        const key = addressKey(control.address);
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push(control);
      }
      for (const control of targets) {
        await active.saveValue(control);
        useMenuStore.getState().markClean(control.id);
      }
      set({ busy: false });
      return targets.length;
    } catch (e) {
      set({ busy: false, error: toErrorInfo(e).message });
      return 0;
    }
  },

  undoLast: async () => {
    const active = facade;
    if (!active) return false;
    const entry = active.session.popChange();
    if (!entry) return false;
    if (entry.kind === 'value') {
      const definition = useDefinitionStore.getState().definition;
      const control = definition?.controlById.get(entry.target);
      if (!control) return false;
      return get().menuCommit(control, entry.before);
    }
    if (entry.kind === 'layoutOptions') {
      await get().applyLayoutOptions(entry.before);
      return true;
    }
    const parts = entry.target.split(':').map((n) => Number.parseInt(n, 10));
    const layer = parts[0] ?? 0;
    const row = parts[1] ?? 0;
    const col = parts[2] ?? 0;
    return get().applyKeycode(layer, row, col, entry.before);
  },

  undoDepth: () => facade?.session.undoDepth ?? 0,

  deviceEepromReset: async () => {
    const active = facade;
    if (!active) return false;
    set({ busy: true });
    try {
      await active.eepromReset();
      // 复位后内存中的值全部作废，强制下次打开菜单重新拉取
      useMenuStore.getState().reset();
      await get().reloadKeymap();
      set({ busy: false });
      return true;
    } catch (e) {
      set({ busy: false, error: toErrorInfo(e).message });
      return false;
    }
  },

  // —— 备份 ——

  macroGetBuffer: async (offset, size) => {
    const active = facade;
    if (!active) return new Uint8Array(size);
    return active.getMacroBuffer(offset, size);
  },

  macroSetBuffer: async (offset, data) => {
    const active = facade;
    if (!active) return;
    await active.setMacroBuffer(offset, data);
  },

  backupExport: () => {
    const definition = useDefinitionStore.getState().definition;
    if (!definition) return null;
    const keymap = useKeymapStore.getState();
    const values: Record<string, number> = {};
    for (const control of definition.controls) {
      values[control.id] = readValue(useMenuStore.getState(), control);
    }
    return buildBackup({
      definition,
      layers: keymap.layers,
      layoutOptions: get().layoutOptions,
      values,
    });
  },

  backupImport: async (parsed) => {
    const active = facade;
    const definition = useDefinitionStore.getState().definition;
    if (!active || !definition || !parsed.ok) return { applied: 0, missing: 0 };
    set({ busy: true });
    try {
      const { entries, missing } = applyBackup(definition, parsed.backup);
      for (const entry of entries) {
        await get().menuCommit(entry.control, entry.value);
      }
      await active.flushWrites();
      // 布局选项与键位一并还原
      await get().applyLayoutOptions(parsed.backup.layoutOptions);
      for (let layer = 0; layer < parsed.backup.layers.length; layer += 1) {
        const data = parsed.backup.layers[layer];
        if (!data) continue;
        for (let i = 0; i < data.length; i += 1) {
          const col = i % Math.max(1, definition.matrix.cols);
          const row = Math.floor(i / Math.max(1, definition.matrix.cols));
          const keycode = data[i] ?? 0;
          if (selectKeycode(useKeymapStore.getState(), layer, row, col) === keycode) continue;
          await get().applyKeycode(layer, row, col, keycode);
        }
      }
      set({ busy: false });
      return { applied: entries.length, missing };
    } catch (e) {
      set({ busy: false, error: toErrorInfo(e).message });
      return { applied: 0, missing: 0 };
    }
  },
}));

/** Dummy 使用当前定义文件的 VID/PID 与矩阵尺寸（架构 U7）。 */
export function dummyConfigFromDefinition(): Partial<DummyConfig> {
  const definition = useDefinitionStore.getState().definition;
  if (!definition) return {};
  return {
    vendorId: definition.vid,
    productId: definition.pid,
    rows: definition.matrix.rows,
    cols: definition.matrix.cols,
    layerCount: 4,
  };
}

// —— 热插拔看门狗（R3 补全）——
// hidapi 没有设备到达事件（macOS），WebHID 的 connect 事件在部分内核也不可靠；
// 未连接状态下周期性重扫设备列表：插上键盘 → 列表自动出现 → 记忆设备自动重连。
const HOTPLUG_INTERVAL_MS = 2000;

let watchTimer: ReturnType<typeof setInterval> | null = null;
/** 防重入：上一轮枚举还没回来时不叠加（枚举走 IPC/USB，串行最稳）。 */
let polling = false;

/**
 * 单次到达轮询（导出仅供测试与看门狗复用）：
 *  - 仅在 disconnected / lost 态生效（connected 有断连轮询管，error 交给用户处理）；
 *  - 发现记忆设备（viaCapable + VID/PID + 序列号）即静默重连。
 */
export async function pollDeviceArrivalOnce(): Promise<void> {
  if (polling) return;
  const { state, busy } = useDeviceStore.getState();
  if (busy || (state !== 'disconnected' && state !== 'lost')) return;
  polling = true;
  try {
    await useDeviceStore.getState().refreshDevices();
    const saved = readRememberedDevice();
    if (saved === null) return;
    // 与 autoReconnect 同一套匹配口径：必须限 viaCapable（多接口复合设备的 vid/pid 相同）
    const match = useDeviceStore
      .getState()
      .devices.find(
        (d) =>
          d.viaCapable === true &&
          d.vendorId === saved.vendorId &&
          d.productId === saved.productId &&
          (saved.serialNumber === null || d.serialNumber === saved.serialNumber),
      );
    if (match) await useDeviceStore.getState().connect(match.id);
  } catch {
    // 轮询失败静默：下一轮再试
  } finally {
    polling = false;
  }
}

/** 启动热插拔看门狗（幂等）。AppShell 挂载时调用。 */
export function startHotplugWatch(): void {
  if (watchTimer !== null || typeof window === 'undefined') return;
  watchTimer = setInterval(() => {
    void pollDeviceArrivalOnce();
  }, HOTPLUG_INTERVAL_MS);
}

/** 停止看门狗（测试清理用）。 */
export function stopHotplugWatch(): void {
  if (watchTimer !== null) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
  polling = false;
}
