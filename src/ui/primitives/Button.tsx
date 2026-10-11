// 通用按钮：variant / size 由 CVA 管理，键盘可操作。
//
// 状态覆盖：default / hover / active(按下微缩) / focus-visible(焦点环) / disabled / **loading**。
// loading 时禁用交互、aria-busy 明示、内容占位隐藏但保留宽度（避免布局跳动），
//  spinner 用当前字号同尺寸，不改按钮高度。
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/shared/cn';

const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-1.5 rounded-card font-medium',
    'transition-[background-color,color,box-shadow,transform,filter] duration-fast ease-standard',
    'active:scale-[0.97] active:brightness-95',
    'disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none',
  ].join(' '),
  {
    variants: {
      variant: {
        // 主操作：渐变 + accent 发光，悬停抬升（发光只在 hover/focus 出现，避免常态噪点）
        primary: [
          'bg-gradient-to-b from-accent to-accent-strong text-bg shadow-e1',
          'hover:shadow-glow hover:brightness-[1.04]',
        ].join(' '),
        secondary: 'bg-elevated text-fg shadow-inset-hl hover:bg-border',
        ghost: 'text-fg-muted hover:bg-elevated hover:text-fg',
        danger: 'bg-danger-soft text-danger hover:bg-danger hover:text-bg hover:shadow-glow-danger',
        outline: 'border border-border-strong text-fg hover:bg-elevated hover:border-accent/60',
      },
      size: {
        sm: 'h-6 px-2 text-[11px]',
        md: 'h-7 px-2.5 text-xs',
        lg: 'h-9 px-4 text-sm',
        icon: 'h-7 w-7',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  readonly children?: ReactNode;
  /** 加载中：显示 spinner、禁用交互、保持按钮宽度不变。 */
  readonly loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  type,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type ?? 'button'}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? (
        <>
          {/* 占位层：撑住原内容宽度，避免 loading 时按钮变窄造成跳动 */}
          <span aria-hidden className="inline-flex items-center gap-1.5 opacity-0">
            {children}
          </span>
          <Loader2 size={13} className="absolute animate-spin" aria-hidden />
        </>
      ) : (
        children
      )}
    </button>
  );
}

export { buttonVariants };
