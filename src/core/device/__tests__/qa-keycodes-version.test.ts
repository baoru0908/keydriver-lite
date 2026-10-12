// QA 独立验证 · 握手环节的两条版本规则（高危点 3 + 版本解析的方言兜底）。
import { describe, expect, it } from 'vitest';
import { DummyTransport } from '@/core/hid/DummyTransport';
import { ViaProtocol } from '@/core/protocol/ViaProtocol';
import { IncompatibleProtocolError } from '@/core/protocol/errors';
import { KEYCODES_VERSION_MAX, KEYCODES_VERSION_MIN } from '@/core/protocol/constants';
import { readKeycodesVersion, runHandshake, runProbe } from '@/core/device/handshake';
import type { ViaProtocolLike } from '@/core/protocol/ViaProtocol';
import type { ProtocolWarning } from '@/core/device/handshake';
import type { HidTransport, HidDeviceInfo, Unsubscribe } from '@/core/hid/HidTransport';
import { MSG_LEN } from '@/core/hid/HidTransport';
import { loadRealParsedDefinition } from '@/definition/__tests__/fixtures/realDefinition';

async function protocolOf(config: Partial<ConstructorParameters<typeof DummyTransport>[0]>) {
  const transport = new DummyTransport(config);
  const [device] = await transport.listDevices();
  if (!device) throw new Error('Dummy 设备列表为空');
  await transport.open(device);
  return new ViaProtocol(transport);
}

/** 固定响应帧的假传输：用于注入任意方言报文。 */
class ScriptedTransport implements HidTransport {
  readonly kind = 'dummy' as const;
  readonly isOpen = true;
  constructor(private readonly response: readonly number[]) {}
  isSupported(): boolean {
    return true;
  }
  async listDevices(): Promise<HidDeviceInfo[]> {
    return [];
  }
  async open(): Promise<void> {}
  async close(): Promise<void> {}
  async transfer(): Promise<Uint8Array> {
    const out = new Uint8Array(MSG_LEN);
    for (let i = 0; i < this.response.length; i += 1) out[i] = this.response[i] ?? 0;
    return out;
  }
  onDisconnect(): Unsubscribe {
    return () => undefined;
  }
}

describe('QA · 协议版本解析', () => {
  it('标准方言（版本位于 data[2..3]）：v11 / v12 / v13 都能解出', async () => {
    for (const version of [11, 12, 13]) {
      const protocol = new ViaProtocol(
        new ScriptedTransport([0x01, 0x00, (version >> 8) & 0xff, version & 0xff]),
      );
      await expect(protocol.getProtocolVersion()).resolves.toBe(version);
    }
  });

  it('版本过低时 assertProtocolVersion 抛 IncompatibleProtocolError', async () => {
    const protocol = new ViaProtocol(new ScriptedTransport([0x01, 0x00, 0x00, 0x0a]));
    await expect(protocol.assertProtocolVersion()).rejects.toBeInstanceOf(
      IncompatibleProtocolError,
    );
  });
});

describe('qa-regression · 协议版本的第二方言兜底失效', () => {
  // ViaProtocol.getProtocolVersion 注释声明支持「把版本放在 data[1..2]」的固件，
  // 但兜底条件写成了 `version === 0`：
  //   primary = data[2]<<8 | data[3]
  // 对该方言而言 data[2] = lo、data[3] = 0，于是 primary = lo<<8 = 0x0B00 = 2816 ≠ 0，
  // 兜底分支永远不会执行 —— 也就是说，v11/v12/v13（高字节恒为 0）全都解错。
  it('版本位于 data[1..2] 的固件必须同样得到 v11（当前得到 2816）', async () => {
    const protocol = new ViaProtocol(new ScriptedTransport([0x01, 0x00, 0x0b, 0x00]));
    await expect(protocol.getProtocolVersion()).resolves.toBe(11);
  });

  it('副作用：错误的版本号会让握手误判为需要读键码字典版本', async () => {
    const protocol = new ViaProtocol(new ScriptedTransport([0x01, 0x00, 0x0b, 0x00]));
    const version = await protocol.getProtocolVersion();
    expect(version).toBe(11);
    // 0x0B00 = 2816 ≥ 13 → 会去读一个该版本根本不存在的概念
    expect(version >= 13).toBe(false);
  });
});

describe('QA · 键码字典版本：协议 ≥ 13 必读；< 13 试读（v9 字典判定）', () => {
  it('protocolVersion < 13：仍会试读；读到合法区间值即采纳', async () => {
    const calls: number[] = [];
    const fake: ViaProtocolLike = {
      getProtocolVersion: async () => 12,
      getKeyboardValue: async () => 0,
      setKeyboardValue: async () => undefined,
      getKeycodesVersion: async () => {
        calls.push(1);
        return KEYCODES_VERSION_MAX;
      },
      getLayerCount: async () => 4,
      getKeycode: async () => 0,
      setKeycode: async () => undefined,
      getKeymapBuffer: async () => new Uint8Array(0),
      setKeymapBuffer: async () => undefined,
      customGetValue: async () => 0,
      customSetValue: async () => undefined,
      customSave: async () => undefined,
      eepromReset: async () => undefined,
      bootloaderJump: async () => undefined,
      getMacroBuffer: async () => new Uint8Array(0),
      setMacroBuffer: async () => undefined,
      getMacroSize: async () => 0,
      rawCommand: async () => new Uint8Array(0),
    };
    // 实证部分协议 v12 固件已实现 0x02/0x06 且使用 v9 编码（0x5221=MO(1)），
    // 试读成功可精确消除 TO/DF 歧义段
    await expect(readKeycodesVersion(fake, 12)).resolves.toBe(KEYCODES_VERSION_MAX);
    expect(calls).toHaveLength(1);
  });

  it('protocolVersion < 13：读失败静默返回 null，不告警', async () => {
    const warnings: ProtocolWarning[] = [];
    const fake = {
      getKeycodesVersion: async () => {
        throw new Error('UNHANDLED');
      },
    } as unknown as ViaProtocolLike;
    await expect(readKeycodesVersion(fake, 12, { onWarning: (w) => warnings.push(w) })).resolves.toBeNull();
    expect(warnings).toHaveLength(0);
  });

  it('protocolVersion < 13：读到越界值静默返回 null，不告警', async () => {
    const warnings: ProtocolWarning[] = [];
    const fake = {
      getKeycodesVersion: async () => 0x1f,
    } as unknown as ViaProtocolLike;
    await expect(readKeycodesVersion(fake, 12, { onWarning: (w) => warnings.push(w) })).resolves.toBeNull();
    expect(warnings).toHaveLength(0);
  });

  it('protocolVersion ≥ 13：正常读取', async () => {
    const fake = {
      getKeycodesVersion: async () => KEYCODES_VERSION_MIN,
    } as unknown as ViaProtocolLike;
    await expect(readKeycodesVersion(fake, 13)).resolves.toBe(KEYCODES_VERSION_MIN);
  });

  it('越界值与非 BCD 值：协议 ≥ 13 时告警并返回 null', async () => {
    for (const value of [0x0000_000a, 0x0000_001f, 0xffff_ffff, 0x0000_0000]) {
      const warnings: ProtocolWarning[] = [];
      const fake = {
        getKeycodesVersion: async () => value,
      } as unknown as ViaProtocolLike;
      await expect(readKeycodesVersion(fake, 13, { onWarning: (w) => warnings.push(w) })).resolves.toBe(
        null,
      );
      expect(warnings, `0x${value.toString(16)} 应触发告警`).toHaveLength(1);
      expect(warnings[0]?.level).toBe('warn');
    }
  });

  it('合法区间 [0x08, 0x09] 内不告警', async () => {
    for (const value of [KEYCODES_VERSION_MIN, KEYCODES_VERSION_MAX]) {
      const warnings: ProtocolWarning[] = [];
      const fake = {
        getKeycodesVersion: async () => value,
      } as unknown as ViaProtocolLike;
      await readKeycodesVersion(fake, 13, { onWarning: (w) => warnings.push(w) });
      expect(warnings).toHaveLength(0);
    }
  });

  it('读取失败（超时 / 0xFF）：告警并返回 null，不阻断握手', async () => {
    const warnings: ProtocolWarning[] = [];
    const fake = {
      getKeycodesVersion: async () => {
        throw new Error('传输超时');
      },
    } as unknown as ViaProtocolLike;
    await expect(
      readKeycodesVersion(fake, 13, { onWarning: (w) => warnings.push(w) }),
    ).resolves.toBeNull();
    expect(warnings[0]?.title).toBe('键码字典版本读取失败');
  });

  it('握手全链路（Dummy + 协议 12 vs 13）', async () => {
    const p12 = await protocolOf({ protocolVersion: 12 });
    const r12 = await runHandshake(p12);
    expect(r12.keycodesVersion).toBeNull();

    const p13 = await protocolOf({ protocolVersion: 13, keycodesVersion: 0x0000_0009 });
    const r13 = await runHandshake(p13);
    expect(r13.keycodesVersion).toBe(0x0000_0009);
    expect(r13.protocolVersion).toBe(13);
  });
});

describe('QA · 自校验探针', () => {
  it('未注入故障时探针通过', async () => {
    const transport = new DummyTransport({});
    const [device] = await transport.listDevices();
    if (!device) throw new Error('Dummy 设备列表为空');
    await transport.open(device);
    const protocol = new ViaProtocol(transport);
    const result = await runProbe(protocol, { definition: loadRealParsedDefinition() });
    expect(result.passed).toBe(true);
  });

  it('回显 0xFF 时探针失败并给出原始报文', async () => {
    const transport = new DummyTransport({ unhandledChannels: [9] });
    const [device] = await transport.listDevices();
    if (!device) throw new Error('Dummy 设备列表为空');
    await transport.open(device);
    const protocol = new ViaProtocol(transport);
    const warnings: ProtocolWarning[] = [];
    const result = await runProbe(protocol, {
      definition: loadRealParsedDefinition(),
      onWarning: (w) => warnings.push(w),
    });
    expect(result.passed).toBe(false);
    expect(result.responseHex).toMatch(/^FF/);
    expect(warnings[0]?.title).toContain('0xFF');
  });
});
