// 卡片容器：统一收编各面板重复的 `rounded-card border bg-surface p-*` 类串。
//
// variant：
//  · default   平铺表面（最常用）
//  · elevated  抬升块（e2 阴影）
//  · glass     毛玻璃 + 微边框 + 内侧顶部高光（用于浮层/强调区块，营造通透层次）
//  · glow      accent 发光边（用于当前选中 / 强提示）
import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/cn';

const cardVariants = cva('rounded-card border border-border', {
  variants: {
    variant: {
      default: 'bg-surface shadow-inset-hl',
      elevated: 'bg-elevated shadow-e2 shadow-inset-hl',
      glass: 'glass-card',
      glow: 'glass-card shadow-glow',
      /**
       * 可交互卡片：hover 微抬升（transform，走合成层）+ 光晕由伪元素承载（只过渡 opacity）。
       * 不用 box-shadow 过渡——那会在 hover 时逐帧重绘，列表场景肉眼可见地掉帧。
       */
      interactive: [
        'bg-surface shadow-inset-hl glow-hover cursor-pointer',
        'transition-transform duration-base ease-standard hover:-translate-y-px active:translate-y-0',
      ].join(' '),
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export function Card({ className, variant, ...props }: CardProps): React.JSX.Element {
  return <div className={cn(cardVariants({ variant }), className)} {...props} />;
}
