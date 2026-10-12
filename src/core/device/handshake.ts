// 握手序列：版本校验 + 层数/固件版本/布局选项读取 + 自校验探针（架构 §8.4 / 风险 R2）。
import type { ParsedDefinition } from '@/definition/schema';
import {
  MIN_PROTOCOL_VERSION,
  KB_VALUE_ID,
  KEYCODES_VERSION_PROTOCOL_MIN,
  KEYCODES_VERSION_MIN,
  KEYCODES_VERSION_MAX,
} from '@/core/protocol/constants';
import { IncompatibleProtocolError, UnhandledCommandError } from '@/core/protocol/errors';
import { encodeGet } from '@/core/protocol/CustomValueCodec';
import { frameToHex, echoPrefixMatches } from '@/core/hid/frame';
import type { ViaProtocolLike } from '@/core/protocol/ViaProtocol';
import { VIA_CMD } from '@/core/protocol/constants';

export interface ProbeResult {
  readonly passed: boolean;
  readonly detail?: string;
  /** 探针使用的值地址键（调试面板展示） */
  readonly addressKey?: string;
  readonly requestHex?: string;
  readonly responseHex?: string;
}

export interface HandshakeResult {
  readonly protocolVersion: number;
  readonly layerCount: number;
  readonly firmwareVersion: number;
  readonly layoutOptions: number;
  /** 键码字典版本（BCD）；协议 < 13 时为 null（该版本没有这个概念）。0x08=旧字典 / 0x09=v9 */
  readonly keycodesVersion: number | null;
  readonly probe: ProbeResult;
}

export type ProtocolWarning = {
  readonly level: 'warn' | 'info';
  readonly title: string;
  readonly detail: string;
  readonly rawHex?: string;
};

export interface HandshakeOptions {
  /** 用于取探针地址的已解析定义（无定义时跳过探针） */
  readonly definition?: ParsedDefinition | null;
  readonly onWarning?: (warning: ProtocolWarning) => void;
}

const NO_PROBE: ProbeResult = { passed: true, detail: '未加载定义文件，跳过自校验探针' };

/**
 * 执行握手（PRD §5.6 的 8 步）。
 * 探针失败**不阻断**连接——只在调试面板置顶告警并附原始报文（架构 §8.4）。
 */
export async function runHandshake(
  protocol: ViaProtocolLike,
  options: HandshakeOptions = {},
): Promise<HandshakeResult> {
  // 1. 协议版本
  const version = await protocol.getProtocolVersion();
  if (version < MIN_PROTOCOL_VERSION) {
    throw new IncompatibleProtocolError(version);
  }

  // 2. 层数
  const layerCount = await protocol.getLayerCount();
  // 3. 固件版本（失败不影响连接）
  const firmwareVersion = await safeGetKeyboardValue(protocol, KB_VALUE_ID.FIRMWARE_VERSION);
  // 4. 布局选项（渲染键位必需）
  const layoutOptions = await safeGetKeyboardValue(protocol, KB_VALUE_ID.LAYOUT_OPTIONS);
  // 5. 键码字典版本：协议 ≥ 13 必须先读它，否则部分键会按错字典解释
  const keycodesVersion = await readKeycodesVersion(protocol, version, options);

  // 5. 自校验探针
  const probe = await runProbe(protocol, options);

  // 6. 设备指示（键盘闪一下）
  try {
    await protocol.setKeyboardValue(KB_VALUE_ID.DEVICE_INDICATION, 1);
  } catch {
    // 指示失败不影响连接
  }

  return {
    protocolVersion: version,
    layerCount,
    firmwareVersion,
    layoutOptions,
    keycodesVersion,
    probe,
  };
}

/**
 * 键码字典版本（0x02 + 0x06，BCD）。
 * 协议 ≥ 13 时**必须**先读它再选键码字典，否则部分键会被按错字典解释。
 * 协议 < 13 时**仍会试读**：实证部分固件（协议 v12）已实现该命令且使用 v9 编码
 * （0x5221=MO(1)），读到合法区间 0x08–0x09 即采纳；读失败/越界静默返回 null。
 * 协议 ≥ 13 时读取失败或越界告警。
 */
export async function readKeycodesVersion(
  protocol: ViaProtocolLike,
  protocolVersion: number,
  options: HandshakeOptions = {},
): Promise<number | null> {
  const required = protocolVersion >= KEYCODES_VERSION_PROTOCOL_MIN;
  let value: number;
  try {
    value = await protocol.getKeycodesVersion();
  } catch (e) {
    if (required) {
      options.onWarning?.({
        level: 'warn',
        title: '键码字典版本读取失败',
        detail: `协议 v${protocolVersion} 要求先读键码字典版本：${e instanceof Error ? e.message : String(e)}`,
      });
    }
    return null;
  }
  if (value < KEYCODES_VERSION_MIN || value > KEYCODES_VERSION_MAX) {
    if (required) {
      options.onWarning?.({
        level: 'warn',
        title: '键码字典版本超出已知区间',
        detail: `读到 0x${value.toString(16).toUpperCase().padStart(8, '0')}，已知区间为 0x00000008–0x00000009，改键可能出错`,
      });
    }
    return null;
  }
  return value;
}

/**
 * 自校验探针：连上后先读一个 keycode 控件，校验「回显前缀 == 请求前缀」。
 * 命令码相同但帧格式不同时固件会原样回显且无任何错误可捕获——探针是唯一识别手段。
 */
export async function runProbe(
  protocol: ViaProtocolLike,
  options: HandshakeOptions = {},
): Promise<ProbeResult> {
  const definition = options.definition;
  if (!definition) return NO_PROBE;
  const control = definition.controls.find((c) => c.type === 'keycode');
  if (!control) return { ...NO_PROBE, detail: '定义文件中没有 keycode 控件，跳过自校验探针' };

  const request = encodeGet(control.address);
  const prefixLength = 3 + control.address.indexes.length;
  let response: Uint8Array;
  try {
    // 用 rawCommand 绕开协议层的 0xFF 判定，以便完整观察原始报文
    response = await protocol.rawCommand(request);
  } catch (e) {
    return {
      passed: false,
      detail: `探针请求失败：${e instanceof Error ? e.message : String(e)}`,
      addressKey: control.address.key,
      requestHex: frameToHex(request),
    };
  }

  const requestHex = frameToHex(request);
  const responseHex = frameToHex(response);

  if ((response[0] ?? 0) === VIA_CMD.UNHANDLED) {
    const warn: ProtocolWarning = {
      level: 'warn',
      title: '自校验探针未通过：固件回显 0xFF',
      detail: `地址 ${control.address.key} 未被固件处理，请检查协议方言是否匹配`,
      rawHex: responseHex,
    };
    options.onWarning?.(warn);
    return { passed: false, detail: warn.detail, addressKey: control.address.key, requestHex, responseHex };
  }

  if (!echoPrefixMatches(response, request, prefixLength)) {
    const warn: ProtocolWarning = {
      level: 'warn',
      title: '自校验探针未通过：回显前缀与请求不一致',
      detail: `请求 ${requestHex.slice(0, prefixLength * 3)} / 响应 ${responseHex.slice(0, prefixLength * 3)}，方言可能不匹配`,
      rawHex: responseHex,
    };
    options.onWarning?.(warn);
    return { passed: false, detail: warn.detail, addressKey: control.address.key, requestHex, responseHex };
  }

  // 前缀正确但值恒为 0 不判定失败（可能真是 0），仅记 info
  const valueStart = prefixLength;
  const allZero = response[valueStart] === 0 && response[valueStart + 1] === 0;
  if (allZero) {
    options.onWarning?.({
      level: 'info',
      title: '自校验探针读回值为 0',
      detail: `地址 ${control.address.key} 回显前缀正确但值为 0，若键位图显示为「禁用」属正常`,
      rawHex: responseHex,
    });
  }

  return { passed: true, addressKey: control.address.key, requestHex, responseHex };
}

async function safeGetKeyboardValue(protocol: ViaProtocolLike, valueId: number): Promise<number> {
  try {
    return await protocol.getKeyboardValue(valueId);
  } catch (e) {
    if (e instanceof UnhandledCommandError) return 0;
    throw e;
  }
}
