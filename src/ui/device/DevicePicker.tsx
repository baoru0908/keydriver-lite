// 设备选择：列出可用设备 + 连接/断开。
// Dummy 模拟设备已从 UI 移除（工厂/store 保留，供测试与无硬件演练复用）。
import { useEffect, useState } from 'react';
import { Cpu, Link2, Link2Off, Usb } from 'lucide-react';
import { Button } from '@/ui/primitives/Button';
import { Modal } from '@/ui/primitives/Modal';
import { Switch } from '@/ui/primitives/Switch';
import { useDeviceStore } from '@/store/useDeviceStore';
import { useDefinitionStore } from '@/store/useDefinitionStore';
import { createTransport } from '@/core/hid';
import { toast } from '@/ui/primitives/Toast';
import { cn } from '@/shared/cn';

export interface DevicePickerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function DevicePicker({ open, onOpenChange }: DevicePickerProps): React.JSX.Element {
  const devices = useDeviceStore((s) => s.devices);
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const selectDevice = useDeviceStore((s) => s.selectDevice);
  const connect = useDeviceStore((s) => s.connect);
  const disconnect = useDeviceStore((s) => s.disconnect);
  const state = useDeviceStore((s) => s.state);
  const refreshDevices = useDeviceStore((s) => s.refreshDevices);
  const transportKind = useDeviceStore((s) => s.transportKind);
  const setTransportKind = useDeviceStore((s) => s.setTransportKind);
  const showAllDevices = useDeviceStore((s) => s.showAllDevices);
  const setShowAllDevices = useDeviceStore((s) => s.setShowAllDevices);
  const scanSummary = useDeviceStore((s) => s.scanSummary);
  const definition = useDefinitionStore((s) => s.definition);
  const [busy, setBusy] = useState(false);

  const connected = state === 'connected';

  // 环境诊断：失败时用来定位「是没弹选择器 / 环境不支持 / 还是被系统屏蔽」
  const webHidSupported = typeof navigator !== 'undefined' && 'hid' in navigator;
  const isElectron = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);
  /** getDevices() 返回的数量（= 已授权过的设备）；null 表示尚未查询 */
  const [grantedCount, setGrantedCount] = useState<number | null>(null);
  /** 上一次「授权设备」的结果（常驻显示，避免 toast 一闪而过看不清） */
  const [authStatus, setAuthStatus] = useState<string | null>(null);

  const probeGranted = async (): Promise<void> => {
    if (!webHidSupported) return;
    try {
      const list = await navigator.hid.getDevices();
      setGrantedCount(list.length);
    } catch {
      setGrantedCount(-1);
    }
  };

  useEffect(() => {
    if (!open || transportKind !== 'webhid') return;
    void probeGranted();
  }, [open, transportKind]);

  /** 切换传输方式：原生键盘（Tauri hidapi 桥）↔ 真实键盘（WebHID）。 */
  const switchTransport = async (kind: 'webhid' | 'nodehid'): Promise<void> => {
    if (kind === transportKind) return;
    setTransportKind(kind);
    await refreshDevices();
  };

  /** 原生 hidapi 桥只在 Tauri 桌面外壳里可用。 */
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const webHidAvailable = webHidSupported;
  const transportOptions = (['nodehid', 'webhid'] as const).filter((kind) =>
    kind === 'nodehid' ? isTauri : webHidAvailable,
  );

  /**
   * 授权真实键盘：WebHID 要求 requestDevice() 必须由用户手势触发，所以只能走按钮点击。
   * 授权过的设备会被浏览器记住，之后 listDevices() 就能直接列出。
   *
   * includeAll = false（默认）：按官方 VIA 的 RAW HID usage 过滤，选择器里只有可控制的键盘；
   * includeAll = true：用空过滤器列出全部 HID 设备，给固件未声明该 usage 的键盘留一条救急通路。
   */
  const authorizeWebHid = async (includeAll: boolean): Promise<void> => {
    try {
      const transport = createTransport({ kind: 'webhid' });
      if (!transport.requestAccess) {
        setAuthStatus('当前环境不支持设备授权');
        toast.error('当前环境不支持设备授权');
        return;
      }
      setAuthStatus(includeAll ? '已发起授权（全部 HID 设备），等待选择器弹出…' : '已发起授权（可控制键盘），等待选择器弹出…');
      const granted = await transport.requestAccess({ includeAll });
      if (granted.length === 0) {
        // 用户在选择器里点取消、或设备被系统/浏览器屏蔽，都会返回 0
        setAuthStatus(
          includeAll
            ? '选择器未返回任何设备（你取消了，或设备被系统屏蔽）'
            : '没有匹配到可控制的键盘（你取消了，或该键盘未声明 VIA usage，可试试「显示全部 HID 设备」）',
        );
        toast.info('未授权任何设备');
        return;
      }
      setAuthStatus(`选择器返回 ${granted.length} 台设备${includeAll ? '（全部 HID）' : ''}`);
      await refreshDevices();
      void probeGranted();
      toast.success(`已授权 ${granted.length} 个设备，可在下方选择`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAuthStatus(`授权报错：${msg}`);
      toast.error(msg);
    }
  };

  const doConnect = async (deviceId: string): Promise<void> => {
    if (!definition) {
      toast.error('请先导入定义文件，再连接设备');
      return;
    }
    setBusy(true);
    selectDevice(deviceId);
    const ok = await connect(deviceId);
    setBusy(false);
    if (ok) {
      toast.success('已连接设备');
      onOpenChange(false);
    } else {
      toast.error(useDeviceStore.getState().error ?? '连接失败');
    }
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => onOpenChange(true)}>
        {connected ? <Cpu size={14} className="text-accent" /> : <Usb size={14} />}
        {connected ? '设备已连接' : '选择设备'}
      </Button>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="选择设备"
        description="接真实键盘：桌面外壳走原生 hidapi（无需授权）；浏览器/Electron 走 WebHID（需点击授权）。默认只列出可控制的键盘，关掉开关可看全部 HID 设备。"
        footer={
          connected ? (
            <Button
              variant="danger"
              size="md"
              onClick={() => {
                void disconnect();
                toast.info('已断开连接');
              }}
            >
              <Link2Off size={14} /> 断开连接
            </Button>
          ) : null
        }
      >
        <div className="flex flex-col gap-2">
          {/* 传输方式切换：可用方式不止一种时才显示，单一方式不占版面 */}
          {transportOptions.length > 1 ? (
            <div className="flex items-center gap-1 rounded-card border border-border bg-elevated p-1">
              {transportOptions.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => void switchTransport(kind)}
                  className={cn(
                    'flex-1 rounded px-2 py-1 text-xs transition-colors',
                    transportKind === kind
                      ? 'bg-accent-soft text-accent'
                      : 'text-fg-muted hover:bg-surface hover:text-fg',
                  )}
                >
                  {kind === 'nodehid' ? '原生键盘（Native）' : '真实键盘（WebHID）'}
                </button>
              ))}
            </div>
          ) : null}
          {transportKind === 'nodehid' ? (
            <p className="rounded-card border border-border bg-elevated px-2 py-1.5 text-[11px] text-fg-dim">
              Tauri 原生 hidapi 桥：无需授权，插上键盘点「刷新设备列表」即可发现。
            </p>
          ) : null}
          {/* 过滤开关：默认只显示我们能控制的键盘，关掉即可看到全部已授权 HID（调试/救急） */}
          <div className="flex items-center justify-between gap-2 rounded-card border border-border bg-elevated px-2 py-1.5">
            <div className="min-w-0">
              <div className="text-xs text-fg">只显示可控制的键盘</div>
              <div className="text-[11px] text-fg-dim">
                {scanSummary
                  ? `共 ${scanSummary.total} 台已授权 HID 设备，其中 ${scanSummary.matched} 台可控制`
                  : '未扫描：点下方「刷新设备列表」统计'}
              </div>
            </div>
            <Switch
              checked={!showAllDevices}
              onCheckedChange={(checked) => setShowAllDevices(!checked)}
              ariaLabel="只显示可控制的键盘"
            />
          </div>

          {transportKind === 'webhid' ? (
            <div className="flex flex-col gap-1">
              <Button variant="secondary" size="sm" onClick={() => void authorizeWebHid(false)}>
                <Usb size={13} /> 授权键盘…
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => void authorizeWebHid(true)}>
                  <Usb size={13} /> 授权：显示全部 HID 设备
                </Button>
                <span className="text-[11px] text-fg-dim">固件未声明 VIA usage 时用这个</span>
              </div>
            </div>
          ) : null}

          {transportKind === 'webhid' ? (
            <div className="flex flex-col gap-0.5 text-[11px] text-fg-dim">
              <p>
                环境：{isElectron ? '桌面程序' : '浏览器'} · WebHID{' '}
                <span className={webHidSupported ? 'text-accent' : 'text-danger'}>
                  {webHidSupported ? '可用' : '不可用'}
                </span>{' '}
                · getDevices() {grantedCount === null ? '未查询' : grantedCount < 0 ? '查询失败' : `${grantedCount} 台`}
              </p>
              {authStatus ? <p className="text-fg-muted">上次授权：{authStatus}</p> : null}
              {!webHidSupported
                ? <p>需 Chrome / Edge 113+，或本桌面程序；请勿用 Safari / Firefox。</p>
                : null}
            </div>
          ) : null}

          {devices.length === 0 ? (
            <p className="rounded-card border border-dashed border-border px-3 py-6 text-center text-xs text-fg-dim">
              {transportKind === 'nodehid'
                ? '没有检测到可控制的键盘。请插上键盘后点「刷新设备列表」。'
                : showAllDevices
                  ? '还没有已授权的 HID 设备。请先点上方「授权键盘…」，在弹出的选择器里选中你的键盘。'
                  : '没有检测到可控制的键盘。请先点上方「授权键盘…」；若列表仍为空，可关闭顶部过滤开关，或用「授权：显示全部 HID 设备」按钮。'}
            </p>
          ) : (
            devices.map((device) => {
              const active = device.id === selectedDeviceId && connected;
              return (
                <button
                  key={device.id}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-3 rounded-card border px-3 py-2 text-left transition-colors',
                    active ? 'border-accent bg-accent-soft' : 'border-border bg-elevated hover:border-border-strong',
                  )}
                  onClick={() => void doConnect(device.id)}
                >
                  <Usb size={16} className={active ? 'text-accent' : 'text-fg-dim'} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-fg">{device.productName}</div>
                    <div className="font-mono text-[11px] text-fg-dim">
                      VID 0x{device.vendorId.toString(16).toUpperCase().padStart(4, '0')} · PID 0x
                      {device.productId.toString(16).toUpperCase().padStart(4, '0')} · {device.kind}
                    </div>
                  </div>
                  <Link2 size={14} className={active ? 'text-accent' : 'text-fg-dim'} />
                </button>
              );
            })
          )}
          <div className="mt-1 flex justify-end">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void refreshDevices()}>
              刷新设备列表
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
