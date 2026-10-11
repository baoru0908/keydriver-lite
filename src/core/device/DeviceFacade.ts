// 设备门面：UI 唯一允许调用的业务 API（架构 §4.2.5）。所有设备操作经此，保证报文全部被记录。
import type { ControlSpec, ParsedDefinition } from '@/definition/schema';
import type { HidDeviceInfo, HidTransport } from '@/core/hid/HidTransport';
import { DummyTransport } from '@/core/hid/DummyTransport';
import { ViaProtocol, type FrameRecord } from '@/core/protocol/ViaProtocol';
import { KB_VALUE_ID, KEYMAP_BUFFER_CHUNK } from '@/core/protocol/constants';
import { inferWidth, loadOverrides, type WidthOverrides } from '@/core/protocol/ValueWidth';
import { DeviceSession } from './DeviceSession';
import { ValueWriteQueue } from './ValueWriteQueue';
import { runHandshake, type HandshakeResult, type ProtocolWarning } from './handshake';
import { addressKey } from '@/core/protocol/CustomValueCodec';
import { createLogger } from '@/shared/log';

const log = createLogger('DeviceFacade');

export interface DeviceInfo {
  readonly device: HidDeviceInfo;
  readonly transportKind: HidTransport['kind'];
}

export interface DeviceFacadeOptions {
  readonly definition?: ParsedDefinition | null;
  readonly onFrame?: (record: FrameRecord) => void;
  readonly onWarning?: (warning: ProtocolWarning) => void;
  readonly timeoutMs?: number;
}

/** 自动落盘空闲等待（ms）：SET 后 1.5s 内无新改动才发 0x09，兼顾即时性与 EEPROM 寿命。 */
const AUTO_SAVE_IDLE_MS = 1500;

export class DeviceFacade {
  readonly protocol: ViaProtocol;
  readonly session = new DeviceSession();
  readonly info: DeviceInfo;

  private definition: ParsedDefinition | null;
  private readonly writeQueue: ValueWriteQueue;
  private readonly verified = new Set<string>();
  /**
   * 回读不可靠地址集（BugFix C）：写入已成功（SET 无异常）但回读校验不一致或探测失败的地址。
   * UI 依据此集合在重水合时保留用户乐观值，不让固件坏回读覆盖用户输入。
   */
  private readonly unreliableReadback = new Set<string>();
  private readonly onWarning?: (warning: ProtocolWarning) => void;
  private opened = false;
  /** 宏缓冲区总字节数缓存（连接后由 getMacroSize 回填，未连接时取 64 兜底）。 */
  private macroBufferSizeValue = 64;
  /** 自动落盘：地址 → 待执行定时器（空闲防抖，避免 EEPROM 写穿）。 */
  private readonly autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** 地址 → 最近一次改动的控件（定时器触发时需要它发 0x09）。 */
  private readonly autoSaveControls = new Map<string, ControlSpec>();
  private autoSaveEnabled = true;

  constructor(
    readonly transport: HidTransport,
    device: HidDeviceInfo,
    options: DeviceFacadeOptions = {},
  ) {
    this.info = { device, transportKind: transport.kind };
    this.definition = options.definition ?? null;
    this.onWarning = options.onWarning;
    this.protocol = new ViaProtocol(transport, {
      timeoutMs: options.timeoutMs,
      onFrame: options.onFrame,
    });
    this.writeQueue = new ValueWriteQueue(
      (control, value) => this.writeValueDirect(control, value),
      {
        onError: (control, value, e) => {
          log.error('值写入失败', { controlId: control.id, value, error: e });
          this.onWarning?.({
            level: 'warn',
            title: '值写入失败',
            detail: `${control.label || control.valueKey}：${e instanceof Error ? e.message : String(e)}`,
          });
        },
      },
    );
  }

  get isConnected(): boolean {
    return this.opened && this.session.isConnected;
  }

  get currentDefinition(): ParsedDefinition | null {
    return this.definition;
  }

  /** 设置/切换当前定义文件（Dummy 会据此预置默认状态）。 */
  setDefinition(definition: ParsedDefinition | null): void {
    this.definition = definition;
    if (definition && this.transport instanceof DummyTransport && this.transport.isOpen) {
      this.seedDummy(definition);
    }
  }

  /** 连接并执行握手。 */
  async connect(): Promise<HandshakeResult> {
    if (!this.transport.isOpen) {
      await this.transport.open(this.info.device);
    }
    this.opened = true;
    if (this.definition && this.transport instanceof DummyTransport) {
      this.seedDummy(this.definition);
    }
    const result = await runHandshake(this.protocol, {
      definition: this.definition,
      onWarning: this.onWarning,
    });
    this.session.setHandshake(result);
    return result;
  }

  async disconnect(): Promise<void> {
    // 断开前把待落盘的改动写进 EEPROM：否则用户退出后配置丢失（SET 只改 RAM）
    await this.flushAutoSaves().catch(() => undefined);
    await this.writeQueue.flush().catch(() => undefined);
    this.opened = false;
    this.session.reset();
    if (this.transport.isOpen) await this.transport.close();
  }

  getLayerCount(): number {
    return this.session.handshake?.layerCount ?? 1;
  }

  // —— 键位 ——

  /** 读取整层键位（28 字节分块；不支持缓冲区命令时退化为逐键读取）。 */
  async getKeymap(layer: number): Promise<Uint16Array> {
    const definition = this.requireDefinition();
    const { rows, cols } = definition.matrix;
    const out = new Uint16Array(rows * cols);
    const byteTotal = rows * cols * 2;
    const base = layer * byteTotal;
    try {
      for (let offset = 0; offset < byteTotal; offset += KEYMAP_BUFFER_CHUNK) {
        const size = Math.min(KEYMAP_BUFFER_CHUNK, byteTotal - offset);
        const chunk = await this.protocol.getKeymapBuffer(base + offset, size);
        for (let i = 0; i + 1 < size; i += 2) {
          out[(offset + i) / 2] = ((chunk[i] ?? 0) << 8) | (chunk[i + 1] ?? 0);
        }
      }
      return out;
    } catch (e) {
      log.warn('缓冲区读取失败，退化为逐键读取', e);
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          out[row * cols + col] = await this.protocol.getKeycode(layer, row, col);
        }
      }
      return out;
    }
  }

  /** 写单个键位并回读自校验（R-P0-08）。 */
  async setKeycode(layer: number, row: number, col: number, keycode: number): Promise<void> {
    await this.protocol.setKeycode(layer, row, col, keycode);
    const readBack = await this.protocol.getKeycode(layer, row, col);
    if (readBack !== (keycode & 0xffff)) {
      this.onWarning?.({
        level: 'warn',
        title: '键码回读不一致',
        detail: `layer ${layer} (${row},${col}) 写入 0x${(keycode & 0xffff).toString(16)}，读回 0x${readBack.toString(16)}`,
      });
    }
    this.session.pushChange({
      kind: 'keycode',
      target: `${layer}:${row}:${col}`,
      before: readBack,
      after: keycode & 0xffff,
    });
  }

  async resetKeymap(): Promise<void> {
    await this.protocol.resetKeymap();
  }

  // —— 布局选项 ——

  async getLayoutOptions(): Promise<number> {
    return this.protocol.getKeyboardValue(KB_VALUE_ID.LAYOUT_OPTIONS);
  }

  async setLayoutOptions(value: number): Promise<void> {
    const before = await this.getLayoutOptions().catch(() => 0);
    await this.protocol.setKeyboardValue(KB_VALUE_ID.LAYOUT_OPTIONS, value);
    this.session.pushChange({ kind: 'layoutOptions', target: 'layout', before, after: value });
  }

  // —— 自定义值 ——

  /**
   * 某地址的回读是否不可靠（写入成功但回读校验不一致 / 探测失败）。
   * UI 重水合（menuLoad）应保留该地址的用户乐观值（BugFix C）。
   */
  isReadbackUnreliable(addressKeyStr: string): boolean {
    return this.unreliableReadback.has(addressKeyStr);
  }

  async readValue(control: ControlSpec, overrides?: WidthOverrides): Promise<number> {
    const width = inferWidth(control, overrides ?? loadOverrides());
    return this.protocol.customGetValue(control.address, width);
  }

  /** 立即写入（toggle / dropdown / keycode / button）。 */
  async writeValueNow(control: ControlSpec, value: number): Promise<void> {
    await this.writeQueue.writeNow(control, value);
  }

  /** 防抖写入（range / color，200ms）。 */
  writeValueDebounced(control: ControlSpec, value: number): void {
    this.writeQueue.writeDebounced(control, value);
  }

  async flushWrites(): Promise<void> {
    await this.writeQueue.flush();
  }

  /** 0x09：把某地址持久化到 EEPROM。 */
  async saveValue(control: ControlSpec): Promise<void> {
    await this.writeQueue.flush();
    await this.protocol.customSave(control.address);
    this.session.clearDirty('value', control.id);
  }

  // —— 自动落盘（VIA 语义：SET 只改 RAM，必须 0x09 才写 EEPROM）——
  //
  // QMK via.c 实证：id_custom_set_value 走 *_noeeprom()（断电即丢），
  // id_custom_save 才 eeprom 持久化。不落盘 = 每次开机配置回到出厂值。
  // 拖动/取色是高频写入，故按「空闲 1.5s」防抖落盘，避免把 EEPROM 写穿。

  /** 空闲多久后落盘（同一地址连续改动只落最后一次）。 */
  private scheduleAutoSave(control: ControlSpec): void {
    if (!this.autoSaveEnabled) return;
    const key = addressKey(control.address);
    const pending = this.autoSaveTimers.get(key);
    if (pending !== undefined) clearTimeout(pending);
    const timer = setTimeout(() => {
      this.autoSaveTimers.delete(key);
      void this.runAutoSave(control);
    }, AUTO_SAVE_IDLE_MS);
    this.autoSaveTimers.set(key, timer);
  }

  private async runAutoSave(control: ControlSpec): Promise<void> {
    try {
      await this.writeQueue.flush();
      await this.protocol.customSave(control.address);
      this.session.clearDirty('value', control.id);
    } catch (e) {
      this.onWarning?.({
        level: 'warn',
        title: '配置落盘失败',
        detail: `${control.label || control.valueKey}：${e instanceof Error ? e.message : String(e)}（值已生效，但重开设备会丢失）`,
      });
    }
  }

  /** 立即执行全部待落盘保存（断开连接 / 退出前调用）。 */
  async flushAutoSaves(): Promise<void> {
    const controls = [...this.autoSaveTimers.keys()];
    for (const key of controls) {
      const timer = this.autoSaveTimers.get(key);
      if (timer === undefined) continue;
      clearTimeout(timer);
      this.autoSaveTimers.delete(key);
      const control = this.autoSaveControls.get(key);
      if (control) await this.runAutoSave(control);
    }
  }

  /** 取消全部待落盘保存（设备已断开等场景，避免对空 facade 发帧）。 */
  cancelAutoSaves(): void {
    for (const timer of this.autoSaveTimers.values()) clearTimeout(timer);
    this.autoSaveTimers.clear();
  }

  /** 是否开启自动落盘（默认开启；可在设置里关掉改为手动 ⌘S）。 */
  setAutoSaveEnabled(enabled: boolean): void {
    this.autoSaveEnabled = enabled;
    if (!enabled) this.cancelAutoSaves();
  }

  /** button 类动作：options 字节原样透传（U3）。 */
  async triggerAction(control: ControlSpec, arg?: number): Promise<void> {
    const args = control.options.kind === 'action' ? control.options.args : [];
    await this.protocol.customTrigger(control.address, arg !== undefined ? [arg] : args);
  }

  async eepromReset(): Promise<void> {
    await this.protocol.eepromReset();
  }

  // —— 宏缓冲区（VIA MACRO） ——

  /** 读取整段宏缓冲区（按 28 字节分块拼接）。 */
  async getMacroBuffer(offset: number, size: number): Promise<Uint8Array> {
    const out = new Uint8Array(size);
    for (let off = 0; off < size; off += KEYMAP_BUFFER_CHUNK) {
      const chunk = await this.protocol.getMacroBuffer(
        offset + off,
        Math.min(KEYMAP_BUFFER_CHUNK, size - off),
      );
      out.set(chunk, off);
    }
    return out;
  }

  /** 写入整段宏缓冲区（按 28 字节分块下发）。 */
  async setMacroBuffer(offset: number, data: Uint8Array): Promise<void> {
    for (let off = 0; off < data.length; off += KEYMAP_BUFFER_CHUNK) {
      await this.protocol.setMacroBuffer(offset + off, data.subarray(off, off + KEYMAP_BUFFER_CHUNK));
    }
  }

  /** 读取宏缓冲区总字节数，并回填同步 getter。 */
  async getMacroSize(): Promise<number> {
    const size = await this.protocol.getMacroSize();
    this.macroBufferSizeValue = size;
    return size;
  }

  /** 同步兜底：宏缓冲区总字节数（未查询前为 64）。 */
  get macroBufferSize(): number {
    return this.macroBufferSizeValue;
  }

  // —— 内部 ——

  private async writeValueDirect(control: ControlSpec, value: number): Promise<void> {
    const overrides = loadOverrides();
    const width = inferWidth(control, overrides);
    await this.protocol.customSetValue(control.address, value, width);
    const key = addressKey(control.address);
    // 首次写入该地址时做回读自校验（架构 §8.3）。
    // ⚠️ 自校验**只读不写**：回读不一致时绝不能用 alt 宽度「重写设备」——写入是强副作用，
    // 且 2 字节大端编码值 ≤255 时首字节恒 0，对 1 字节 value_id 的重写会把控件值清零
    // （真机 bug：Backlight Brightness/Effect Speed 滑块被清零且恒读回 0）。
    // alt 只做**读取**探测以给出建议宽度，最终是否覆盖由用户在调试面板决定。
    if (!this.verified.has(key)) {
      this.verified.add(key);
      // ⚠️ 探测全程 try/catch（BugFix A）：回读探测失败（超时/断连）绝不能把错误抛回
      // 写入链路——SET 已经成功，设备已收到值；探测挂了只影响「校验」，不影响「写入」。
      try {
        const readBack = await this.protocol.customGetValue(control.address, width);
        if (readBack !== (value >>> 0)) {
          const alt = width === 1 ? 2 : 1;
          const altRead = await this.protocol.customGetValue(control.address, alt);
          // 回读不可靠（BugFix C）：UI 保留乐观值的依据
          this.unreliableReadback.add(key);
          this.onWarning?.({
            level: 'warn',
            title: '值宽度可能不正确',
            detail:
              altRead === (value >>> 0)
                ? `地址 ${key} 使用 ${alt} 字节回读一致，可在调试面板把宽度覆盖为 ${alt}`
                : `地址 ${key} 回读不一致（写入 ${value}，读回 ${readBack}）`,
          });
        }
      } catch (e) {
        this.unreliableReadback.add(key);
        this.onWarning?.({
          level: 'warn',
          title: '回读校验失败',
          detail: `地址 ${key} 写入已完成，但回读校验未完成（${e instanceof Error ? e.message : String(e)}），界面值以用户输入为准`,
        });
      }
    }
    this.session.markDirty('value', control.id);
    // VIA 语义：SET 只改 RAM，必须 0x09 落盘才会写进 EEPROM（否则每次开机配置回到出厂值）。
    this.autoSaveControls.set(key, control);
    this.scheduleAutoSave(control);
  }

  private requireDefinition(): ParsedDefinition {
    if (!this.definition) {
      throw new Error('尚未加载定义文件，无法读取键位');
    }
    return this.definition;
  }

  /** 用定义文件预置 Dummy 固件状态（键位顺序 + 各控件默认值）。 */
  private seedDummy(definition: ParsedDefinition): void {
    if (!(this.transport instanceof DummyTransport)) return;
    const firmware = this.transport.firmware;
    firmware.seedLayer0(definition.keys.map((k) => k.matrix));
    for (const control of definition.controls) {
      const key = addressKey(control.address);
      if (firmware.customValues.has(key)) continue;
      const width = control.widthHint;
      firmware.seedValue(key, defaultValueOf(control), width);
    }
  }
}

/** 按控件类型生成合法范围内的默认值（架构附录 A）。 */
export function defaultValueOf(control: ControlSpec): number {
  switch (control.options.kind) {
    case 'range':
      return Math.floor((control.options.min + control.options.max) / 2);
    case 'enum':
      return control.options.items[0]?.value ?? 0;
    case 'action':
      return 0;
    default:
      break;
  }
  switch (control.type) {
    case 'color':
      // [hue, sat] 16 位（QMK RGB Matrix 语义，VIA 官方一致）
      return 0x8080;
    case 'toggle':
      return 0;
    case 'keycode':
      return 0x0001;
    default:
      return 0;
  }
}
