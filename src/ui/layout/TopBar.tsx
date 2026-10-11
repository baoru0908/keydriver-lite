// 顶部设备栏：设备选择、连接状态灯、VID/PID/协议版本、主题切换、导入定义。
import { useState } from 'react';
import { Keyboard, Loader2, RefreshCw, Upload, PanelLeftClose, PanelLeftOpen, Command } from 'lucide-react';
import { useDeviceStore } from '@/store/useDeviceStore';
import { useDefinitionStore } from '@/store/useDefinitionStore';
import { useUiStore } from '@/store/useUiStore';
import { DevicePicker } from '@/ui/device/DevicePicker';
import { shouldShowConnectionInfo } from '@/ui/device/connectionInfo';
import { ThemeSwitch } from '@/ui/layout/ThemeSwitch';
import { Button } from '@/ui/primitives/Button';
import { Tooltip } from '@/ui/primitives/Tooltip';

export function TopBar({ onImportDefinition }: { onImportDefinition: () => void }): React.JSX.Element {
  const state = useDeviceStore((s) => s.state);
  const handshake = useDeviceStore((s) => s.handshake);
  const devices = useDeviceStore((s) => s.devices);
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const definition = useDefinitionStore((s) => s.definition);
  const sourceName = useDefinitionStore((s) => s.sourceName);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setHotkeyHelpOpen = useUiStore((s) => s.setHotkeyHelpOpen);
  const refreshDevices = useDeviceStore((s) => s.refreshDevices);
  const [pickerOpen, setPickerOpen] = useState(false);

  // 未连接时不回落 devices[0]：此刻取到的设备信息不属于任何已连接设备，属于无效数据
  const connected = shouldShowConnectionInfo(state);
  const device = connected ? devices.find((d) => d.id === selectedDeviceId) ?? devices[0] : undefined;
  const connecting = state === 'connecting';

  const statusColor = connected
    ? 'bg-accent'
    : connecting
      ? 'bg-warn animate-pulse'
      : state === 'error'
        ? 'bg-danger'
        : 'bg-border-strong';

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <Tooltip label={sidebarOpen ? '收起侧栏' : '展开侧栏'}>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => toggleSidebar()}
          aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'}
        >
          {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </Button>
      </Tooltip>

      <div className="flex items-center gap-2 font-medium">
        <Keyboard size={18} className="text-accent" />
        <span>keydriver</span>
      </div>

      <div className="mx-1 h-5 w-px bg-border" />

      <DevicePicker open={pickerOpen} onOpenChange={setPickerOpen} />

      <div className="flex min-w-0 items-center gap-2 text-xs text-fg-muted">
        <span className={`h-2 w-2 shrink-0 rounded-full ${statusColor}`} aria-hidden />
        {connected && handshake ? (
          <span className="truncate">
            <span className="text-fg">
              {device?.productName ?? '已连接设备'}
            </span>
            {device ? (
              <span className="font-mono">
                {' · '}VID 0x{device.vendorId.toString(16).toUpperCase().padStart(4, '0')} · PID 0x
                {device.productId.toString(16).toUpperCase().padStart(4, '0')}
              </span>
            ) : null}
            <span className="font-mono">
              {' · '}v{handshake.protocolVersion}
            </span>
            <span>{` · ${handshake.layerCount} 层`}</span>
            {handshake.probe.passed ? null : (
              <span className="ml-1 rounded bg-warn-soft px-1 text-warn">协议探针告警</span>
            )}
          </span>
        ) : connecting ? (
          <span className="flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" /> 连接中…
          </span>
        ) : (
          <span>未连接</span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {definition ? (
          <Tooltip label={`当前定义：${sourceName ?? definition.name}`}>
            <span className="hidden max-w-52 truncate rounded bg-elevated px-2 py-1 text-xs text-fg-muted md:inline">
              {sourceName ?? definition.name}
            </span>
          </Tooltip>
        ) : (
          <span className="hidden rounded bg-warn-soft px-2 py-1 text-xs text-warn md:inline">
            未加载定义文件
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={onImportDefinition}>
          <Upload size={14} /> 导入定义
        </Button>
        <Tooltip label="刷新设备列表">
          <Button variant="ghost" size="icon" onClick={() => void refreshDevices()} aria-label="刷新设备列表">
            <RefreshCw size={15} />
          </Button>
        </Tooltip>
        <ThemeSwitch />
        {/* T06-9：快捷键帮助（与 ⌘/Ctrl+/ 同一帮助面板） */}
        <Tooltip label="快捷键帮助">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setHotkeyHelpOpen(true)}
            aria-label="显示快捷键帮助"
          >
            <Command size={15} />
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
