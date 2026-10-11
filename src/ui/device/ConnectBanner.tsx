// 连接引导横幅：未连接/断连/无定义时的引导，含运行环境自检提示（Q10 / R10）。
// T06-2：区分「意外断连（lost，可一键重连）」与「未连接（引导选择设备）」。
import { AlertCircle, FileJson, RotateCcw, Usb } from 'lucide-react';
import { Button } from '@/ui/primitives/Button';
import { useDeviceStore } from '@/store/useDeviceStore';
import { useDefinitionStore } from '@/store/useDefinitionStore';

export interface ConnectBannerProps {
  readonly onImportDefinition: () => void;
  readonly onOpenDevicePicker: () => void;
}

/** 运行环境自检：是否需要安全上下文、是否支持 WebHID（Q10）。 */
function environmentHints(): string[] {
  const hints: string[] = [];
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    hints.push('当前不是安全上下文（需 https 或 localhost），浏览器会禁用 WebHID。');
  }
  if (typeof navigator !== 'undefined' && !('hid' in navigator)) {
    hints.push('当前浏览器不支持 WebHID，请使用 Chrome / Edge 113+。');
  }
  return hints;
}

export function ConnectBanner({
  onImportDefinition,
  onOpenDevicePicker,
}: ConnectBannerProps): React.JSX.Element {
  const state = useDeviceStore((s) => s.state);
  const error = useDeviceStore((s) => s.error);
  const busy = useDeviceStore((s) => s.busy);
  const refreshDevices = useDeviceStore((s) => s.refreshDevices);
  const connect = useDeviceStore((s) => s.connect);
  const definition = useDefinitionStore((s) => s.definition);
  const hints = environmentHints();

  /** 一键重连（T06-2）：先重扫设备列表（选中项可能已变），再按当前选中设备发起连接。 */
  const reconnect = async (): Promise<void> => {
    await refreshDevices();
    await connect(useDeviceStore.getState().selectedDeviceId ?? undefined);
  };

  if (state === 'connected') return <></>;

  const lost = state === 'lost';

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-card border border-border bg-elevated px-3 py-3">
      <div className="flex items-start gap-2">
        <AlertCircle size={15} className={`mt-0.5 shrink-0 ${lost ? 'text-danger' : 'text-warn'}`} />
        <div className="min-w-0 flex-1 text-caption text-fg-muted">
          {lost ? (
            <>
              <p className="text-fg">设备已断开</p>
              {error ? <p className="text-fg-dim">{error}</p> : null}
              <p>未保存的改动仍保留在界面上，重连后可以继续编辑。</p>
            </>
          ) : !definition ? (
            <p>尚未加载定义文件。请先导入一份 VIA V3 定义 JSON，所有界面文案与控件都由它驱动。</p>
          ) : state === 'error' ? (
            <p className="text-danger">{error ?? '连接失败'}</p>
          ) : (
            <p>已加载定义，但未连接设备。点击右上角「选择设备」连接你的键盘；曾连接过的设备会在启动时自动重连。</p>
          )}
          {hints.map((hint) => (
            <p key={hint} className="mt-1 text-caption text-fg-dim">
              {hint}
            </p>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        {lost ? (
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void reconnect()}>
            <RotateCcw size={13} /> 重新连接
          </Button>
        ) : !definition ? (
          <Button variant="primary" size="sm" onClick={onImportDefinition}>
            <FileJson size={13} /> 导入定义文件
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={onOpenDevicePicker}>
            <Usb size={13} /> 选择设备
          </Button>
        )}
      </div>
    </div>
  );
}
