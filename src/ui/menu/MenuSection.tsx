// 分组区块：可折叠的分组容器，递归渲染子节点。
//
// showIf 语义（官方 menu-generator.tsx 的置灰分支，:140-181）：
//   · 分组级 / 控件级条件不满足时**不隐藏**，而是整块降低不透明度 + 控件不可交互 + 给出提示；
//   · 折叠开关仍可点击（它不写值，只影响展开/收起，收起后里面有什么也看不到）；
//   · 控件区同时用 `disabled`（真禁用）与 `pointer-events-none`（鼠标事件兜底）双重拦截，
//     避免「只用样式假装不可交互」——置灰控件绝不写入设备。
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ControlSpec, MenuGroupNode } from '@/definition/schema';
import { UNAVAILABLE_HINT, type AvailableNode } from './availability';
import { ControlRenderer } from './ControlRenderer';
import { cn } from '@/shared/cn';

export interface MenuSectionProps {
  /** 已按 showIf 标注过可用性的节点（不再是原始 MenuNode） */
  readonly node: AvailableNode;
  /** 外部传入的全局禁用（例如未连接设备） */
  readonly disabled?: boolean;
  /** 顶层分组默认展开，嵌套分组默认收起（避免 349 个控件一次性铺开） */
  readonly defaultOpen?: boolean;
}

/** 分组标签可缺省（条件分组），此时用「条件」二字占位——不臆造名字。 */
function groupLabel(node: MenuGroupNode): string {
  if (node.label && node.label.trim() !== '') return node.label;
  return node.showIf ? `条件分组（${node.showIf}）` : '分组';
}

export function MenuSection({
  node,
  disabled,
  defaultOpen = false,
}: MenuSectionProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);

  // 叶子控件：条件不满足 → 置灰 + 不可交互 + 提示，但绝不从 DOM 移除
  if (node.kind === 'control') {
    return (
      <ControlRow
        control={node.control}
        disabled={disabled === true || !node.interactive}
        unavailable={!node.enabled}
      />
    );
  }

  // unavailable = 自身条件不满足，或祖先条件不满足（继承而来）
  const unavailable = !node.interactive;
  const childDisabled = disabled === true || unavailable;

  return (
    <section
      className={cn(
        'rounded-card border border-border bg-surface',
        unavailable && 'cursor-not-allowed opacity-50',
      )}
      aria-disabled={unavailable || undefined}
      data-unavailable={unavailable ? 'true' : undefined}
      title={!node.enabled ? UNAVAILABLE_HINT : undefined}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="flex-1 text-xs font-medium text-fg">{groupLabel(node.node)}</span>
        <span className="rounded bg-elevated px-1 text-[10px] text-fg-dim">
          {node.node.controlCount}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-1 border-t border-border px-3 py-2">
          {!node.enabled ? (
            <span className="text-[11px] text-fg-dim">{UNAVAILABLE_HINT}</span>
          ) : null}
          {node.children.length === 0 ? (
            <span className="text-[11px] text-fg-dim">该分组下没有控件</span>
          ) : (
            node.children.map((child) => (
              <MenuSection key={child.id} node={child} disabled={childDisabled} />
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

interface ControlRowProps {
  readonly control: ControlSpec;
  /** 是否禁止交互（自身不可用 / 祖先不可用 / 未连接设备） */
  readonly disabled: boolean;
  /** 是否因 showIf 条件不满足而不可用（决定提示文案） */
  readonly unavailable: boolean;
}

function ControlRow({ control, disabled, unavailable }: ControlRowProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded px-2 py-1',
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-elevated',
      )}
      title={unavailable ? UNAVAILABLE_HINT : `controlId: ${control.id}`}
      aria-disabled={disabled || undefined}
      data-unavailable={unavailable ? 'true' : undefined}
    >
      <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
        {control.label || control.valueKey}
      </span>
      {unavailable ? <span className="text-[10px] text-fg-dim">{UNAVAILABLE_HINT}</span> : null}
      {/* disabled（真禁用）+ pointer-events-none（鼠标事件兜底）：置灰控件绝不写入。
          min-w-0 flex-1：控件区撑满标签之外的全部宽度——不给宽度的话 RangeControl
          的 w-full 会循环塌陷（shrink-to-fit 套 w-full），滑块轨道分到 0px（真机实证）。 */}
      <div className={cn('min-w-0 flex-1', disabled ? 'pointer-events-none' : undefined)}>
        <ControlRenderer control={control} disabled={disabled} />
      </div>
    </div>
  );
}
