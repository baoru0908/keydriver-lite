// 四区栅格骨架：顶部设备栏 / 左侧导航 / 中央工作区 / 右侧面板 + 底部状态栏。
// T02 感知性能：重面板用 React.lazy 分包，配合 Suspense 骨架占位，减小首屏体积。
// T06-1：窄窗（<1080px，见 useBreakpoint）时键码面板折叠为抽屉（不挤压 960 宽画布）；
//        跨入窄窗自动折叠一次，恢复宽度不强制展开（尊重手动状态）。
// T06-3：脏计数经唯一 IPC bridge 推给主进程（关窗拦截门控）。
// T06-9：全局快捷键（⌘/Ctrl+S 保存、⌘/Ctrl+Z 撤销、数字键切面板）。
import { Suspense, lazy, useEffect, useRef } from 'react';
import { PanelRightOpen } from 'lucide-react';
import { useUiStore } from '@/store/useUiStore';
import { useKeymapStore } from '@/store/useKeymapStore';
import { useMenuStore } from '@/store/useMenuStore';
import { useDeviceStore, startHotplugWatch } from '@/store/useDeviceStore';
import { getBridge } from '@/shared/bridge';
import { createDirtyReporter } from '@/shared/dirtyCount';
import { useBreakpoint } from '@/shared/useBreakpoint';
import { useHotkeys } from '@/hooks/useHotkeys';
import { TopBar } from './TopBar';
import { SideNav } from './SideNav';
import { StatusBar } from './StatusBar';
import { HotkeyHelpDialog } from './HotkeyHelpDialog';
import { KeycodePanel } from '@/ui/keycode/KeycodePanel';
import { Button } from '@/ui/primitives/Button';
import { Skeleton, SkeletonGroup } from '@/ui/primitives/Skeleton';

// 重面板懒加载（各自独立 chunk，首屏只加载当前面板）。
const KeymapPanel = lazy(() =>
  import('@/ui/keymap/KeymapPanel').then((m) => ({ default: m.KeymapPanel })),
);
const LayoutOptionsBar = lazy(() =>
  import('@/ui/keymap/LayoutOptionsBar').then((m) => ({ default: m.LayoutOptionsBar })),
);
const DebugPanel = lazy(() =>
  import('@/ui/debug/DebugPanel').then((m) => ({ default: m.DebugPanel })),
);
const MenuPane = lazy(() => import('@/ui/menu/MenuPane').then((m) => ({ default: m.MenuPane })));
const MacrosPanel = lazy(() =>
  import('@/ui/macro/MacrosPanel').then((m) => ({ default: m.MacrosPanel })),
);
const BackupPanel = lazy(() =>
  import('@/ui/io/BackupPanel').then((m) => ({ default: m.BackupPanel })),
);
const DefinitionDropzone = lazy(() =>
  import('@/ui/io/DefinitionDropzone').then((m) => ({ default: m.DefinitionDropzone })),
);
const DevicePanel = lazy(() =>
  import('@/ui/device/DevicePanel').then((m) => ({ default: m.DevicePanel })),
);

/** 面板级懒加载占位（design-tokens.md §7.2 骨架屏）。 */
function PanelFallback(): React.JSX.Element {
  return (
    <SkeletonGroup label="面板加载中" className="gap-3">
      <Skeleton variant="text" className="w-40" />
      <Skeleton variant="block" />
      <Skeleton variant="block" className="h-32" />
    </SkeletonGroup>
  );
}

export interface AppShellProps {
  readonly onImportDefinition: () => void;
}

/** autoReconnect 只跑一次的标记（模块级，StrictMode 双挂载防护）。 */
let autoReconnectStarted = false;

export function AppShell({ onImportDefinition }: AppShellProps): React.JSX.Element {
  const currentPanel = useUiStore((s) => s.currentPanel);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const keycodePanelOpen = useUiStore((s) => s.keycodePanelOpen);
  const setKeycodePanelOpen = useUiStore((s) => s.setKeycodePanelOpen);
  const narrow = useBreakpoint();
  useHotkeys();

  const keycodeEligible = currentPanel === 'keymap' || currentPanel === 'menu';

  // T06-1：跨入窄窗时自动折叠键码面板一次；恢复宽度不强制展开（尊重手动状态）。
  const prevNarrow = useRef(narrow);
  useEffect(() => {
    if (narrow && !prevNarrow.current && keycodePanelOpen) {
      setKeycodePanelOpen(false);
    }
    prevNarrow.current = narrow;
  });

  // 启动自动重连：曾连接过的设备在列表里出现即静默重连。
  // 模块级标记防 StrictMode 双跑（双重 connect 会互相踢掉 facade，表现为「假连接」）。
  // 热插拔看门狗：启动时键盘不在位 → 插上后 2s 内自动出现在列表并重连（幂等，重复调用无害）。
  useEffect(() => {
    startHotplugWatch();
    if (autoReconnectStarted) return;
    autoReconnectStarted = true;
    void useDeviceStore.getState().autoReconnect();
  }, []);

  // T06-3：把两个 store 的脏计数聚合后经唯一 bridge 推给主进程（关窗拦截门控）。
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return undefined;
    const reporter = createDirtyReporter(
      bridge,
      () => useKeymapStore.getState().dirtyKeys,
      () => useMenuStore.getState().dirty,
      (listener) => {
        const u1 = useKeymapStore.subscribe(listener);
        const u2 = useMenuStore.subscribe(listener);
        return () => {
          u1();
          u2();
        };
      },
    );
    reporter.push();
    return () => reporter.dispose();
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg text-fg">
      <TopBar onImportDefinition={onImportDefinition} />
      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen ? <SideNav compact={narrow} /> : null}
        <main className="min-w-0 flex-1 overflow-auto p-4">
          <Suspense fallback={<PanelFallback />}>
            {currentPanel === 'keymap' ? <KeymapPanel /> : null}
            {currentPanel === 'layout' ? <LayoutOptionsBar full /> : null}
            {currentPanel === 'debug' ? <DebugPanel embedded /> : null}
            {currentPanel === 'menu' ? <MenuPane /> : null}
            {currentPanel === 'backup' ? (
              <div className="flex flex-col gap-3">
                <BackupPanel />
                <DefinitionDropzone />
              </div>
            ) : null}
            {currentPanel === 'device' ? <DevicePanel /> : null}
            {currentPanel === 'macros' ? <MacrosPanel /> : null}
          </Suspense>

          {/* T06-1：窄窗且面板折叠时给一个展开入口（浮在工作区右上，不挤压内容） */}
          {narrow && !keycodePanelOpen && keycodeEligible ? (
            <Button
              variant="secondary"
              size="sm"
              className="absolute right-3 top-3 z-20 shadow-e2"
              onClick={() => setKeycodePanelOpen(true)}
              aria-label="展开键码面板"
            >
              <PanelRightOpen size={14} /> 键码
            </Button>
          ) : null}
        </main>
        {keycodePanelOpen && keycodeEligible ? (
          narrow ? (
            // 窄窗：抽屉浮层，不参与 flex 挤压
            <aside className="absolute right-0 top-0 z-30 h-full w-80 max-w-[85%] border-l border-border bg-surface shadow-e3">
              <KeycodePanel />
            </aside>
          ) : (
            <aside className="w-80 shrink-0 border-l border-border bg-surface">
              <KeycodePanel />
            </aside>
          )
        ) : null}
      </div>
      <StatusBar />
      <HotkeyHelpDialog />
    </div>
  );
}
