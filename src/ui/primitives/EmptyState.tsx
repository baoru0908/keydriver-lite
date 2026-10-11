// 空状态原语：
// 图标（置于柔光圆环内，40px）→ 标题（title/fg）→ 描述（caption/fg-muted，max-width 280px）→ 可选主操作。
// 容器走毛玻璃 + 微边框，与普通内容区形成层次；垂直留白 py-10。
// a11y：容器 role="status"；图标 aria-hidden。
//
// 吉伊卡哇主题下：图标换成「探头张望」的角色形象——空态不是冷冰冰的占位，
// 而是角色在陪用户等；其余主题保持通用图标，不打扰。
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useUiStore } from '@/store/useUiStore';
import { Mascot } from '@/ui/brand/mascots';
import { cn } from '@/shared/cn';

export interface EmptyStateProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description?: string;
  /** 可选主操作按钮（primary），由调用方组装语义。 */
  readonly action?: ReactNode;
  readonly className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps): React.JSX.Element {
  const mascotTheme = useUiStore((s) => s.theme) === 'chiikawa';
  return (
    <div
      role="status"
      className={cn(
        'glass-card flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg px-6 py-10 text-center',
        'animate-fade',
        className,
      )}
    >
      {mascotTheme ? (
        /* 角色探头：空态的主角，尺寸比图标大一号，承担情绪 */
        <Mascot who="chiikawa" mood="peek" size={52} className="mb-1" />
      ) : (
        /* 柔光圆环：让图标不孤零零地浮着，与整体光效语言一致 */
        <span
          aria-hidden
          className="mb-1 flex h-14 w-14 items-center justify-center rounded-full border border-border bg-elevated/60 shadow-glow"
        >
          <Icon size={24} className="text-fg-muted" />
        </span>
      )}
      <p className="text-title text-fg">{title}</p>
      {description ? (
        <p className="max-w-[280px] text-caption text-fg-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
