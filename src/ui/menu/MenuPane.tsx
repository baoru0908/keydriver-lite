// 菜单面板：菜单 Tab（来自定义文件）+ 懒加载进度 + 生成器 + 保存栏。
import { useEffect, useMemo } from 'react';
import { FileJson, History, RotateCw, Usb } from 'lucide-react';
import { useDefinitionStore } from '@/store/useDefinitionStore';
import { getFacade, useDeviceStore } from '@/store/useDeviceStore';
import { useMenuStore } from '@/store/useMenuStore';
import { useUiStore } from '@/store/useUiStore';
import { Button } from '@/ui/primitives/Button';
import { ProgressBar } from '@/ui/primitives/ProgressBar';
import { Card } from '@/ui/primitives/Card';
import { EmptyState } from '@/ui/primitives/EmptyState';
import { Skeleton, SkeletonGroup } from '@/ui/primitives/Skeleton';
import { ConnectBanner } from '@/ui/device/ConnectBanner';
import { DevicePicker } from '@/ui/device/DevicePicker';
import { Tooltip } from '@/ui/primitives/Tooltip';
import { useState } from 'react';
import { MenuGenerator } from './MenuGenerator';
import { SaveBar } from './SaveBar';
import { cn } from '@/shared/cn';

export function MenuPane(): React.JSX.Element {
  const definition = useDefinitionStore((s) => s.definition);
  const setImportDialogOpen = useUiStore((s) => s.setImportDialogOpen);
  const currentMenuId = useUiStore((s) => s.currentMenuId);
  const openMenu = useUiStore((s) => s.openMenu);
  const connectionState = useDeviceStore((s) => s.state);
  const menuLoad = useDeviceStore((s) => s.menuLoad);
  const showIfContext = useMenuStore((s) => s.showIfContext);
  const status = useMenuStore((s) => s.status);
  const progress = useMenuStore((s) => s.progress);
  const loadedMenus = useMenuStore((s) => s.loadedMenus);
  const [pickerOpen, setPickerOpen] = useState(false);

  const menus = definition?.menus ?? [];
  const activeMenuId =
    currentMenuId && menus.some((m) => m.id === currentMenuId) ? currentMenuId : menus[0]?.id ?? null;
  const activeMenu = useMemo(
    () => menus.find((m) => m.id === activeMenuId) ?? null,
    [menus, activeMenuId],
  );
  // 官方 menu-generator.tsx :74/:96/:146 —— 数据未就绪时不渲染，
  // 否则会拿未初始化的值去做 showIf 判断，导致控件首屏闪现。
  const menuReady = activeMenuId !== null && loadedMenus.has(activeMenuId);

  // 打开菜单时懒加载全部控件值（含被 showIf 隐藏的因为它们要当条件变量）
  useEffect(() => {
    if (!activeMenuId || connectionState !== 'connected') return;
    if (loadedMenus.has(activeMenuId)) return;
    void menuLoad(activeMenuId);
  }, [activeMenuId, connectionState, loadedMenus, menuLoad]);

  // 本菜单中「正以本地缓存值展示」的控件数（固件回读不可信的对策，真机实证）。
  // 依赖 loadedMenus / status：水合完成（store 更新）后自动重算。
  const cachedCount = useMemo(() => {
    const active = getFacade();
    if (!active || !activeMenu) return 0;
    let count = 0;
    for (const control of activeMenu.controls) {
      if (active.isShowingCachedValue(control)) count += 1;
    }
    return count;
  }, [activeMenu, loadedMenus, status, connectionState]);

  // 「从设备重新读取」：忽略本地缓存，强制以设备回读为准（用户显式选择）。
  const rereadFromDevice = (): void => {
    if (!activeMenuId || connectionState !== 'connected') return;
    void menuLoad(activeMenuId, { force: true });
  };

  if (!definition) {
    return (
      <EmptyState
        icon={FileJson}
        title="尚未加载定义文件"
        description="请先导入一份 VIA V3 定义 JSON，所有菜单文案与控件都由它驱动。"
        action={
          <Button variant="primary" size="sm" onClick={() => setImportDialogOpen(true)}>
            导入定义
          </Button>
        }
      />
    );
  }

  const connected = connectionState === 'connected';

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
        {menus.map((menu) => (
          <button
            key={menu.id}
            type="button"
            className={cn(
              'rounded-card px-2.5 py-1 text-xs transition-colors',
              menu.id === activeMenuId
                ? 'bg-accent-soft text-accent'
                : 'text-fg-muted hover:bg-elevated hover:text-fg',
            )}
            onClick={() => openMenu(menu.id)}
          >
            {menu.label}
            <span className="ml-1 text-[10px] text-fg-dim">{menu.controls.length}</span>
          </button>
        ))}
        <Tooltip label="忽略本地缓存，强制从设备重新读取本菜单全部控件">
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto"
            onClick={rereadFromDevice}
            disabled={!connected}
            aria-label="从设备重新读取"
          >
            <RotateCw size={14} />
          </Button>
        </Tooltip>
      </div>
      {cachedCount > 0 ? (
        <p className="flex items-center gap-1.5 rounded-card bg-warn-soft px-2 py-1 text-caption text-warn">
          <History size={12} aria-hidden />
          {`${cachedCount} 个控件的设备回读不可信（本固件实测会返回陈旧值或 0），正显示上次会话写入的配置；点上方刷新按钮可强制以设备为准。`}
        </p>
      ) : null}

      <ConnectBanner
        onImportDefinition={() => setImportDialogOpen(true)}
        onOpenDevicePicker={() => setPickerOpen(true)}
      />
      <DevicePicker open={pickerOpen} onOpenChange={setPickerOpen} />

      {connected && activeMenu ? (
        <>
          <SaveBar />
          {status === 'loading' ? (
            <ProgressBar value={progress} label={`正在读取 ${activeMenu.label} 的控件值…`} />
          ) : menuReady ? (
            <MenuGenerator menu={activeMenu} context={showIfContext} />
          ) : (
            <SkeletonGroup label={`正在加载 ${activeMenu.label}`} className="gap-3">
              <Skeleton variant="text" className="w-56" />
              <Skeleton variant="block" className="h-16" />
              <Skeleton variant="block" className="h-16" />
            </SkeletonGroup>
          )}
        </>
      ) : (
        <Card className="p-6">
          <EmptyState
            icon={Usb}
            title="未连接设备"
            description="连接设备后即可读写该菜单下的控件。"
            action={
              <Button variant="primary" size="sm" onClick={() => setPickerOpen(true)}>
                选择设备
              </Button>
            }
          />
        </Card>
      )}
    </div>
  );
}
