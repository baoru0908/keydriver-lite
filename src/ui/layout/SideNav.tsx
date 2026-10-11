// 左侧导航：平台固定栏目 + 定义栏目（架构 §UI-NAV）。
//
// 自上而下：
//   1. 品牌头（KeyDriver）；
//   2. 固定栏目 —— 平台能力，与配置文件无关：键位（键位图 / 布局）、宏（整行直达宏面板）、
//      设备（设备信息 / 调试 / 备份）；
//   3. 定义栏目 —— 完全由当前加载的定义文件驱动（见 @/definition/menuNav）：
//      · 有 label 的 section → 分组头（图标 + 分组名）+ 其下菜单子行；
//      · 无 label 的 section → 菜单直接作为一行渲染；
//      未加载定义文件、或定义文件没有顶层菜单时整段不渲染。
//
// T06-8：窄窗（960–1080px）折叠为图标态（compact）。图标行 title/aria-label 承载语义，
//        手动侧栏开关（TopBar）优先级始终高于自动折叠——sidebarOpen=false 时整栏隐藏。
//
// ⚠️ 所有具体菜单名一律来自定义文件，本文件（及 src/ 任何位置）零硬编码。
import {
  Activity,
  Archive,
  Braces,
  Cpu,
  Keyboard,
  Layers,
  LayoutGrid,
  Lightbulb,
  SlidersHorizontal,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { useUiStore, type PanelId } from '@/store/useUiStore';
import { Mascot } from '@/ui/brand/mascots';
import {
  selectMenuNavItems,
  useDefinitionStore,
  type MenuNavItem,
} from '@/store/useDefinitionStore';
import { buildDefinitionNavSections, type NavIconKey } from '@/definition/menuNav';
import { cn } from '@/shared/cn';

/** 图标映射：capability 用于独立行（通用能力），其余按分组语义取图标。 */
const NAV_ICONS: Record<NavIconKey, LucideIcon> = {
  capability: SlidersHorizontal,
  lighting: Lightbulb,
  actuation: Activity,
  profiles: Layers,
};

/** 窄窗图标态下子栏目的图标（平台固定栏目自身语义，非设备特征）。 */
const SUB_ICONS: Record<PanelId, LucideIcon> = {
  keymap: Keyboard,
  layout: LayoutGrid,
  macros: Braces,
  device: Cpu,
  debug: Terminal,
  backup: Archive,
  menu: SlidersHorizontal,
};

interface BuiltinSub {
  readonly label: string;
  readonly panel: PanelId;
}

interface FixedSection {
  readonly key: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** 整行直达的面板；有子行时为 undefined（分组头不可点）。 */
  readonly panel?: PanelId;
  readonly subs?: readonly BuiltinSub[];
}

/** 固定栏目：平台级入口，与当前定义文件无关，恒定渲染。 */
const FIXED_SECTIONS: readonly FixedSection[] = [
  {
    key: 'keycaps',
    label: '键位',
    icon: Keyboard,
    subs: [
      { label: '键位图', panel: 'keymap' },
      { label: '布局', panel: 'layout' },
    ],
  },
  {
    key: 'macros',
    label: '宏',
    icon: Braces,
    panel: 'macros',
  },
  {
    key: 'device',
    label: '设备',
    icon: Cpu,
    subs: [
      { label: '设备信息', panel: 'device' },
      { label: '调试', panel: 'debug' },
      { label: '备份', panel: 'backup' },
    ],
  },
];

export interface SideNavProps {
  /** T06-8：窄窗图标态（AppShell 依据 useBreakpoint 传入）。 */
  readonly compact?: boolean;
}

export function SideNav({ compact = false }: SideNavProps): React.JSX.Element {
  const mascotTheme = useUiStore((s) => s.theme) === 'chiikawa';
  const currentPanel = useUiStore((s) => s.currentPanel);
  const currentMenuId = useUiStore((s) => s.currentMenuId);
  const setCurrentPanel = useUiStore((s) => s.setCurrentPanel);
  const openMenu = useUiStore((s) => s.openMenu);
  const definition = useDefinitionStore((s) => s.definition);
  const sourceName = useDefinitionStore((s) => s.sourceName);

  const menuItems: readonly MenuNavItem[] = definition ? selectMenuNavItems(definition) : [];
  const sections = buildDefinitionNavSections(menuItems);

  // —— 窄窗图标态：子栏目拍平成图标行（title/aria-label 承载语义），定义栏目取分组图标 ——
  if (compact) {
    const compactRows = FIXED_SECTIONS.flatMap((section) => {
      const directPanel: PanelId | undefined = section.panel;
      if (directPanel !== undefined) {
        return [
          {
            key: section.key,
            icon: section.icon,
            label: section.label,
            active: currentPanel === directPanel,
            activate: (): void => setCurrentPanel(directPanel),
          },
        ];
      }
      return (section.subs ?? []).map((sub) => ({
        key: sub.panel,
        icon: SUB_ICONS[sub.panel] ?? section.icon,
        label: sub.label,
        active: currentPanel === sub.panel,
        activate: (): void => setCurrentPanel(sub.panel),
      }));
    });

    return (
      <nav className="flex w-14 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-surface py-2">
        {/* 品牌位：吉伊卡哇主题下角色当 logo（hover 微微跳一下，是这一族的性格） */}
        {mascotTheme ? (
          <span className="mb-1 flex h-6 items-center justify-center transition-transform duration-base ease-spring hover:-translate-y-0.5">
            <Mascot who="chiikawa" mood="idle" size={22} animate={false} />
          </span>
        ) : (
          <div className="mb-1 flex h-5 w-5 items-center justify-center rounded-card bg-accent-soft">
            <Keyboard size={13} className="text-accent" />
          </div>
        )}
        {compactRows.map((row) => {
          const Icon = row.icon;
          return (
            <button
              key={row.key}
              type="button"
              title={row.label}
              aria-label={row.label}
              aria-pressed={row.active}
              onClick={row.activate}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-card transition-colors',
                row.active
                  ? 'bg-accent-soft text-accent'
                  : 'text-fg-muted hover:bg-elevated hover:text-fg',
              )}
            >
              <Icon size={18} />
            </button>
          );
        })}
        {definition !== null && sections.length > 0 ? (
          <div className="mt-1 flex w-full flex-col items-center gap-1 border-t border-border pt-2">
            {sections.map((section) => {
              const Icon = NAV_ICONS[section.iconKey];
              const firstMenu = section.menus[0];
              const active =
                currentPanel === 'menu' && section.menus.some((m) => m.id === currentMenuId);
              const label = section.label ?? firstMenu?.label ?? '';
              return (
                <button
                  key={section.key}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={active}
                  disabled={firstMenu === undefined}
                  onClick={() => {
                    if (firstMenu) openMenu(firstMenu.id);
                  }}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-card transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    active
                      ? 'bg-accent-soft text-accent'
                      : 'text-fg-muted hover:bg-elevated hover:text-fg',
                  )}
                >
                  <Icon size={18} />
                </button>
              );
            })}
          </div>
        ) : null}
      </nav>
    );
  }

  const menuRowClass = (active: boolean): string =>
    cn(
      'flex w-full items-center gap-2 rounded-card px-2 py-1.5 text-left text-sm transition-colors',
      active ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:bg-elevated hover:text-fg',
    );

  const subRowClass = (active: boolean): string =>
    cn(
      'relative flex w-full items-center py-1 pl-7 pr-2 text-left text-caption transition-colors',
      active ? 'text-accent' : 'text-fg-muted hover:text-fg',
    );

  /** 菜单子行（按钮）：文案直接取自定义文件的菜单名，点击打开对应菜单面板。 */
  const menuSubRow = (menu: MenuNavItem): React.JSX.Element => {
    const subActive = currentPanel === 'menu' && currentMenuId === menu.id;
    return (
      <button
        key={menu.id}
        type="button"
        className={subRowClass(subActive)}
        onClick={() => openMenu(menu.id)}
        title={`打开「${menu.label}」（${menu.controlCount} 个控件）`}
      >
        {subActive ? (
          <span className="absolute left-0 top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
        ) : null}
        <span className="flex-1">{menu.label}</span>
      </button>
    );
  };

  /** 独立行：无 category（或 category 属平台固定栏目）的菜单自身作为一行。 */
  const menuRow = (menu: MenuNavItem, Icon: LucideIcon): React.JSX.Element => {
    const active = currentPanel === 'menu' && currentMenuId === menu.id;
    return (
      <button
        key={menu.id}
        type="button"
        className={menuRowClass(active)}
        onClick={() => openMenu(menu.id)}
        title={`打开「${menu.label}」（${menu.controlCount} 个控件）`}
      >
        <Icon size={18} />
        <span className="flex-1">{menu.label}</span>
      </button>
    );
  };

  return (
    <nav className="flex w-52 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-surface p-2">
      {/* 品牌头 */}
      <div className="flex items-center gap-2 px-2 py-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-card bg-accent-soft">
          <Keyboard size={13} className="text-accent" />
        </div>
        <span className="text-sm font-semibold text-fg">KeyDriver</span>
      </div>

      {/* 固定栏目（平台能力，与配置文件无关） */}
      {FIXED_SECTIONS.map((section) => {
        const Icon = section.icon;
        const subs = section.subs ?? [];
        const panel: PanelId | undefined = section.panel;
        const active =
          panel !== undefined ? currentPanel === panel : subs.some((s) => s.panel === currentPanel);

        return (
          <div key={section.key} className="flex flex-col">
            {panel !== undefined ? (
              <button
                type="button"
                className={menuRowClass(active)}
                onClick={() => setCurrentPanel(panel)}
                title={`打开${section.label}面板`}
              >
                <Icon size={18} />
                <span className="flex-1">{section.label}</span>
              </button>
            ) : (
              <div className={menuRowClass(active)}>
                <Icon size={18} />
                <span className="flex-1">{section.label}</span>
              </div>
            )}
            {subs.map((sub) => {
              const subActive = currentPanel === sub.panel;
              return (
                <button
                  key={sub.panel}
                  type="button"
                  className={subRowClass(subActive)}
                  onClick={() => setCurrentPanel(sub.panel)}
                >
                  {subActive ? (
                    <span className="absolute left-0 top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
                  ) : null}
                  <span className="flex-1">{sub.label}</span>
                </button>
              );
            })}
          </div>
        );
      })}

      {/* 定义栏目（完全由当前定义文件驱动；无定义时不渲染） */}
      {definition !== null && sections.length > 0 ? (
        <div className="mt-1 flex flex-col gap-1 border-t border-border pt-2">
          <div
            className="truncate px-2 pb-0.5 text-caption text-fg-dim"
            title={sourceName ?? definition.name}
          >
            {sourceName ?? definition.name}
          </div>
          {sections.map((section) => {
            const Icon = NAV_ICONS[section.iconKey];
            const label = section.label;

            // 独立行：菜单自身作为一行渲染
            if (label === undefined) {
              const only = section.menus[0];
              return only ? menuRow(only, Icon) : null;
            }

            const active =
              currentPanel === 'menu' && section.menus.some((m) => m.id === currentMenuId);
            return (
              <div key={section.key} className="flex flex-col">
                <div className={menuRowClass(active)}>
                  <Icon size={18} />
                  <span className="flex-1">{label}</span>
                </div>
                {/* 同类可能存在多个菜单：全部渲染，不只取第一个 */}
                {section.menus.map(menuSubRow)}
              </div>
            );
          })}
        </div>
      ) : null}
    </nav>
  );
}
